create table if not exists app.ctrl_validade_linha_coletas (
    id uuid primary key default gen_random_uuid(),
    client_event_id text not null unique,
    cd integer not null,
    barras text not null,
    coddv integer not null,
    descricao text not null,
    endereco_sep text not null,
    val_mmaa text not null check (val_mmaa ~ '^(0[1-9]|1[0-2])/[0-9]{2}$'),
    qtd integer not null default 1 check (qtd > 0),
    data_coleta timestamptz not null default timezone('utc', now()),
    auditor_id uuid not null references auth.users(id) on delete restrict,
    auditor_mat text not null,
    auditor_nome text not null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists app.ctrl_validade_linha_retiradas (
    id uuid primary key default gen_random_uuid(),
    client_event_id text not null unique,
    cd integer not null,
    coddv integer not null,
    descricao text not null,
    endereco_sep text not null,
    val_mmaa text not null check (val_mmaa ~ '^(0[1-9]|1[0-2])/[0-9]{2}$'),
    ref_coleta_mes date not null,
    qtd_retirada integer not null default 1 check (qtd_retirada > 0),
    data_retirada timestamptz not null default timezone('utc', now()),
    auditor_id uuid not null references auth.users(id) on delete restrict,
    auditor_mat text not null,
    auditor_nome text not null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists app.ctrl_validade_pul_retiradas (
    id uuid primary key default gen_random_uuid(),
    client_event_id text not null unique,
    cd integer not null,
    coddv integer not null,
    descricao text not null,
    endereco_pul text not null,
    val_mmaa text not null check (val_mmaa ~ '^(0[1-9]|1[0-2])/[0-9]{2}$'),
    qtd_retirada integer not null default 1 check (qtd_retirada > 0),
    data_retirada timestamptz not null default timezone('utc', now()),
    auditor_id uuid not null references auth.users(id) on delete restrict,
    auditor_mat text not null,
    auditor_nome text not null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_ctrl_validade_linha_coletas_cd_data
    on app.ctrl_validade_linha_coletas(cd, data_coleta desc);

create index if not exists idx_ctrl_validade_linha_coletas_cd_coddv_end_val
    on app.ctrl_validade_linha_coletas(cd, coddv, endereco_sep, val_mmaa);

create index if not exists idx_ctrl_validade_linha_retiradas_cd_data
    on app.ctrl_validade_linha_retiradas(cd, data_retirada desc);

create index if not exists idx_ctrl_validade_linha_retiradas_cd_ref_coddv_end_val
    on app.ctrl_validade_linha_retiradas(cd, ref_coleta_mes, coddv, endereco_sep, val_mmaa);

create index if not exists idx_ctrl_validade_pul_retiradas_cd_data
    on app.ctrl_validade_pul_retiradas(cd, data_retirada desc);

create index if not exists idx_ctrl_validade_pul_retiradas_cd_coddv_end_val
    on app.ctrl_validade_pul_retiradas(cd, coddv, endereco_pul, val_mmaa);

create or replace function app.ctrl_validade_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists trg_ctrl_validade_linha_coletas_touch_updated_at on app.ctrl_validade_linha_coletas;
create trigger trg_ctrl_validade_linha_coletas_touch_updated_at
before update on app.ctrl_validade_linha_coletas
for each row execute function app.ctrl_validade_touch_updated_at();

drop trigger if exists trg_ctrl_validade_linha_retiradas_touch_updated_at on app.ctrl_validade_linha_retiradas;
create trigger trg_ctrl_validade_linha_retiradas_touch_updated_at
before update on app.ctrl_validade_linha_retiradas
for each row execute function app.ctrl_validade_touch_updated_at();

drop trigger if exists trg_ctrl_validade_pul_retiradas_touch_updated_at on app.ctrl_validade_pul_retiradas;
create trigger trg_ctrl_validade_pul_retiradas_touch_updated_at
before update on app.ctrl_validade_pul_retiradas
for each row execute function app.ctrl_validade_touch_updated_at();

create or replace function app.ctrl_validade_prev_month_ref()
returns date
language sql
stable
as $$
    select (date_trunc('month', timezone('America/Sao_Paulo', now()))::date - interval '1 month')::date;
$$;

create or replace function public.rpc_ctrl_validade_linha_coleta_insert(
    p_cd integer default null,
    p_barras text default null,
    p_endereco_sep text default null,
    p_val_mmaa text default null,
    p_qtd integer default 1,
    p_data_hr timestamptz default null,
    p_client_event_id text default null
)
returns table (
    id uuid,
    client_event_id text,
    cd integer,
    barras text,
    coddv integer,
    descricao text,
    endereco_sep text,
    val_mmaa text,
    qtd integer,
    data_coleta timestamptz,
    auditor_id uuid,
    auditor_mat text,
    auditor_nome text,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
    v_barras text;
    v_coddv integer;
    v_descricao text;
    v_endereco_sep text;
    v_val_mmaa text;
    v_qtd integer;
    v_client_event_id text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_barras := regexp_replace(coalesce(p_barras, ''), '\s+', '', 'g');
    if v_barras = '' then raise exception 'BARRAS_OBRIGATORIA'; end if;

    v_endereco_sep := upper(nullif(trim(coalesce(p_endereco_sep, '')), ''));
    if v_endereco_sep is null then raise exception 'ENDERECO_SEP_OBRIGATORIO'; end if;

    v_val_mmaa := app.pvps_alocacao_normalize_validade(p_val_mmaa);
    v_qtd := coalesce(p_qtd, 1);
    if v_qtd <= 0 then raise exception 'QTD_INVALIDA'; end if;

    v_client_event_id := nullif(trim(coalesce(p_client_event_id, '')), '');
    if v_client_event_id is null then
        v_client_event_id := format('linha-coleta:%s', gen_random_uuid()::text);
    end if;

    if exists (
        select 1
        from app.ctrl_validade_linha_coletas c
        where c.client_event_id = v_client_event_id
    ) then
        return query
        select
            c.id,
            c.client_event_id,
            c.cd,
            c.barras,
            c.coddv,
            c.descricao,
            c.endereco_sep,
            c.val_mmaa,
            c.qtd,
            c.data_coleta,
            c.auditor_id,
            c.auditor_mat,
            c.auditor_nome,
            c.created_at,
            c.updated_at
        from app.ctrl_validade_linha_coletas c
        where c.client_event_id = v_client_event_id
        limit 1;
        return;
    end if;

    select
        b.coddv,
        coalesce(nullif(trim(coalesce(b.descricao, '')), ''), format('CODDV %s', b.coddv))
    into
        v_coddv,
        v_descricao
    from app.db_barras b
    where b.barras = v_barras
    order by b.updated_at desc nulls last, b.coddv
    limit 1;

    if coalesce(v_coddv, 0) <= 0 then
        raise exception 'PRODUTO_NAO_ENCONTRADO';
    end if;

    if not exists (
        select 1
        from app.db_end d
        where d.cd = v_cd
          and d.coddv = v_coddv
          and upper(trim(coalesce(d.tipo, ''))) = 'SEP'
          and upper(trim(coalesce(d.endereco, ''))) = v_endereco_sep
    ) then
        raise exception 'ENDERECO_SEP_INVALIDO';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    return query
    insert into app.ctrl_validade_linha_coletas (
        client_event_id,
        cd,
        barras,
        coddv,
        descricao,
        endereco_sep,
        val_mmaa,
        qtd,
        data_coleta,
        auditor_id,
        auditor_mat,
        auditor_nome
    )
    values (
        v_client_event_id,
        v_cd,
        v_barras,
        v_coddv,
        v_descricao,
        v_endereco_sep,
        v_val_mmaa,
        v_qtd,
        coalesce(p_data_hr, timezone('utc', now())),
        v_uid,
        coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
    )
    returning
        ctrl_validade_linha_coletas.id,
        ctrl_validade_linha_coletas.client_event_id,
        ctrl_validade_linha_coletas.cd,
        ctrl_validade_linha_coletas.barras,
        ctrl_validade_linha_coletas.coddv,
        ctrl_validade_linha_coletas.descricao,
        ctrl_validade_linha_coletas.endereco_sep,
        ctrl_validade_linha_coletas.val_mmaa,
        ctrl_validade_linha_coletas.qtd,
        ctrl_validade_linha_coletas.data_coleta,
        ctrl_validade_linha_coletas.auditor_id,
        ctrl_validade_linha_coletas.auditor_mat,
        ctrl_validade_linha_coletas.auditor_nome,
        ctrl_validade_linha_coletas.created_at,
        ctrl_validade_linha_coletas.updated_at;
end;
$$;

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
    dt_ultima_coleta timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_status text;
    v_ref_coleta_mes date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_status := lower(trim(coalesce(p_status, 'pendente')));
    if v_status not in ('pendente', 'concluido', 'todos') then
        raise exception 'STATUS_INVALIDO';
    end if;

    v_ref_coleta_mes := app.ctrl_validade_prev_month_ref();

    return query
    with base as (
        select
            c.cd,
            c.coddv,
            max(c.descricao) as descricao,
            c.endereco_sep,
            c.val_mmaa,
            sum(c.qtd)::integer as qtd_coletada,
            max(c.data_coleta) as dt_ultima_coleta,
            case
                when c.endereco_sep like 'AL%' then 'al_lt_3m'
                else 'geral_lte_5m'
            end as regra_aplicada
        from app.ctrl_validade_linha_coletas c
        where c.cd = v_cd
          and date_trunc('month', timezone('America/Sao_Paulo', c.data_coleta))::date = v_ref_coleta_mes
        group by c.cd, c.coddv, c.endereco_sep, c.val_mmaa
    ),
    eligible as (
        select
            b.*,
            (
                ((split_part(b.val_mmaa, '/', 2)::integer + 2000) * 12 + split_part(b.val_mmaa, '/', 1)::integer)
                - (
                    extract(year from timezone('America/Sao_Paulo', b.dt_ultima_coleta))::integer * 12
                    + extract(month from timezone('America/Sao_Paulo', b.dt_ultima_coleta))::integer
                )
            ) as months_to_expire
        from base b
    ),
    filtered as (
        select e.*
        from eligible e
        where (
            e.regra_aplicada = 'al_lt_3m'
            and e.months_to_expire < 3
        ) or (
            e.regra_aplicada = 'geral_lte_5m'
            and e.months_to_expire <= 5
        )
    ),
    retirada as (
        select
            r.cd,
            r.coddv,
            r.endereco_sep,
            r.val_mmaa,
            sum(r.qtd_retirada)::integer as qtd_retirada
        from app.ctrl_validade_linha_retiradas r
        where r.cd = v_cd
          and r.ref_coleta_mes = v_ref_coleta_mes
        group by r.cd, r.coddv, r.endereco_sep, r.val_mmaa
    ),
    merged as (
        select
            f.cd,
            f.coddv,
            f.descricao,
            f.endereco_sep,
            f.val_mmaa,
            v_ref_coleta_mes as ref_coleta_mes,
            f.qtd_coletada,
            coalesce(r.qtd_retirada, 0)::integer as qtd_retirada,
            greatest(f.qtd_coletada - coalesce(r.qtd_retirada, 0), 0)::integer as qtd_pendente,
            case
                when greatest(f.qtd_coletada - coalesce(r.qtd_retirada, 0), 0) > 0 then 'pendente'
                else 'concluido'
            end as status,
            f.regra_aplicada,
            f.dt_ultima_coleta
        from filtered f
        left join retirada r
          on r.cd = f.cd
         and r.coddv = f.coddv
         and r.endereco_sep = f.endereco_sep
         and r.val_mmaa = f.val_mmaa
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
        m.dt_ultima_coleta
    from merged m
    where v_status = 'todos'
       or (v_status = 'pendente' and m.status = 'pendente')
       or (v_status = 'concluido' and m.status = 'concluido')
    order by m.status, m.endereco_sep, m.coddv, m.val_mmaa
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 400), 1), 4000);
end;
$$;

create or replace function public.rpc_ctrl_validade_linha_retirada_insert(
    p_cd integer default null,
    p_coddv integer default null,
    p_endereco_sep text default null,
    p_val_mmaa text default null,
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
    v_ref_coleta_mes date;
    v_descricao text;
    v_qtd_coletada integer;
    v_qtd_retirada_atual integer;
    v_qtd_pendente integer;
    v_regra text;
    v_months_to_expire integer;
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
    if v_qtd_retirada <= 0 then raise exception 'QTD_INVALIDA'; end if;

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
        with row_data as (
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
                r.data_retirada
            from app.ctrl_validade_linha_retiradas r
            where r.client_event_id = v_client_event_id
            limit 1
        ),
        totals as (
            select
                coalesce(sum(rr.qtd_retirada), 0)::integer as qtd_retirada_atual
            from row_data d
            left join app.ctrl_validade_linha_retiradas rr
              on rr.cd = d.cd
             and rr.coddv = d.coddv
             and rr.endereco_sep = d.endereco_sep
             and rr.val_mmaa = d.val_mmaa
             and rr.ref_coleta_mes = d.ref_coleta_mes
        ),
        coletas as (
            select
                coalesce(sum(c.qtd), 0)::integer as qtd_coletada
            from row_data d
            left join app.ctrl_validade_linha_coletas c
              on c.cd = d.cd
             and c.coddv = d.coddv
             and c.endereco_sep = d.endereco_sep
             and c.val_mmaa = d.val_mmaa
             and date_trunc('month', timezone('America/Sao_Paulo', c.data_coleta))::date = d.ref_coleta_mes
        )
        select
            d.id,
            d.client_event_id,
            d.cd,
            d.coddv,
            d.descricao,
            d.endereco_sep,
            d.val_mmaa,
            d.ref_coleta_mes,
            d.qtd_retirada,
            d.data_retirada,
            case
                when greatest(co.qtd_coletada - t.qtd_retirada_atual, 0) > 0 then 'pendente'
                else 'concluido'
            end as status,
            greatest(co.qtd_coletada - t.qtd_retirada_atual, 0)::integer as qtd_pendente
        from row_data d
        cross join totals t
        cross join coletas co;
        return;
    end if;

    v_ref_coleta_mes := app.ctrl_validade_prev_month_ref();

    select
        max(c.descricao),
        sum(c.qtd)::integer,
        case when v_endereco_sep like 'AL%' then 'al_lt_3m' else 'geral_lte_5m' end,
        (
            ((split_part(v_val_mmaa, '/', 2)::integer + 2000) * 12 + split_part(v_val_mmaa, '/', 1)::integer)
            - (
                extract(year from timezone('America/Sao_Paulo', max(c.data_coleta)))::integer * 12
                + extract(month from timezone('America/Sao_Paulo', max(c.data_coleta)))::integer
            )
        )::integer
    into
        v_descricao,
        v_qtd_coletada,
        v_regra,
        v_months_to_expire
    from app.ctrl_validade_linha_coletas c
    where c.cd = v_cd
      and c.coddv = p_coddv
      and c.endereco_sep = v_endereco_sep
      and c.val_mmaa = v_val_mmaa
      and date_trunc('month', timezone('America/Sao_Paulo', c.data_coleta))::date = v_ref_coleta_mes;

    if coalesce(v_qtd_coletada, 0) <= 0 then
        raise exception 'ITEM_NAO_ELEGIVEL_RETIRADA';
    end if;

    if not (
        (v_regra = 'al_lt_3m' and v_months_to_expire < 3)
        or (v_regra = 'geral_lte_5m' and v_months_to_expire <= 5)
    ) then
        raise exception 'ITEM_NAO_ELEGIVEL_RETIRADA';
    end if;

    select
        coalesce(sum(r.qtd_retirada), 0)::integer
    into v_qtd_retirada_atual
    from app.ctrl_validade_linha_retiradas r
    where r.cd = v_cd
      and r.coddv = p_coddv
      and r.endereco_sep = v_endereco_sep
      and r.val_mmaa = v_val_mmaa
      and r.ref_coleta_mes = v_ref_coleta_mes;

    v_qtd_pendente := greatest(v_qtd_coletada - coalesce(v_qtd_retirada_atual, 0), 0);
    if v_qtd_pendente <= 0 then
        raise exception 'ITEM_JA_CONCLUIDO';
    end if;
    if v_qtd_retirada > v_qtd_pendente then
        raise exception 'QTD_RETIRADA_EXCEDE_PENDENTE';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    return query
    with inserted as (
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
            ctrl_validade_linha_retiradas.data_retirada
    ),
    total_retirado as (
        select
            coalesce(sum(r.qtd_retirada), 0)::integer as qtd_retirada_atual
        from inserted i
        join app.ctrl_validade_linha_retiradas r
          on r.cd = i.cd
         and r.coddv = i.coddv
         and r.endereco_sep = i.endereco_sep
         and r.val_mmaa = i.val_mmaa
         and r.ref_coleta_mes = i.ref_coleta_mes
    )
    select
        i.id,
        i.client_event_id,
        i.cd,
        i.coddv,
        i.descricao,
        i.endereco_sep,
        i.val_mmaa,
        i.ref_coleta_mes,
        i.qtd_retirada,
        i.data_retirada,
        case
            when greatest(v_qtd_coletada - t.qtd_retirada_atual, 0) > 0 then 'pendente'
            else 'concluido'
        end as status,
        greatest(v_qtd_coletada - t.qtd_retirada_atual, 0)::integer as qtd_pendente
    from inserted i
    cross join total_retirado t;
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
    endereco_pul text,
    val_mmaa text,
    qtd_alvo integer,
    qtd_retirada integer,
    qtd_pendente integer,
    status text,
    qtd_est_disp integer
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
            upper(trim(d.endereco)) as endereco_pul,
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
        group by d.cd, d.coddv, coalesce(nullif(trim(coalesce(d.descricao, '')), ''), format('CODDV %s', d.coddv)), upper(trim(d.endereco)), app.pvps_alocacao_normalize_validade(d.validade)
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
        where e.months_to_expire <= 5
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
    merged as (
        select
            f.cd,
            f.coddv,
            f.descricao,
            f.endereco_pul,
            f.val_mmaa,
            1::integer as qtd_alvo,
            coalesce(r.qtd_retirada, 0)::integer as qtd_retirada,
            greatest(1 - coalesce(r.qtd_retirada, 0), 0)::integer as qtd_pendente,
            case
                when greatest(1 - coalesce(r.qtd_retirada, 0), 0) > 0 then 'pendente'
                else 'concluido'
            end as status,
            f.qtd_est_disp
        from filtered f
        left join retirada r
          on r.cd = f.cd
         and r.coddv = f.coddv
         and r.endereco_pul = f.endereco_pul
         and r.val_mmaa = f.val_mmaa
    )
    select
        m.cd,
        m.coddv,
        m.descricao,
        m.endereco_pul,
        m.val_mmaa,
        m.qtd_alvo,
        m.qtd_retirada,
        m.qtd_pendente,
        m.status,
        m.qtd_est_disp
    from merged m
    where v_status = 'todos'
       or (v_status = 'pendente' and m.status = 'pendente')
       or (v_status = 'concluido' and m.status = 'concluido')
    order by m.status, m.val_mmaa, m.endereco_pul, m.coddv
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 400), 1), 4000);
end;
$$;

