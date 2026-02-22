create or replace function app.busca_produto_resolve_cd(p_cd integer default null)
returns integer
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    select * into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if authz.is_admin(v_uid) then
        v_cd := coalesce(
            p_cd,
            v_profile.cd_default,
            (select min(ud.cd) from authz.user_deposits ud where ud.user_id = v_uid)
        );
    else
        v_cd := coalesce(
            v_profile.cd_default,
            p_cd,
            (select min(ud.cd) from authz.user_deposits ud where ud.user_id = v_uid)
        );
    end if;

    if v_cd is null then
        raise exception 'CD_NAO_DEFINIDO_USUARIO';
    end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return v_cd;
end;
$$;

create or replace function public.rpc_busca_produto_lookup(
    p_cd integer default null,
    p_barras text default null,
    p_coddv integer default null
)
returns table (
    cd integer,
    coddv integer,
    descricao text,
    barras text,
    qtd_est_disp integer,
    qtd_est_atual integer,
    estoque_updated_at timestamptz,
    dat_ult_compra date,
    enderecos_sep jsonb,
    enderecos_pul jsonb,
    enderecos_excluidos jsonb
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_barras text;
    v_coddv integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_barras := regexp_replace(coalesce(p_barras, ''), '\s+', '', 'g');
    v_coddv := coalesce(p_coddv, 0);

    if v_barras = '' and v_coddv <= 0 then
        raise exception 'PARAMS_BUSCA_OBRIGATORIOS';
    end if;

    if p_coddv is not null and p_coddv <= 0 then
        raise exception 'CODDV_INVALIDO';
    end if;

    if v_barras <> '' then
        select b.coddv
          into v_coddv
          from app.db_barras b
         where b.barras = v_barras
         order by b.updated_at desc nulls last, b.coddv
         limit 1;
    end if;

    if v_coddv is null or v_coddv <= 0 then
        raise exception 'PRODUTO_NAO_ENCONTRADO';
    end if;

    return query
    with produto as (
        select
            b.coddv,
            coalesce(nullif(trim(coalesce(b.descricao, '')), ''), format('CODDV %s', b.coddv)) as descricao,
            b.barras
        from app.db_barras b
        where (
            v_barras <> ''
            and b.barras = v_barras
        ) or (
            v_barras = ''
            and b.coddv = v_coddv
        )
        order by
            case when v_barras <> '' and b.barras = v_barras then 0 else 1 end,
            b.updated_at desc nulls last,
            b.coddv
        limit 1
    ),
    estq as (
        select
            e.cd,
            e.coddv,
            greatest(coalesce(e.qtd_est_disp, 0), 0)::integer as qtd_est_disp,
            greatest(coalesce(e.qtd_est_atual, 0), 0)::integer as qtd_est_atual,
            e.updated_at as estoque_updated_at,
            e.dat_ult_compra
        from app.db_estq_entr e
        where e.cd = v_cd
          and e.coddv = v_coddv
        order by e.updated_at desc nulls last
        limit 1
    ),
    sep as (
        select
            jsonb_agg(
                jsonb_build_object(
                    'endereco', upper(trim(d.endereco)),
                    'andar', nullif(trim(coalesce(d.andar, '')), ''),
                    'validade', nullif(trim(coalesce(d.validade, '')), '')
                )
                order by upper(trim(d.endereco))
            ) as rows
        from app.db_end d
        where d.cd = v_cd
          and d.coddv = v_coddv
          and upper(trim(coalesce(d.tipo, ''))) = 'SEP'
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
    ),
    pul as (
        select
            jsonb_agg(
                jsonb_build_object(
                    'endereco', upper(trim(d.endereco)),
                    'andar', nullif(trim(coalesce(d.andar, '')), ''),
                    'validade', nullif(trim(coalesce(d.validade, '')), '')
                )
                order by upper(trim(d.endereco))
            ) as rows
        from app.db_end d
        where d.cd = v_cd
          and d.coddv = v_coddv
          and upper(trim(coalesce(d.tipo, ''))) = 'PUL'
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
    ),
    excluidos as (
        select
            jsonb_agg(
                jsonb_build_object(
                    'endereco', upper(trim(l.endereco)),
                    'exclusao', l.exclusao
                )
                order by l.exclusao desc nulls last, upper(trim(l.endereco))
            ) as rows
        from app.db_log_end l
        where l.cd = v_cd
          and l.coddv = v_coddv
          and nullif(trim(coalesce(l.endereco, '')), '') is not null
    )
    select
        v_cd as cd,
        p.coddv,
        p.descricao,
        p.barras,
        coalesce(e.qtd_est_disp, 0)::integer as qtd_est_disp,
        coalesce(e.qtd_est_atual, 0)::integer as qtd_est_atual,
        e.estoque_updated_at,
        e.dat_ult_compra,
        coalesce(s.rows, '[]'::jsonb) as enderecos_sep,
        coalesce(pl.rows, '[]'::jsonb) as enderecos_pul,
        coalesce(x.rows, '[]'::jsonb) as enderecos_excluidos
    from produto p
    left join estq e on true
    left join sep s on true
    left join pul pl on true
    left join excluidos x on true;

    if not found then
        raise exception 'PRODUTO_NAO_ENCONTRADO';
    end if;
end;
$$;

grant execute on function public.rpc_busca_produto_lookup(integer, text, integer) to authenticated;
