drop function if exists public.rpc_ctrl_validade_linha_retirada_list(integer, text, integer, integer);
drop function if exists public.rpc_ctrl_validade_pul_retirada_list(integer, text, integer, integer);
drop function if exists public.rpc_ctrl_validade_linha_coleta_history_list(integer, integer, integer);
drop function if exists public.rpc_ctrl_validade_linha_coleta_last_search(integer, text);
drop function if exists public.rpc_ctrl_validade_linha_coleta_update_val_mmaa(uuid, text);
drop function if exists public.rpc_ctrl_validade_linha_retirada_update_qtd(uuid, integer);
drop function if exists public.rpc_ctrl_validade_pul_retirada_update_qtd(uuid, integer);

create or replace function public.rpc_ctrl_validade_linha_retirada_list(
    p_cd integer default null,
    p_status text default 'pendente',
    p_limit integer default 400,
    p_offset integer default 0
)
returns table (
    cd integer,
    coddv integer,
    descricao text,
    endereco_sep text,
    val_mmaa text,
    ref_coleta_mes date,
    qtd_coletada integer,
    qtd_retirada integer,
    qtd_pendente integer,
    status text,
    regra_aplicada text,
    dt_ultima_coleta timestamptz,
    auditor_nome_ultima_coleta text,
    auditor_mat_ultima_coleta text,
    editable_retirada_id uuid,
    editable_retirada_qtd integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_status text;
    v_current_month_ref date;
    v_prev_month_ref date;
    v_current_month_idx integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_status := lower(trim(coalesce(p_status, 'pendente')));
    if v_status not in ('pendente', 'concluido', 'todos') then
        raise exception 'STATUS_INVALIDO';
    end if;

    v_current_month_ref := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
    v_prev_month_ref := (v_current_month_ref - interval '1 month')::date;
    v_current_month_idx := extract(year from v_current_month_ref)::integer * 12
        + extract(month from v_current_month_ref)::integer;

    return query
    with base as (
        select
            c.cd,
            c.coddv,
            max(c.descricao) as descricao,
            upper(trim(c.endereco_sep)) as endereco_sep,
            c.val_mmaa,
            app.ctrl_validade_month_ref(c.data_coleta) as coleta_mes,
            sum(c.qtd)::integer as qtd_coletada,
            max(c.data_coleta) as dt_ultima_coleta,
            app.ctrl_validade_linha_rule(upper(trim(c.endereco_sep))) as regra_aplicada
        from app.ctrl_validade_linha_coletas c
        where c.cd = v_cd
        group by
            c.cd,
            c.coddv,
            upper(trim(c.endereco_sep)),
            c.val_mmaa,
            app.ctrl_validade_month_ref(c.data_coleta)
    ),
    ultima_coleta as (
        select
            x.cd,
            x.coddv,
            x.endereco_sep,
            x.val_mmaa,
            x.coleta_mes,
            x.data_coleta as dt_ultima_coleta,
            nullif(trim(coalesce(x.auditor_nome, '')), '') as auditor_nome_ultima_coleta,
            nullif(trim(coalesce(x.auditor_mat, '')), '') as auditor_mat_ultima_coleta
        from (
            select
                c.cd,
                c.coddv,
                upper(trim(c.endereco_sep)) as endereco_sep,
                c.val_mmaa,
                app.ctrl_validade_month_ref(c.data_coleta) as coleta_mes,
                c.data_coleta,
                c.auditor_nome,
                c.auditor_mat,
                c.created_at,
                c.id,
                row_number() over (
                    partition by c.cd, c.coddv, upper(trim(c.endereco_sep)), c.val_mmaa, app.ctrl_validade_month_ref(c.data_coleta)
                    order by c.data_coleta desc, c.created_at desc, c.id desc
                ) as rn
            from app.ctrl_validade_linha_coletas c
            where c.cd = v_cd
        ) x
        where x.rn = 1
    ),
    eligible as (
        select
            b.*,
            app.ctrl_validade_month_index(b.val_mmaa) - app.ctrl_validade_linha_lead_months(b.endereco_sep) as target_month_idx
        from base b
    ),
    filtered as (
        select e.*
        from eligible e
        where (
            e.coleta_mes = v_prev_month_ref
            and e.target_month_idx = v_current_month_idx
        ) or (
            e.coleta_mes = v_current_month_ref
            and e.target_month_idx <= v_current_month_idx
        )
    ),
    retirada as (
        select
            r.cd,
            r.coddv,
            upper(trim(r.endereco_sep)) as endereco_sep,
            r.val_mmaa,
            r.ref_coleta_mes,
            sum(r.qtd_retirada)::integer as qtd_retirada
        from app.ctrl_validade_linha_retiradas r
        where r.cd = v_cd
        group by
            r.cd,
            r.coddv,
            upper(trim(r.endereco_sep)),
            r.val_mmaa,
            r.ref_coleta_mes
    ),
    editable_retirada as (
        select
            x.cd,
            x.coddv,
            x.endereco_sep,
            x.val_mmaa,
            x.ref_coleta_mes,
            x.id as editable_retirada_id,
            x.qtd_retirada as editable_retirada_qtd
        from (
            select
                r.cd,
                r.coddv,
                upper(trim(r.endereco_sep)) as endereco_sep,
                r.val_mmaa,
                r.ref_coleta_mes,
                r.id,
                r.qtd_retirada,
                r.data_retirada,
                r.created_at,
                row_number() over (
                    partition by r.cd, r.coddv, upper(trim(r.endereco_sep)), r.val_mmaa, r.ref_coleta_mes
                    order by r.data_retirada desc, r.created_at desc, r.id desc
                ) as rn
            from app.ctrl_validade_linha_retiradas r
            where r.cd = v_cd
              and r.auditor_id = v_uid
        ) x
        where x.rn = 1
    ),
    merged as (
        select
            f.cd,
            f.coddv,
            f.descricao,
            f.endereco_sep,
            f.val_mmaa,
            f.coleta_mes as ref_coleta_mes,
            f.qtd_coletada,
            coalesce(r.qtd_retirada, 0)::integer as qtd_retirada,
            greatest(f.qtd_coletada - coalesce(r.qtd_retirada, 0), 0)::integer as qtd_pendente,
            case
                when greatest(f.qtd_coletada - coalesce(r.qtd_retirada, 0), 0) > 0 then 'pendente'
                else 'concluido'
            end as status,
            f.regra_aplicada,
            coalesce(u.dt_ultima_coleta, f.dt_ultima_coleta) as dt_ultima_coleta,
            u.auditor_nome_ultima_coleta,
            u.auditor_mat_ultima_coleta,
            er.editable_retirada_id,
            er.editable_retirada_qtd
        from filtered f
        left join retirada r
          on r.cd = f.cd
         and r.coddv = f.coddv
         and r.endereco_sep = f.endereco_sep
         and r.val_mmaa = f.val_mmaa
         and r.ref_coleta_mes = f.coleta_mes
        left join ultima_coleta u
          on u.cd = f.cd
         and u.coddv = f.coddv
         and u.endereco_sep = f.endereco_sep
         and u.val_mmaa = f.val_mmaa
         and u.coleta_mes = f.coleta_mes
        left join editable_retirada er
          on er.cd = f.cd
         and er.coddv = f.coddv
         and er.endereco_sep = f.endereco_sep
         and er.val_mmaa = f.val_mmaa
         and er.ref_coleta_mes = f.coleta_mes
    )
    select
        m.cd,
        m.coddv,
        m.descricao,
        m.endereco_sep,
        m.val_mmaa,
        m.ref_coleta_mes,
        m.qtd_coletada,
        m.qtd_retirada,
        m.qtd_pendente,
        m.status,
        m.regra_aplicada,
        m.dt_ultima_coleta,
        m.auditor_nome_ultima_coleta,
        m.auditor_mat_ultima_coleta,
        m.editable_retirada_id,
        m.editable_retirada_qtd
    from merged m
    where v_status = 'todos'
       or (v_status = 'pendente' and m.status = 'pendente')
       or (v_status = 'concluido' and m.status = 'concluido')
    order by m.status, m.endereco_sep, m.coddv, m.val_mmaa, m.ref_coleta_mes desc
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 400), 1), 4000);
end;
$$;