create or replace function public.rpc_ctrl_validade_pul_retirada_insert(
    p_cd integer default null,
    p_coddv integer default null,
    p_endereco_pul text default null,
    p_val_mmaa text default null,
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
    endereco_pul text,
    val_mmaa text,
    qtd_retirada integer,
    data_retirada timestamptz,
    status text,
    qtd_pendente integer,
    qtd_est_disp integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
    v_endereco_pul text;
    v_val_mmaa text;
    v_qtd_retirada integer;
    v_client_event_id text;
    v_qtd_retirada_atual integer;
    v_qtd_pendente integer;
    v_qtd_est_disp integer;
    v_descricao text;
    v_current_month_idx integer;
    v_months_to_expire integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    if coalesce(p_coddv, 0) <= 0 then raise exception 'CODDV_INVALIDO'; end if;

    v_endereco_pul := upper(nullif(trim(coalesce(p_endereco_pul, '')), ''));
    if v_endereco_pul is null then raise exception 'ENDERECO_PUL_OBRIGATORIO'; end if;

    v_val_mmaa := app.pvps_alocacao_normalize_validade(p_val_mmaa);
    v_qtd_retirada := coalesce(p_qtd_retirada, 1);
    if v_qtd_retirada <= 0 then raise exception 'QTD_INVALIDA'; end if;

    v_client_event_id := nullif(trim(coalesce(p_client_event_id, '')), '');
    if v_client_event_id is null then
        v_client_event_id := format('pul-retirada:%s', gen_random_uuid()::text);
    end if;

    if exists (
        select 1
        from app.ctrl_validade_pul_retiradas r
        where r.client_event_id = v_client_event_id
    ) then
        return query
        with row_data as (
            select
                r.id,
                r.client_event_id,
                r.cd,
                r.coddv,
                r.descricao,
                r.endereco_pul,
                r.val_mmaa,
                r.qtd_retirada,
                r.data_retirada
            from app.ctrl_validade_pul_retiradas r
            where r.client_event_id = v_client_event_id
            limit 1
        ),
        totals as (
            select
                coalesce(sum(rr.qtd_retirada), 0)::integer as qtd_retirada_atual
            from row_data d
            left join app.ctrl_validade_pul_retiradas rr
              on rr.cd = d.cd
             and rr.coddv = d.coddv
             and rr.endereco_pul = d.endereco_pul
             and rr.val_mmaa = d.val_mmaa
        ),
        stock as (
            select
                coalesce(max(e.qtd_est_disp), 0)::integer as qtd_est_disp
            from row_data d
            left join app.db_estq_entr e
              on e.cd = d.cd
             and e.coddv = d.coddv
        )
        select
            d.id,
            d.client_event_id,
            d.cd,
            d.coddv,
            d.descricao,
            d.endereco_pul,
            d.val_mmaa,
            d.qtd_retirada,
            d.data_retirada,
            case
                when greatest(1 - t.qtd_retirada_atual, 0) > 0 then 'pendente'
                else 'concluido'
            end as status,
            greatest(1 - t.qtd_retirada_atual, 0)::integer as qtd_pendente,
            s.qtd_est_disp
        from row_data d
        cross join totals t
        cross join stock s;
        return;
    end if;

    select
        coalesce(max(e.qtd_est_disp), 0)::integer
    into v_qtd_est_disp
    from app.db_estq_entr e
    where e.cd = v_cd
      and e.coddv = p_coddv;

    if coalesce(v_qtd_est_disp, 0) <= 0 then
        raise exception 'ITEM_PUL_SEM_ESTOQUE';
    end if;

    select
        coalesce(nullif(trim(coalesce(d.descricao, '')), ''), format('CODDV %s', d.coddv))
    into v_descricao
    from app.db_end d
    where d.cd = v_cd
      and d.coddv = p_coddv
      and upper(trim(coalesce(d.tipo, ''))) = 'PUL'
      and upper(trim(coalesce(d.endereco, ''))) = v_endereco_pul
      and app.pvps_alocacao_normalize_validade(d.validade) = v_val_mmaa
    order by d.updated_at desc nulls last
    limit 1;

    if v_descricao is null then
        raise exception 'ITEM_NAO_ELEGIVEL_RETIRADA';
    end if;

    v_current_month_idx := (
        extract(year from timezone('America/Sao_Paulo', now()))::integer * 12
        + extract(month from timezone('America/Sao_Paulo', now()))::integer
    );
    v_months_to_expire := (
        ((split_part(v_val_mmaa, '/', 2)::integer + 2000) * 12 + split_part(v_val_mmaa, '/', 1)::integer)
        - v_current_month_idx
    );
    if v_months_to_expire > 5 then
        raise exception 'ITEM_NAO_ELEGIVEL_RETIRADA';
    end if;

    select
        coalesce(sum(r.qtd_retirada), 0)::integer
    into v_qtd_retirada_atual
    from app.ctrl_validade_pul_retiradas r
    where r.cd = v_cd
      and r.coddv = p_coddv
      and r.endereco_pul = v_endereco_pul
      and r.val_mmaa = v_val_mmaa;

    v_qtd_pendente := greatest(1 - coalesce(v_qtd_retirada_atual, 0), 0);
    if v_qtd_pendente <= 0 then
        raise exception 'ITEM_JA_CONCLUIDO';
    end if;
    if v_qtd_retirada > v_qtd_pendente then
        raise exception 'QTD_RETIRADA_EXCEDE_PENDENTE';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    return query
    with inserted as (
        insert into app.ctrl_validade_pul_retiradas (
            client_event_id,
            cd,
            coddv,
            descricao,
            endereco_pul,
            val_mmaa,
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
            v_descricao,
            v_endereco_pul,
            v_val_mmaa,
            v_qtd_retirada,
            coalesce(p_data_hr, timezone('utc', now())),
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
        )
        returning
            ctrl_validade_pul_retiradas.id,
            ctrl_validade_pul_retiradas.client_event_id,
            ctrl_validade_pul_retiradas.cd,
            ctrl_validade_pul_retiradas.coddv,
            ctrl_validade_pul_retiradas.descricao,
            ctrl_validade_pul_retiradas.endereco_pul,
            ctrl_validade_pul_retiradas.val_mmaa,
            ctrl_validade_pul_retiradas.qtd_retirada,
            ctrl_validade_pul_retiradas.data_retirada
    ),
    total_retirado as (
        select
            coalesce(sum(r.qtd_retirada), 0)::integer as qtd_retirada_atual
        from inserted i
        join app.ctrl_validade_pul_retiradas r
          on r.cd = i.cd
         and r.coddv = i.coddv
         and r.endereco_pul = i.endereco_pul
         and r.val_mmaa = i.val_mmaa
    )
    select
        i.id,
        i.client_event_id,
        i.cd,
        i.coddv,
        i.descricao,
        i.endereco_pul,
        i.val_mmaa,
        i.qtd_retirada,
        i.data_retirada,
        case
            when greatest(1 - t.qtd_retirada_atual, 0) > 0 then 'pendente'
            else 'concluido'
        end as status,
        greatest(1 - t.qtd_retirada_atual, 0)::integer as qtd_pendente,
        v_qtd_est_disp
    from inserted i
    cross join total_retirado t;
end;
$$;

alter table app.ctrl_validade_linha_coletas enable row level security;
alter table app.ctrl_validade_linha_retiradas enable row level security;
alter table app.ctrl_validade_pul_retiradas enable row level security;

revoke all on app.ctrl_validade_linha_coletas from anon;
revoke all on app.ctrl_validade_linha_coletas from authenticated;
revoke all on app.ctrl_validade_linha_retiradas from anon;
revoke all on app.ctrl_validade_linha_retiradas from authenticated;
revoke all on app.ctrl_validade_pul_retiradas from anon;
revoke all on app.ctrl_validade_pul_retiradas from authenticated;

grant execute on function public.rpc_ctrl_validade_linha_coleta_insert(integer, text, text, text, integer, timestamptz, text) to authenticated;
grant execute on function public.rpc_ctrl_validade_linha_retirada_list(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_ctrl_validade_linha_retirada_insert(integer, integer, text, text, integer, timestamptz, text) to authenticated;
grant execute on function public.rpc_ctrl_validade_pul_retirada_list(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_ctrl_validade_pul_retirada_insert(integer, integer, text, text, integer, timestamptz, text) to authenticated;
