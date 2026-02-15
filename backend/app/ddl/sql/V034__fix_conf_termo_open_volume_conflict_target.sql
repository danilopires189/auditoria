create or replace function public.rpc_conf_termo_open_volume(
    p_id_etiqueta text,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    id_etiqueta text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
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
    v_conf app.conf_termo%rowtype;
    v_read_only boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_termo_resolve_cd(p_cd);
    v_tag := nullif(trim(coalesce(p_id_etiqueta, '')), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'ETIQUETA_OBRIGATORIA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    if not exists (
        select 1
        from app.db_termo t
        where t.cd = v_cd
          and t.id_etiqueta = v_tag
    ) then
        raise exception 'ETIQUETA_NAO_ENCONTRADA';
    end if;

    select *
    into v_conf
    from app.conf_termo c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.id_etiqueta = v_tag
    limit 1;

    if found then
        if v_conf.started_by <> v_uid then
            if v_conf.status = 'em_conferencia' then
                raise exception 'VOLUME_EM_USO';
            end if;
            raise exception 'VOLUME_JA_CONFERIDO_OUTRO_USUARIO';
        end if;
        v_read_only := v_conf.status <> 'em_conferencia';
    else
        with src as (
            select
                min(nullif(trim(t.caixa::text), '')) as caixa,
                min(t.pedido) as pedido,
                min(t.filial) as filial,
                coalesce(
                    min(nullif(trim(r.nome), '')),
                    format('FILIAL %s', min(t.filial))
                ) as filial_nome,
                coalesce(
                    min(nullif(trim(r.rota), '')),
                    min(nullif(trim(t.num_rota), '')),
                    'SEM ROTA'
                ) as rota
            from app.db_termo t
            left join app.db_rotas r
              on r.cd = t.cd
             and r.filial = t.filial
            where t.cd = v_cd
              and t.id_etiqueta = v_tag
        )
        insert into app.conf_termo (
            conf_date,
            cd,
            id_etiqueta,
            caixa,
            pedido,
            filial,
            filial_nome,
            rota,
            started_by,
            started_mat,
            started_nome,
            status,
            falta_motivo,
            started_at,
            finalized_at,
            updated_at
        )
        select
            v_today,
            v_cd,
            v_tag,
            src.caixa,
            src.pedido,
            src.filial,
            src.filial_nome,
            src.rota,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            null,
            now(),
            null,
            now()
        from src
        returning * into v_conf;

        insert into app.conf_termo_itens (
            conf_id,
            coddv,
            descricao,
            qtd_esperada,
            qtd_conferida,
            updated_at
        )
        select
            v_conf.conf_id,
            t.coddv,
            coalesce(
                min(nullif(trim(t.descricao), '')),
                format('CODDV %s', t.coddv)
            ),
            sum(greatest(coalesce(t.qtd_separada, 0)::integer, 0))::integer,
            0,
            now()
        from app.db_termo t
        where t.cd = v_cd
          and t.id_etiqueta = v_tag
        group by t.coddv
        on conflict on constraint uq_conf_termo_itens
        do update set
            descricao = excluded.descricao,
            qtd_esperada = excluded.qtd_esperada,
            updated_at = now();

        v_read_only := false;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.id_etiqueta,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_termo c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;