create or replace function public.rpc_ctrl_validade_pul_retirada_list(
    p_cd integer default null,
    p_status text default 'pendente',
    p_limit integer default 400,
    p_offset integer default 0
)
returns table (
    cd integer,
    coddv integer,
    descricao text,
    zona text,
    endereco_pul text,
    andar text,
    val_mmaa text,
    qtd_retirada integer,
    qtd_pendente integer,
    status text,
    qtd_est_disp integer,
    dt_ultima_retirada timestamptz,
    auditor_nome_ultima_retirada text,
    editable_retirada_id uuid,
    editable_retirada_qtd integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_status text;
    v_current_month_idx integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_status := lower(trim(coalesce(p_status, 'pendente')));
    if v_status not in ('pendente', 'concluido', 'todos') then
        raise exception 'STATUS_INVALIDO';
    end if;

    v_current_month_idx := (
        extract(year from timezone('America/Sao_Paulo', now()))::integer * 12
        + extract(month from timezone('America/Sao_Paulo', now()))::integer
    );

    return query
    with base as (
        select
            d.cd,
            d.coddv,
            coalesce(nullif(trim(coalesce(d.descricao, '')), ''), format('CODDV %s', d.coddv)) as descricao,
            app.pvps_alocacao_normalize_zone(d.endereco) as zona,
            upper(trim(d.endereco)) as endereco_pul,
            max(nullif(trim(coalesce(d.andar, '')), '')) as andar,
            app.pvps_alocacao_normalize_validade(d.validade) as val_mmaa,
            max(coalesce(e.qtd_est_disp, 0))::integer as qtd_est_disp
        from app.db_end d
        join app.db_estq_entr e
          on e.cd = d.cd
         and e.coddv = d.coddv
         and coalesce(e.qtd_est_disp, 0) > 0
        where d.cd = v_cd
          and upper(trim(coalesce(d.tipo, ''))) = 'PUL'
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
          and nullif(trim(coalesce(d.validade, '')), '') is not null
        group by
            d.cd,
            d.coddv,
            coalesce(nullif(trim(coalesce(d.descricao, '')), ''), format('CODDV %s', d.coddv)),
            app.pvps_alocacao_normalize_zone(d.endereco),
            upper(trim(d.endereco)),
            app.pvps_alocacao_normalize_validade(d.validade)
    ),
    eligible as (
        select
            b.*,
            (
                ((split_part(b.val_mmaa, '/', 2)::integer + 2000) * 12 + split_part(b.val_mmaa, '/', 1)::integer)
                - v_current_month_idx
            ) as months_to_expire
        from base b
    ),
    filtered as (
        select *
        from eligible e
        where e.months_to_expire <= 4
    ),
    retirada as (
        select
            r.cd,
            r.coddv,
            r.endereco_pul,
            r.val_mmaa,
            sum(r.qtd_retirada)::integer as qtd_retirada
        from app.ctrl_validade_pul_retiradas r
        where r.cd = v_cd
        group by r.cd, r.coddv, r.endereco_pul, r.val_mmaa
    ),
    ultima_retirada as (
        select
            x.cd,
            x.coddv,
            x.endereco_pul,
            x.val_mmaa,
            x.data_retirada as dt_ultima_retirada,
            nullif(trim(coalesce(x.auditor_nome, '')), '') as auditor_nome_ultima_retirada
        from (
            select
                r.cd,
                r.coddv,
                r.endereco_pul,
                r.val_mmaa,
                r.data_retirada,
                r.auditor_nome,
                r.created_at,
                r.id,
                row_number() over (
                    partition by r.cd, r.coddv, r.endereco_pul, r.val_mmaa
                    order by r.data_retirada desc, r.created_at desc, r.id desc
                ) as rn
            from app.ctrl_validade_pul_retiradas r
            where r.cd = v_cd
        ) x
        where x.rn = 1
    ),
    editable_retirada as (
        select
            x.cd,
            x.coddv,
            x.endereco_pul,
            x.val_mmaa,
            x.id as editable_retirada_id,
            x.qtd_retirada as editable_retirada_qtd
        from (
            select
                r.cd,
                r.coddv,
                r.endereco_pul,
                r.val_mmaa,
                r.id,
                r.qtd_retirada,
                r.data_retirada,
                r.created_at,
                row_number() over (
                    partition by r.cd, r.coddv, r.endereco_pul, r.val_mmaa
                    order by r.data_retirada desc, r.created_at desc, r.id desc
                ) as rn
            from app.ctrl_validade_pul_retiradas r
            where r.cd = v_cd
              and r.auditor_id = v_uid
        ) x
        where x.rn = 1
    ),
    merged as (
        select
            f.cd,
            f.coddv,
            f.descricao,
            f.zona,
            f.endereco_pul,
            f.andar,
            f.val_mmaa,
            coalesce(r.qtd_retirada, 0)::integer as qtd_retirada,
            greatest(1 - coalesce(r.qtd_retirada, 0), 0)::integer as qtd_pendente,
            case
                when greatest(1 - coalesce(r.qtd_retirada, 0), 0) > 0 then 'pendente'
                else 'concluido'
            end as status,
            f.qtd_est_disp,
            u.dt_ultima_retirada,
            u.auditor_nome_ultima_retirada,
            er.editable_retirada_id,
            er.editable_retirada_qtd
        from filtered f
        left join retirada r
          on r.cd = f.cd
         and r.coddv = f.coddv
         and r.endereco_pul = f.endereco_pul
         and r.val_mmaa = f.val_mmaa
        left join ultima_retirada u
          on u.cd = f.cd
         and u.coddv = f.coddv
         and u.endereco_pul = f.endereco_pul
         and u.val_mmaa = f.val_mmaa
        left join editable_retirada er
          on er.cd = f.cd
         and er.coddv = f.coddv
         and er.endereco_pul = f.endereco_pul
         and er.val_mmaa = f.val_mmaa
    )
    select
        m.cd,
        m.coddv,
        m.descricao,
        m.zona,
        m.endereco_pul,
        m.andar,
        m.val_mmaa,
        m.qtd_retirada,
        m.qtd_pendente,
        m.status,
        m.qtd_est_disp,
        m.dt_ultima_retirada,
        m.auditor_nome_ultima_retirada,
        m.editable_retirada_id,
        m.editable_retirada_qtd
    from merged m
    where v_status = 'todos'
       or (v_status = 'pendente' and m.status = 'pendente')
       or (v_status = 'concluido' and m.status = 'concluido')
    order by m.status, m.zona, m.val_mmaa, m.endereco_pul, m.coddv
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 400), 1), 4000);
end;
$$;

