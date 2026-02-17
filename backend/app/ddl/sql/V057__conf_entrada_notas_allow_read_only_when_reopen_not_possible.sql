create or replace function public.rpc_conf_entrada_notas_open_conference(
    p_seq_entrada bigint,
    p_nf bigint,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    seq_entrada bigint,
    nf bigint,
    transportadora text,
    fornecedor text,
    status text,
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
    v_seq bigint;
    v_nf bigint;
    v_today date;
    v_profile record;
    v_conf app.conf_entrada_notas%rowtype;
    v_user_active app.conf_entrada_notas%rowtype;
    v_read_only boolean;
    v_transportadora text;
    v_fornecedor text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_entrada_notas_autoclose_stale();

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);
    v_seq := p_seq_entrada;
    v_nf := p_nf;
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_seq is null or v_nf is null then
        raise exception 'SEQ_OU_NF_OBRIGATORIO';
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
    from app.conf_entrada_notas c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and (
          v_user_active.cd <> v_cd
          or v_user_active.seq_entrada <> v_seq
          or v_user_active.nf <> v_nf
       ) then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_ENTRADA';
    end if;

    if not exists (
        select 1
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada = v_seq
          and t.nf = v_nf
    ) then
        raise exception 'ENTRADA_NAO_ENCONTRADA';
    end if;

    select *
    into v_conf
    from app.conf_entrada_notas c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.seq_entrada = v_seq
      and c.nf = v_nf
    limit 1;

    if found then
        if v_conf.started_by <> v_uid and v_conf.status = 'em_conferencia' then
            raise exception 'CONFERENCIA_EM_USO';
        end if;
        v_read_only := v_conf.status <> 'em_conferencia';
    else
        select
            coalesce(min(nullif(trim(t.transportadora), '')), 'SEM TRANSPORTADORA'),
            coalesce(min(nullif(trim(t.forn), '')), 'SEM FORNECEDOR')
        into
            v_transportadora,
            v_fornecedor
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada = v_seq
          and t.nf = v_nf;

        insert into app.conf_entrada_notas (
            conf_date,
            cd,
            seq_entrada,
            nf,
            transportadora,
            fornecedor,
            started_by,
            started_mat,
            started_nome,
            status,
            started_at,
            finalized_at,
            updated_at
        )
        values (
            v_today,
            v_cd,
            v_seq,
            v_nf,
            v_transportadora,
            v_fornecedor,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            now(),
            null,
            now()
        )
        returning * into v_conf;

        insert into app.conf_entrada_notas_itens (
            conf_id,
            seq_entrada,
            nf,
            coddv,
            barras,
            descricao,
            qtd_esperada,
            qtd_conferida,
            updated_at
        )
        select
            v_conf.conf_id,
            v_seq,
            v_nf,
            t.coddv,
            null,
            coalesce(
                min(nullif(trim(t.descricao), '')),
                format('CODDV %s', t.coddv)
            ),
            greatest(sum(greatest(coalesce(t.qtd_total, 0)::integer, 0))::integer, 1),
            0,
            now()
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada = v_seq
          and t.nf = v_nf
          and t.coddv is not null
        group by t.coddv
        on conflict on constraint uq_conf_entrada_notas_itens
        do update set
            seq_entrada = excluded.seq_entrada,
            nf = excluded.nf,
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
        c.seq_entrada,
        c.nf,
        c.transportadora,
        c.fornecedor,
        c.status,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_entrada_notas c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_get_items(p_conf_id uuid)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    descricao text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    updated_at timestamptz,
    is_locked boolean,
    locked_by uuid,
    locked_mat text,
    locked_nome text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_entrada_notas%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_conf
    from app.conf_entrada_notas c
    where c.conf_id = p_conf_id
      and (
          c.started_by = v_uid
          or c.status <> 'em_conferencia'
      )
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    return query
    select
        i.item_id,
        i.conf_id,
        i.coddv,
        i.descricao,
        i.qtd_esperada,
        i.qtd_conferida,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at,
        (
            i.qtd_conferida > 0
            and i.locked_by is not null
            and i.locked_by <> v_uid
        ) as is_locked,
        i.locked_by,
        i.locked_mat,
        i.locked_nome
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_conf.conf_id
    order by
        case
            when i.qtd_conferida < i.qtd_esperada then 1
            when i.qtd_conferida > i.qtd_esperada then 2
            else 3
        end,
        i.coddv;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_get_items_v2(p_conf_id uuid)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    barras text,
    descricao text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    updated_at timestamptz,
    is_locked boolean,
    locked_by uuid,
    locked_mat text,
    locked_nome text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_entrada_notas%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_conf
    from app.conf_entrada_notas c
    where c.conf_id = p_conf_id
      and (
          c.started_by = v_uid
          or c.status <> 'em_conferencia'
      )
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    return query
    select
        i.item_id,
        i.conf_id,
        i.coddv,
        i.barras,
        i.descricao,
        i.qtd_esperada,
        i.qtd_conferida,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at,
        (
            i.qtd_conferida > 0
            and i.locked_by is not null
            and i.locked_by <> v_uid
        ) as is_locked,
        i.locked_by,
        i.locked_mat,
        i.locked_nome
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_conf.conf_id
    order by
        case
            when i.qtd_conferida < i.qtd_esperada then 1
            when i.qtd_conferida > i.qtd_esperada then 2
            else 3
        end,
        i.coddv;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_get_contributors(
    p_conf_id uuid
)
returns table (
    user_id uuid,
    mat text,
    nome text,
    first_action_at timestamptz,
    last_action_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_entrada_notas%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_conf
    from app.conf_entrada_notas c
    where c.conf_id = p_conf_id
      and (
          c.started_by = v_uid
          or c.status <> 'em_conferencia'
      )
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    return query
    select
        col.user_id,
        col.mat,
        col.nome,
        col.first_action_at,
        col.last_action_at
    from app.conf_entrada_notas_colaboradores col
    where col.conf_id = v_conf.conf_id
    order by col.first_action_at, col.nome;
end;
$$;

grant execute on function public.rpc_conf_entrada_notas_open_conference(bigint, bigint, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_get_items(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_get_items_v2(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_get_contributors(uuid) to authenticated;
