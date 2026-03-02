-- Devolucao: status de pendencia deve considerar o dia atual.
-- Conferencias finalizadas em dias anteriores nao devem manter a nota como concluida no dia atual.

create or replace function public.rpc_conf_devolucao_manifest_notas(
    p_cd integer default null
)
returns table (
    ref text,
    nfd bigint,
    chave text,
    motivo text,
    itens_total integer,
    qtd_esperada_total integer,
    status text,
    tem_falta boolean,
    colaborador_nome text,
    colaborador_mat text,
    status_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_today date;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_devolucao_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    return query
    with notas as (
        select
            coalesce(
                nullif(trim(coalesce(d.chave, '')), ''),
                d.nfd::text
            ) as ref,
            d.nfd,
            nullif(trim(coalesce(d.chave, '')), '') as chave,
            min(nullif(trim(coalesce(d.motivo, '')), '')) as motivo,
            count(distinct d.coddv)::integer as itens_total,
            coalesce(sum(greatest(coalesce(d.qtd_dev, 0)::integer, 0)), 0)::integer as qtd_esperada_total
        from app.db_devolucao d
        where d.cd = v_cd
          and d.coddv is not null
        group by
            coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text),
            d.nfd,
            nullif(trim(coalesce(d.chave, '')), '')
    ),
    conf as (
        select
            c.*,
            row_number() over (
                partition by c.cd, coalesce(c.chave, ''), coalesce(c.nfd, -1)
                order by
                    case when c.status = 'em_conferencia' then 0 else 1 end,
                    coalesce(c.finalized_at, c.updated_at, c.started_at) desc nulls last,
                    c.updated_at desc nulls last,
                    c.started_at desc nulls last,
                    c.conf_date desc
            ) as rn
        from app.conf_devolucao c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.conference_kind = 'com_nfd'
    )
    select
        n.ref,
        n.nfd,
        n.chave,
        n.motivo,
        n.itens_total,
        n.qtd_esperada_total,
        case
            when c.conf_id is null then 'pendente'
            when c.status = 'em_conferencia' then 'em_andamento'
            when c.status in ('finalizado_ok', 'finalizado_falta') then 'concluido'
            else 'pendente'
        end as status,
        coalesce(c.status = 'finalizado_falta', false) as tem_falta,
        nullif(trim(coalesce(c.started_nome, '')), '') as colaborador_nome,
        nullif(trim(coalesce(c.started_mat, '')), '') as colaborador_mat,
        case
            when c.status = 'em_conferencia' then c.started_at
            else coalesce(c.finalized_at, c.updated_at, c.started_at)
        end as status_at
    from notas n
    left join conf c
      on c.rn = 1
     and coalesce(c.nfd, -1) = coalesce(n.nfd, -1)
     and coalesce(c.chave, '') = coalesce(n.chave, '')
    order by n.ref;
end;
$$;