create or replace function public.rpc_ctrl_validade_linha_coleta_history_list(
    p_cd integer default null,
    p_limit integer default 1000,
    p_offset integer default 0
)
returns table (
    id uuid,
    cd integer,
    coddv integer,
    descricao text,
    barras text,
    zona text,
    endereco_sep text,
    val_mmaa text,
    data_coleta timestamptz,
    auditor_id uuid,
    auditor_mat text,
    auditor_nome text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_current_month_ref date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_current_month_ref := app.ctrl_validade_month_ref(timezone('America/Sao_Paulo', now()));

    return query
    select
        c.id,
        c.cd,
        c.coddv,
        c.descricao,
        c.barras,
        app.pvps_alocacao_normalize_zone(c.endereco_sep) as zona,
        upper(trim(c.endereco_sep)) as endereco_sep,
        c.val_mmaa,
        c.data_coleta,
        c.auditor_id,
        nullif(trim(coalesce(c.auditor_mat, '')), '') as auditor_mat,
        nullif(trim(coalesce(c.auditor_nome, '')), '') as auditor_nome
    from app.ctrl_validade_linha_coletas c
    where c.cd = v_cd
      and app.ctrl_validade_month_ref(c.data_coleta) = v_current_month_ref
    order by c.data_coleta desc, c.created_at desc, c.id desc
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$$;

create or replace function public.rpc_ctrl_validade_linha_coleta_last_search(
    p_cd integer default null,
    p_term text default null
)
returns table (
    id uuid,
    cd integer,
    coddv integer,
    descricao text,
    barras text,
    zona text,
    endereco_sep text,
    val_mmaa text,
    data_coleta timestamptz,
    auditor_id uuid,
    auditor_mat text,
    auditor_nome text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_term text;
    v_term_digits text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_term := upper(trim(coalesce(p_term, '')));
    if v_term = '' then
        raise exception 'TERMO_BUSCA_OBRIGATORIO';
    end if;
    v_term_digits := regexp_replace(v_term, '\D+', '', 'g');

    return query
    select
        c.id,
        c.cd,
        c.coddv,
        c.descricao,
        c.barras,
        app.pvps_alocacao_normalize_zone(c.endereco_sep) as zona,
        upper(trim(c.endereco_sep)) as endereco_sep,
        c.val_mmaa,
        c.data_coleta,
        c.auditor_id,
        nullif(trim(coalesce(c.auditor_mat, '')), '') as auditor_mat,
        nullif(trim(coalesce(c.auditor_nome, '')), '') as auditor_nome
    from app.ctrl_validade_linha_coletas c
    where c.cd = v_cd
      and (
        upper(trim(c.endereco_sep)) = v_term
        or (v_term_digits <> '' and c.coddv::text = v_term_digits)
        or (v_term_digits <> '' and regexp_replace(coalesce(c.barras, ''), '\s+', '', 'g') = v_term_digits)
      )
    order by c.data_coleta desc, c.created_at desc, c.id desc
    limit 1;
end;
$$;

create or replace function public.rpc_ctrl_validade_linha_coleta_update_val_mmaa(
    p_id uuid default null,
    p_val_mmaa text default null
)
returns table (
    id uuid,
    cd integer,
    coddv integer,
    descricao text,
    barras text,
    zona text,
    endereco_sep text,
    val_mmaa text,
    data_coleta timestamptz,
    auditor_id uuid,
    auditor_mat text,
    auditor_nome text,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_row app.ctrl_validade_linha_coletas%rowtype;
    v_new_val_mmaa text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_id is null then raise exception 'REGISTRO_NAO_ENCONTRADO'; end if;

    select *
    into v_row
    from app.ctrl_validade_linha_coletas c
    where c.id = p_id
    limit 1;

    if v_row.id is null then
        raise exception 'REGISTRO_NAO_ENCONTRADO';
    end if;
    if v_row.auditor_id <> v_uid then
        raise exception 'APENAS_AUTOR_PODE_EDITAR';
    end if;

    if exists (
        select 1
        from app.ctrl_validade_linha_retiradas r
        where r.cd = v_row.cd
          and r.coddv = v_row.coddv
          and upper(trim(r.endereco_sep)) = upper(trim(v_row.endereco_sep))
          and r.val_mmaa = v_row.val_mmaa
          and r.ref_coleta_mes = app.ctrl_validade_month_ref(v_row.data_coleta)
        limit 1
    ) then
        raise exception 'COLETA_COM_RETIRADA_NAO_EDITAVEL';
    end if;

    v_new_val_mmaa := app.pvps_alocacao_normalize_validade(p_val_mmaa);

    return query
    update app.ctrl_validade_linha_coletas c
    set val_mmaa = v_new_val_mmaa
    where c.id = v_row.id
    returning
        c.id,
        c.cd,
        c.coddv,
        c.descricao,
        c.barras,
        app.pvps_alocacao_normalize_zone(c.endereco_sep) as zona,
        upper(trim(c.endereco_sep)) as endereco_sep,
        c.val_mmaa,
        c.data_coleta,
        c.auditor_id,
        c.auditor_mat,
        c.auditor_nome,
        c.updated_at;
end;
$$;

create or replace function public.rpc_ctrl_validade_linha_retirada_update_qtd(
    p_id uuid default null,
    p_qtd_retirada integer default null
)
returns table (
    id uuid,
    qtd_retirada integer,
    status text,
    qtd_pendente integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_row app.ctrl_validade_linha_retiradas%rowtype;
    v_qtd_retirada integer;
    v_qtd_coletada integer;
    v_qtd_outras_retiradas integer;
    v_qtd_pendente integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_id is null then raise exception 'REGISTRO_NAO_ENCONTRADO'; end if;

    select *
    into v_row
    from app.ctrl_validade_linha_retiradas r
    where r.id = p_id
    limit 1;

    if v_row.id is null then
        raise exception 'REGISTRO_NAO_ENCONTRADO';
    end if;
    if v_row.auditor_id <> v_uid then
        raise exception 'APENAS_AUTOR_PODE_EDITAR';
    end if;

    v_qtd_retirada := coalesce(p_qtd_retirada, -1);
    if v_qtd_retirada < 0 then
        raise exception 'QTD_INVALIDA';
    end if;

    select coalesce(sum(c.qtd), 0)::integer
    into v_qtd_coletada
    from app.ctrl_validade_linha_coletas c
    where c.cd = v_row.cd
      and c.coddv = v_row.coddv
      and upper(trim(c.endereco_sep)) = upper(trim(v_row.endereco_sep))
      and c.val_mmaa = v_row.val_mmaa
      and app.ctrl_validade_month_ref(c.data_coleta) = v_row.ref_coleta_mes;

    if coalesce(v_qtd_coletada, 0) <= 0 then
        raise exception 'ITEM_NAO_ELEGIVEL_RETIRADA';
    end if;

    select coalesce(sum(r.qtd_retirada), 0)::integer
    into v_qtd_outras_retiradas
    from app.ctrl_validade_linha_retiradas r
    where r.cd = v_row.cd
      and r.coddv = v_row.coddv
      and upper(trim(r.endereco_sep)) = upper(trim(v_row.endereco_sep))
      and r.val_mmaa = v_row.val_mmaa
      and r.ref_coleta_mes = v_row.ref_coleta_mes
      and r.id <> v_row.id;

    if v_qtd_outras_retiradas + v_qtd_retirada > v_qtd_coletada then
        raise exception 'QTD_RETIRADA_EXCEDE_PENDENTE';
    end if;

    if v_qtd_retirada = 0 then
        delete from app.ctrl_validade_linha_retiradas r
        where r.id = v_row.id;
    else
        update app.ctrl_validade_linha_retiradas r
        set qtd_retirada = v_qtd_retirada
        where r.id = v_row.id;
    end if;

    v_qtd_pendente := greatest(v_qtd_coletada - (v_qtd_outras_retiradas + v_qtd_retirada), 0);

    return query
    select
        v_row.id,
        v_qtd_retirada,
        case when v_qtd_pendente > 0 then 'pendente' else 'concluido' end,
        v_qtd_pendente;
end;
$$;

create or replace function public.rpc_ctrl_validade_pul_retirada_update_qtd(
    p_id uuid default null,
    p_qtd_retirada integer default null
)
returns table (
    id uuid,
    qtd_retirada integer,
    status text,
    qtd_pendente integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_row app.ctrl_validade_pul_retiradas%rowtype;
    v_qtd_retirada integer;
    v_qtd_outras_retiradas integer;
    v_qtd_pendente integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_id is null then raise exception 'REGISTRO_NAO_ENCONTRADO'; end if;

    select *
    into v_row
    from app.ctrl_validade_pul_retiradas r
    where r.id = p_id
    limit 1;

    if v_row.id is null then
        raise exception 'REGISTRO_NAO_ENCONTRADO';
    end if;
    if v_row.auditor_id <> v_uid then
        raise exception 'APENAS_AUTOR_PODE_EDITAR';
    end if;

    v_qtd_retirada := coalesce(p_qtd_retirada, -1);
    if v_qtd_retirada < 0 then
        raise exception 'QTD_INVALIDA';
    end if;

    select coalesce(sum(r.qtd_retirada), 0)::integer
    into v_qtd_outras_retiradas
    from app.ctrl_validade_pul_retiradas r
    where r.cd = v_row.cd
      and r.coddv = v_row.coddv
      and upper(trim(r.endereco_pul)) = upper(trim(v_row.endereco_pul))
      and r.val_mmaa = v_row.val_mmaa
      and r.id <> v_row.id;

    if v_qtd_outras_retiradas + v_qtd_retirada > 1 then
        raise exception 'QTD_RETIRADA_EXCEDE_PENDENTE';
    end if;

    if v_qtd_retirada = 0 then
        delete from app.ctrl_validade_pul_retiradas r
        where r.id = v_row.id;
    else
        update app.ctrl_validade_pul_retiradas r
        set qtd_retirada = v_qtd_retirada
        where r.id = v_row.id;
    end if;

    v_qtd_pendente := greatest(1 - (v_qtd_outras_retiradas + v_qtd_retirada), 0);

    return query
    select
        v_row.id,
        v_qtd_retirada,
        case when v_qtd_pendente > 0 then 'pendente' else 'concluido' end,
        v_qtd_pendente;
end;
$$;

grant execute on function public.rpc_ctrl_validade_linha_retirada_list(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_ctrl_validade_pul_retirada_list(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_ctrl_validade_linha_coleta_history_list(integer, integer, integer) to authenticated;
grant execute on function public.rpc_ctrl_validade_linha_coleta_last_search(integer, text) to authenticated;
grant execute on function public.rpc_ctrl_validade_linha_coleta_update_val_mmaa(uuid, text) to authenticated;
grant execute on function public.rpc_ctrl_validade_linha_retirada_update_qtd(uuid, integer) to authenticated;
grant execute on function public.rpc_ctrl_validade_pul_retirada_update_qtd(uuid, integer) to authenticated;
