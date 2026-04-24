drop function if exists public.rpc_ctrl_validade_linha_retirada_list(integer, text, integer, integer);

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
    status text,
    regra_aplicada text,
    dt_ultima_coleta timestamptz,
    dt_ultima_retirada timestamptz,
    auditor_nome_ultima_coleta text,
    auditor_mat_ultima_coleta text,
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
            count(c.id)::integer as qtd_coletada,
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
            sum(r.qtd_retirada)::integer as qtd_retirada,
            count(r.id)::integer as qtd_lancamentos
        from app.ctrl_validade_linha_retiradas r
        where r.cd = v_cd
        group by
            r.cd,
            r.coddv,
            upper(trim(r.endereco_sep)),
            r.val_mmaa,
            r.ref_coleta_mes
    ),
    ultima_retirada as (
        select
            x.cd,
            x.coddv,
            x.endereco_sep,
            x.val_mmaa,
            x.ref_coleta_mes,
            x.data_retirada as dt_ultima_retirada,
            nullif(trim(coalesce(x.auditor_nome, '')), '') as auditor_nome_ultima_retirada
        from (
            select
                r.cd,
                r.coddv,
                upper(trim(r.endereco_sep)) as endereco_sep,
                r.val_mmaa,
                r.ref_coleta_mes,
                r.data_retirada,
                r.auditor_nome,
                r.created_at,
                r.id,
                row_number() over (
                    partition by r.cd, r.coddv, upper(trim(r.endereco_sep)), r.val_mmaa, r.ref_coleta_mes
                    order by r.data_retirada desc, r.created_at desc, r.id desc
                ) as rn
            from app.ctrl_validade_linha_retiradas r
            where r.cd = v_cd
        ) x
        where x.rn = 1
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
            case
                when coalesce(r.qtd_lancamentos, 0) > 0 then 'concluido'
                else 'pendente'
            end as status,
            f.regra_aplicada,
            coalesce(u.dt_ultima_coleta, f.dt_ultima_coleta) as dt_ultima_coleta,
            ur.dt_ultima_retirada,
            u.auditor_nome_ultima_coleta,
            u.auditor_mat_ultima_coleta,
            ur.auditor_nome_ultima_retirada,
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
        left join ultima_retirada ur
          on ur.cd = f.cd
         and ur.coddv = f.coddv
         and ur.endereco_sep = f.endereco_sep
         and ur.val_mmaa = f.val_mmaa
         and ur.ref_coleta_mes = f.coleta_mes
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
        m.status,
        m.regra_aplicada,
        m.dt_ultima_coleta,
        m.dt_ultima_retirada,
        m.auditor_nome_ultima_coleta,
        m.auditor_mat_ultima_coleta,
        m.auditor_nome_ultima_retirada,
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

grant execute on function public.rpc_ctrl_validade_linha_retirada_list(integer, text, integer, integer) to authenticated;
