drop function if exists public.rpc_ctrl_validade_linha_coleta_report(integer, date, date, integer, integer);
drop function if exists public.rpc_ctrl_validade_linha_retirada_report(integer, text, date, date, integer, integer);
drop function if exists public.rpc_ctrl_validade_pul_retirada_report(integer, text, date, date, integer, integer);

create or replace function public.rpc_ctrl_validade_linha_coleta_report(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_limit integer default 50000,
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
    v_dt_ini date;
    v_dt_fim date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_dt_ini := coalesce(p_dt_ini, date_trunc('month', timezone('America/Sao_Paulo', now()))::date);
    v_dt_fim := coalesce(p_dt_fim, timezone('America/Sao_Paulo', now())::date);

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
      and timezone('America/Sao_Paulo', c.data_coleta)::date between v_dt_ini and v_dt_fim
    order by c.data_coleta desc, c.created_at desc, c.id desc
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 50000), 1), 50000);
end;
$$;

create or replace function public.rpc_ctrl_validade_linha_retirada_report(
    p_cd integer default null,
    p_status text default 'ambos',
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_limit integer default 50000,
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
    v_status text;
    v_dt_ini date;
    v_dt_fim date;
begin
    v_status := lower(trim(coalesce(p_status, 'ambos')));
    if v_status in ('ambos', 'todos', 'all') then
        v_status := 'todos';
    elsif v_status not in ('pendente', 'concluido') then
        v_status := 'pendente';
    end if;
    v_dt_ini := coalesce(p_dt_ini, date_trunc('month', timezone('America/Sao_Paulo', now()))::date);
    v_dt_fim := coalesce(p_dt_fim, timezone('America/Sao_Paulo', now())::date);

    return query
    select
        r.cd,
        r.coddv,
        r.descricao,
        r.endereco_sep,
        r.val_mmaa,
        r.ref_coleta_mes,
        r.qtd_coletada,
        r.qtd_retirada,
        r.status,
        r.regra_aplicada,
        r.dt_ultima_coleta,
        r.dt_ultima_retirada,
        r.auditor_nome_ultima_coleta,
        r.auditor_mat_ultima_coleta,
        r.auditor_nome_ultima_retirada,
        r.editable_retirada_id,
        r.editable_retirada_qtd
    from public.rpc_ctrl_validade_linha_retirada_list(p_cd, v_status, least(greatest(coalesce(p_limit, 50000), 1), 50000), 0) r
    where timezone('America/Sao_Paulo', coalesce(r.dt_ultima_retirada, r.dt_ultima_coleta))::date between v_dt_ini and v_dt_fim
    order by r.status, r.endereco_sep, r.val_mmaa, r.coddv
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.rpc_ctrl_validade_pul_retirada_report(
    p_cd integer default null,
    p_status text default 'ambos',
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_limit integer default 50000,
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
    v_status text;
    v_dt_ini date;
    v_dt_fim date;
    v_today date;
begin
    v_status := lower(trim(coalesce(p_status, 'ambos')));
    if v_status in ('ambos', 'todos', 'all') then
        v_status := 'todos';
    elsif v_status not in ('pendente', 'concluido') then
        v_status := 'pendente';
    end if;
    v_dt_ini := coalesce(p_dt_ini, date_trunc('month', timezone('America/Sao_Paulo', now()))::date);
    v_dt_fim := coalesce(p_dt_fim, timezone('America/Sao_Paulo', now())::date);
    v_today := timezone('America/Sao_Paulo', now())::date;

    return query
    select
        r.cd,
        r.coddv,
        r.descricao,
        r.zona,
        r.endereco_pul,
        r.andar,
        r.val_mmaa,
        r.qtd_retirada,
        r.status,
        r.qtd_est_disp,
        r.dt_ultima_retirada,
        r.auditor_nome_ultima_retirada,
        r.editable_retirada_id,
        r.editable_retirada_qtd
    from public.rpc_ctrl_validade_pul_retirada_list(p_cd, v_status, least(greatest(coalesce(p_limit, 50000), 1), 50000), 0) r
    where (
        r.status = 'concluido'
        and timezone('America/Sao_Paulo', r.dt_ultima_retirada)::date between v_dt_ini and v_dt_fim
    ) or (
        r.status = 'pendente'
        and v_today between v_dt_ini and v_dt_fim
    )
    order by r.status, r.zona, r.val_mmaa, r.endereco_pul, r.coddv
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

grant execute on function public.rpc_ctrl_validade_linha_coleta_report(integer, date, date, integer, integer) to authenticated;
grant execute on function public.rpc_ctrl_validade_linha_retirada_report(integer, text, date, date, integer, integer) to authenticated;
grant execute on function public.rpc_ctrl_validade_pul_retirada_report(integer, text, date, date, integer, integer) to authenticated;
