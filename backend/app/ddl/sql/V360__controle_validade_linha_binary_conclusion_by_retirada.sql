do $$
declare
    v_constraint_name text;
begin
    for v_constraint_name in
        select c.conname
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'app'
          and t.relname = 'ctrl_validade_linha_retiradas'
          and c.contype = 'c'
          and pg_get_constraintdef(c.oid) ilike '%qtd_retirada%'
    loop
        execute format('alter table app.ctrl_validade_linha_retiradas drop constraint %I', v_constraint_name);
    end loop;
end;
$$;

alter table if exists app.ctrl_validade_linha_retiradas
    drop constraint if exists ck_ctrl_validade_linha_retiradas_qtd_retirada_nonneg;

alter table if exists app.ctrl_validade_linha_retiradas
    add constraint ck_ctrl_validade_linha_retiradas_qtd_retirada_nonneg
    check (qtd_retirada >= 0);

drop function if exists public.rpc_ctrl_validade_linha_retirada_list(integer, text, integer, integer);
drop function if exists public.rpc_ctrl_validade_linha_retirada_insert(integer, integer, text, text, date, integer, timestamptz, text);
drop function if exists public.rpc_ctrl_validade_linha_retirada_update_qtd(uuid, integer);

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

create or replace function public.rpc_ctrl_validade_linha_retirada_insert(
    p_cd integer default null,
    p_coddv integer default null,
    p_endereco_sep text default null,
    p_val_mmaa text default null,
    p_ref_coleta_mes date default null,
    p_qtd_retirada integer default 1,
    p_data_hr timestamptz default null,
    p_client_event_id text default null
)
returns table (
    id uuid,
    client_event_id text,
    cd integer,
    coddv integer,
    descricao text,
    endereco_sep text,
    val_mmaa text,
    ref_coleta_mes date,
    qtd_retirada integer,
    data_retirada timestamptz,
    status text,
    qtd_pendente integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
    v_endereco_sep text;
    v_val_mmaa text;
    v_qtd_retirada integer;
    v_client_event_id text;
    v_descricao text;
    v_qtd_coletada integer;
    v_ref_coleta_mes date;
    v_requested_ref_coleta_mes date;
    v_current_month_ref date;
    v_prev_month_ref date;
    v_current_month_idx integer;
    v_target_month_idx integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    if coalesce(p_coddv, 0) <= 0 then raise exception 'CODDV_INVALIDO'; end if;

    v_endereco_sep := upper(nullif(trim(coalesce(p_endereco_sep, '')), ''));
    if v_endereco_sep is null then raise exception 'ENDERECO_SEP_OBRIGATORIO'; end if;

    v_val_mmaa := app.pvps_alocacao_normalize_validade(p_val_mmaa);
    v_qtd_retirada := coalesce(p_qtd_retirada, 1);
    if v_qtd_retirada < 0 then raise exception 'QTD_INVALIDA'; end if;

    v_client_event_id := nullif(trim(coalesce(p_client_event_id, '')), '');
    if v_client_event_id is null then
        v_client_event_id := format('linha-retirada:%s', gen_random_uuid()::text);
    end if;

    if exists (
        select 1
        from app.ctrl_validade_linha_retiradas r
        where r.client_event_id = v_client_event_id
    ) then
        return query
        select
            r.id,
            r.client_event_id,
            r.cd,
            r.coddv,
            r.descricao,
            r.endereco_sep,
            r.val_mmaa,
            r.ref_coleta_mes,
            r.qtd_retirada,
            r.data_retirada,
            'concluido'::text as status,
            0::integer as qtd_pendente
        from app.ctrl_validade_linha_retiradas r
        where r.client_event_id = v_client_event_id
        limit 1;
        return;
    end if;

    v_current_month_ref := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
    v_prev_month_ref := (v_current_month_ref - interval '1 month')::date;
    v_current_month_idx := extract(year from v_current_month_ref)::integer * 12
        + extract(month from v_current_month_ref)::integer;
    v_target_month_idx := app.ctrl_validade_month_index(v_val_mmaa) - app.ctrl_validade_linha_lead_months(v_endereco_sep);
    v_requested_ref_coleta_mes := case
        when p_ref_coleta_mes is null then null
        else date_trunc('month', p_ref_coleta_mes::timestamp)::date
    end;

    select
        max(x.descricao),
        count(*)::integer,
        x.coleta_mes
    into
        v_descricao,
        v_qtd_coletada,
        v_ref_coleta_mes
    from (
        select
            c.descricao,
            app.ctrl_validade_month_ref(c.data_coleta) as coleta_mes
        from app.ctrl_validade_linha_coletas c
        where c.cd = v_cd
          and c.coddv = p_coddv
          and upper(trim(c.endereco_sep)) = v_endereco_sep
          and c.val_mmaa = v_val_mmaa
    ) x
    where (
        x.coleta_mes = v_prev_month_ref
        and v_target_month_idx = v_current_month_idx
    ) or (
        x.coleta_mes = v_current_month_ref
        and v_target_month_idx <= v_current_month_idx
    )
      and (v_requested_ref_coleta_mes is null or x.coleta_mes = v_requested_ref_coleta_mes)
    group by x.coleta_mes
    order by x.coleta_mes desc
    limit 1;

    if coalesce(v_qtd_coletada, 0) <= 0 or v_ref_coleta_mes is null then
        raise exception 'ITEM_NAO_ELEGIVEL_RETIRADA';
    end if;

    if exists (
        select 1
        from app.ctrl_validade_linha_retiradas r
        where r.cd = v_cd
          and r.coddv = p_coddv
          and upper(trim(r.endereco_sep)) = v_endereco_sep
          and r.val_mmaa = v_val_mmaa
          and r.ref_coleta_mes = v_ref_coleta_mes
    ) then
        raise exception 'ITEM_JA_CONCLUIDO';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    return query
    insert into app.ctrl_validade_linha_retiradas (
        client_event_id,
        cd,
        coddv,
        descricao,
        endereco_sep,
        val_mmaa,
        ref_coleta_mes,
        qtd_retirada,
        data_retirada,
        auditor_id,
        auditor_mat,
        auditor_nome
    )
    values (
        v_client_event_id,
        v_cd,
        p_coddv,
        coalesce(v_descricao, format('CODDV %s', p_coddv)),
        v_endereco_sep,
        v_val_mmaa,
        v_ref_coleta_mes,
        v_qtd_retirada,
        coalesce(p_data_hr, timezone('utc', now())),
        v_uid,
        coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
    )
    returning
        ctrl_validade_linha_retiradas.id,
        ctrl_validade_linha_retiradas.client_event_id,
        ctrl_validade_linha_retiradas.cd,
        ctrl_validade_linha_retiradas.coddv,
        ctrl_validade_linha_retiradas.descricao,
        ctrl_validade_linha_retiradas.endereco_sep,
        ctrl_validade_linha_retiradas.val_mmaa,
        ctrl_validade_linha_retiradas.ref_coleta_mes,
        ctrl_validade_linha_retiradas.qtd_retirada,
        ctrl_validade_linha_retiradas.data_retirada,
        'concluido'::text as status,
        0::integer as qtd_pendente;
end;
$$;

create or replace function public.rpc_ctrl_validade_linha_retirada_update_qtd(
    p_id uuid default null,
    p_qtd_retirada integer default null
)
returns table (
    id uuid,
    qtd_retirada integer,
    status text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_row app.ctrl_validade_linha_retiradas%rowtype;
    v_qtd_retirada integer;
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

    update app.ctrl_validade_linha_retiradas r
    set qtd_retirada = v_qtd_retirada
    where r.id = v_row.id;

    return query
    select
        v_row.id,
        v_qtd_retirada,
        'concluido'::text as status;
end;
$$;

grant execute on function public.rpc_ctrl_validade_linha_retirada_list(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_ctrl_validade_linha_retirada_insert(integer, integer, text, text, date, integer, timestamptz, text) to authenticated;
grant execute on function public.rpc_ctrl_validade_linha_retirada_update_qtd(uuid, integer) to authenticated;