create or replace function public.rpc_conf_devolucao_open_conference(
    p_ref text,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    conference_kind text,
    nfd bigint,
    chave text,
    ref text,
    source_motivo text,
    nfo text,
    motivo_sem_nfd text,
    status text,
    falta_motivo text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_tag text;
    v_today date;
    v_profile record;
    v_conf app.conf_devolucao%rowtype;
    v_user_active app.conf_devolucao%rowtype;
    v_read_only boolean := false;
    v_match_nfd bigint;
    v_match_chave text;
    v_match_motivo text;
    v_match_ref text;
    v_ref_count integer := 0;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_devolucao_autoclose_stale();
    v_cd := app.conf_devolucao_resolve_cd(p_cd);
    v_tag := nullif(trim(coalesce(p_ref, '')), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'NFD_OU_CHAVE_OBRIGATORIO';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    select *
    into v_user_active
    from app.conf_devolucao c
    where c.started_by = v_uid
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null then
        if v_user_active.conference_kind = 'sem_nfd' then
            raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_DEVOLUCAO';
        end if;
        if coalesce(v_user_active.chave, '') <> coalesce(v_tag, '')
           and coalesce(v_user_active.nfd::text, '') <> coalesce(v_tag, '') then
            raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_DEVOLUCAO';
        end if;
    end if;

    select
        coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text) as ref_match,
        min(d.nfd),
        min(nullif(trim(coalesce(d.chave, '')), '')),
        min(nullif(trim(coalesce(d.motivo, '')), ''))
    into
        v_match_ref,
        v_match_nfd,
        v_match_chave,
        v_match_motivo
    from app.db_devolucao d
    where d.cd = v_cd
      and d.coddv is not null
      and coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text) = v_tag
    group by coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text)
    limit 1;

    if v_match_ref is null and v_tag ~ '^[0-9]+$' then
        select count(distinct coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text))::integer
        into v_ref_count
        from app.db_devolucao d
        where d.cd = v_cd
          and d.coddv is not null
          and d.nfd = v_tag::bigint;

        if coalesce(v_ref_count, 0) > 1 then
            raise exception 'NFD_AMBIGUA_INFORME_CHAVE';
        end if;

        select
            coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text) as ref_match,
            min(d.nfd),
            min(nullif(trim(coalesce(d.chave, '')), '')),
            min(nullif(trim(coalesce(d.motivo, '')), ''))
        into
            v_match_ref,
            v_match_nfd,
            v_match_chave,
            v_match_motivo
        from app.db_devolucao d
        where d.cd = v_cd
          and d.coddv is not null
          and d.nfd = v_tag::bigint
        group by coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text)
        limit 1;
    end if;

    if v_match_ref is null then
        raise exception 'NFD_OU_CHAVE_NAO_ENCONTRADA';
    end if;

    select *
    into v_conf
    from app.conf_devolucao c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.conference_kind = 'com_nfd'
      and coalesce(c.nfd, -1) = coalesce(v_match_nfd, -1)
      and coalesce(c.chave, '') = coalesce(v_match_chave, '')
    order by
        case when c.status = 'em_conferencia' then 0 else 1 end,
        coalesce(c.finalized_at, c.updated_at, c.started_at) desc nulls last,
        c.updated_at desc nulls last,
        c.started_at desc nulls last
    limit 1;

    if found then
        if coalesce(v_conf.source_motivo, '') is distinct from coalesce(v_match_motivo, '') then
            update app.conf_devolucao c
               set source_motivo = coalesce(v_match_motivo, c.source_motivo),
                   updated_at = now()
             where c.conf_id = v_conf.conf_id
            returning * into v_conf;
        end if;

        perform app.conf_devolucao_upsert_items_from_base(v_conf.conf_id, v_cd, v_match_ref);

        if v_conf.started_by <> v_uid then
            if v_conf.status = 'em_conferencia' then
                raise exception 'CONFERENCIA_EM_USO';
            end if;
            if authz.is_admin(v_uid) and authz.can_access_cd(v_uid, v_cd) then
                v_read_only := true;
            else
                raise exception 'CONFERENCIA_JA_CONCLUIDA_POR_OUTRO_USUARIO';
            end if;
        else
            v_read_only := v_conf.status <> 'em_conferencia';
        end if;
    else
        insert into app.conf_devolucao (
            conf_date,
            cd,
            conference_kind,
            nfd,
            chave,
            source_motivo,
            started_by,
            started_mat,
            started_nome,
            status,
            started_at,
            updated_at
        )
        values (
            v_today,
            v_cd,
            'com_nfd',
            v_match_nfd,
            v_match_chave,
            v_match_motivo,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            now(),
            now()
        )
        returning * into v_conf;

        perform app.conf_devolucao_upsert_items_from_base(v_conf.conf_id, v_cd, v_match_ref);
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.conference_kind,
        c.nfd,
        c.chave,
        coalesce(nullif(trim(coalesce(c.chave, '')), ''), c.nfd::text, format('SEM-NFD-%s', left(c.conf_id::text, 8))) as ref,
        c.source_motivo,
        c.nfo,
        c.motivo_sem_nfd,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_devolucao c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

grant execute on function public.rpc_conf_devolucao_manifest_notas(integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_open_conference(text, integer) to authenticated;
