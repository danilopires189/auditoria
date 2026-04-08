create or replace function app.indicadores_gestao_estq_saida_coddv(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null
)
returns integer[]
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
begin
    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;

    if p_dt_ini > p_dt_fim then
        raise exception 'INTERVALO_INVALIDO';
    end if;

    v_cd := app.indicadores_resolve_cd(p_cd);

    return coalesce(
        (
            select array_agg(distinct r.coddv order by r.coddv)
            from app.indicadores_gestao_estq_report_rows(v_cd, p_dt_ini, p_dt_fim, 'saida') r
            where r.coddv is not null
              and r.coddv > 0
        ),
        '{}'::integer[]
    );
end;
$$;

create or replace function public.rpc_indicadores_gestao_estq_inventario_preview(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_estoque_tipo text default null,
    p_incluir_pul boolean default false
)
returns table (
    produtos_qtd integer,
    enderecos_qtd integer,
    itens_qtd integer,
    zonas_qtd integer
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
    v_estoque_tipo text;
    v_manual integer[];
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    v_cd := app.indicadores_resolve_cd(p_cd);
    v_estoque_tipo := lower(trim(coalesce(p_estoque_tipo, '')));
    if v_estoque_tipo not in ('disponivel', 'atual') then
        raise exception 'TIPO_ESTOQUE_OBRIGATORIO';
    end if;

    v_manual := app.indicadores_gestao_estq_saida_coddv(v_cd, p_dt_ini, p_dt_fim);

    return query
    with target as (
        select *
        from app.conf_inventario_seed_target_rows(
            v_cd,
            '{}'::text[],
            0,
            2147483647,
            coalesce(p_incluir_pul, false),
            v_manual,
            v_estoque_tipo,
            false,
            0
        )
    )
    select
        count(distinct t.coddv)::integer as produtos_qtd,
        count(distinct t.endereco)::integer as enderecos_qtd,
        count(*)::integer as itens_qtd,
        count(distinct t.zona)::integer as zonas_qtd
    from target t;
end;
$$;

create or replace function public.rpc_indicadores_gestao_estq_inventario_apply(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_estoque_tipo text default null,
    p_incluir_pul boolean default false
)
returns table (
    produtos_qtd integer,
    enderecos_qtd integer,
    itens_afetados integer,
    zonas_afetadas integer,
    total_geral integer,
    usuario_id uuid,
    usuario_mat text,
    usuario_nome text,
    atualizado_em timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_estoque_tipo text;
    v_manual integer[];
    v_preview record;
    v_apply record;
    v_actor_mat text;
    v_actor_nome text;
    v_actor_at timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    v_cd := app.indicadores_resolve_cd(p_cd);
    v_estoque_tipo := lower(trim(coalesce(p_estoque_tipo, '')));
    if v_estoque_tipo not in ('disponivel', 'atual') then
        raise exception 'TIPO_ESTOQUE_OBRIGATORIO';
    end if;

    v_manual := app.indicadores_gestao_estq_saida_coddv(v_cd, p_dt_ini, p_dt_fim);

    select
        count(distinct t.coddv)::integer as produtos_qtd,
        count(distinct t.endereco)::integer as enderecos_qtd,
        count(*)::integer as itens_qtd
    into v_preview
    from app.conf_inventario_seed_target_rows(
        v_cd,
        '{}'::text[],
        0,
        2147483647,
        coalesce(p_incluir_pul, false),
        v_manual,
        v_estoque_tipo,
        false,
        0
    ) t;

    if coalesce(cardinality(v_manual), 0) = 0 then
        select
            nullif(trim(coalesce(p.mat, '')), ''),
            nullif(trim(coalesce(p.nome, '')), '')
        into
            v_actor_mat,
            v_actor_nome
        from authz.profiles p
        where p.user_id = v_uid
        limit 1;

        v_actor_at := now();

        return query
        select
            0::integer,
            0::integer,
            0::integer,
            0::integer,
            0::integer,
            v_uid,
            v_actor_mat,
            v_actor_nome,
            v_actor_at;
        return;
    end if;

    select *
    into v_apply
    from public.rpc_conf_inventario_admin_apply_seed_v2(
        v_cd,
        '{}'::text[],
        0,
        2147483647,
        v_estoque_tipo,
        false,
        0,
        coalesce(p_incluir_pul, false),
        array_to_string(v_manual, ','),
        'replace_cd'
    )
    limit 1;

    return query
    select
        coalesce(v_preview.produtos_qtd, 0)::integer,
        coalesce(v_preview.enderecos_qtd, 0)::integer,
        coalesce(v_apply.itens_afetados, 0)::integer,
        coalesce(v_apply.zonas_afetadas, 0)::integer,
        coalesce(v_apply.total_geral, 0)::integer,
        v_apply.usuario_id::uuid,
        v_apply.usuario_mat::text,
        v_apply.usuario_nome::text,
        v_apply.atualizado_em::timestamptz;
end;
$$;

grant execute on function public.rpc_indicadores_gestao_estq_inventario_preview(integer, date, date, text, boolean) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_inventario_apply(integer, date, date, text, boolean) to authenticated;
