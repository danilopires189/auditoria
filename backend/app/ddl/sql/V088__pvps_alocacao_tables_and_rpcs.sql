create table if not exists app.db_pvps (
    queue_id uuid primary key default gen_random_uuid(),
    cd integer not null,
    zona text not null,
    coddv integer not null,
    descricao text not null,
    end_sep text not null,
    end_pul text not null,
    qtd_est_disp integer not null default 0,
    dat_ult_compra date not null,
    is_pending boolean not null default true,
    source_run_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_db_pvps_item unique (cd, coddv, end_sep, end_pul)
);

create table if not exists app.db_alocacao (
    queue_id uuid primary key default gen_random_uuid(),
    cd integer not null,
    zona text not null,
    coddv integer not null,
    descricao text not null,
    endereco text not null,
    nivel text,
    val_sist text not null,
    qtd_est_disp integer not null default 0,
    dat_ult_compra date not null,
    is_pending boolean not null default true,
    source_run_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_db_alocacao_item unique (cd, coddv, endereco)
);

create table if not exists app.aud_pvps (
    audit_id uuid primary key default gen_random_uuid(),
    cd integer not null,
    zona text not null,
    coddv integer not null,
    descricao text not null,
    end_sep text not null,
    end_sit text not null check (end_sit in ('vazio', 'obstruido')),
    val_sep text not null,
    auditor_id uuid not null references auth.users(id) on delete restrict,
    auditor_mat text not null,
    auditor_nome text not null,
    status text not null default 'pendente_pul' check (status in ('pendente_pul', 'concluido', 'nao_conforme')),
    dt_hr timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_aud_pvps_sep unique (cd, coddv, end_sep)
);

create table if not exists app.aud_pvps_pul (
    audit_pul_id uuid primary key default gen_random_uuid(),
    audit_id uuid not null references app.aud_pvps(audit_id) on delete cascade,
    end_pul text not null,
    val_pul text not null,
    dt_hr timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_aud_pvps_pul_item unique (audit_id, end_pul)
);

create table if not exists app.aud_alocacao (
    audit_id uuid primary key default gen_random_uuid(),
    queue_id uuid not null references app.db_alocacao(queue_id) on delete cascade,
    cd integer not null,
    zona text not null,
    coddv integer not null,
    descricao text not null,
    endereco text not null,
    nivel text,
    end_sit text not null check (end_sit in ('vazio', 'obstruido')),
    val_sist text not null,
    val_conf text not null,
    aud_sit text not null check (aud_sit in ('conforme', 'nao_conforme')),
    auditor_id uuid not null references auth.users(id) on delete restrict,
    auditor_mat text not null,
    auditor_nome text not null,
    dt_hr timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_aud_alocacao_queue unique (queue_id)
);

create table if not exists app.pvps_alocacao_blacklist (
    blacklist_id uuid primary key default gen_random_uuid(),
    cd integer not null,
    modulo text not null check (modulo in ('pvps', 'alocacao', 'ambos')),
    zona text not null,
    coddv integer not null,
    created_at timestamptz not null default now(),
    created_by uuid references auth.users(id) on delete set null,
    constraint uq_pvps_alocacao_blacklist unique (cd, modulo, zona, coddv)
);

create table if not exists app.pvps_alocacao_priority_zones (
    priority_id uuid primary key default gen_random_uuid(),
    cd integer not null,
    modulo text not null check (modulo in ('pvps', 'alocacao', 'ambos')),
    zona text not null,
    prioridade integer not null default 100,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_pvps_alocacao_priority unique (cd, modulo, zona)
);

create index if not exists idx_db_pvps_cd_pending
    on app.db_pvps(cd, is_pending, zona, dat_ult_compra desc);

create index if not exists idx_db_alocacao_cd_pending
    on app.db_alocacao(cd, is_pending, zona, dat_ult_compra desc);

create index if not exists idx_aud_pvps_cd_dt
    on app.aud_pvps(cd, dt_hr desc);

create index if not exists idx_aud_alocacao_cd_dt
    on app.aud_alocacao(cd, dt_hr desc);

create or replace function app.pvps_alocacao_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_db_pvps_touch_updated_at on app.db_pvps;
create trigger trg_db_pvps_touch_updated_at
before update on app.db_pvps
for each row execute function app.pvps_alocacao_touch_updated_at();

drop trigger if exists trg_db_alocacao_touch_updated_at on app.db_alocacao;
create trigger trg_db_alocacao_touch_updated_at
before update on app.db_alocacao
for each row execute function app.pvps_alocacao_touch_updated_at();

drop trigger if exists trg_aud_pvps_touch_updated_at on app.aud_pvps;
create trigger trg_aud_pvps_touch_updated_at
before update on app.aud_pvps
for each row execute function app.pvps_alocacao_touch_updated_at();

drop trigger if exists trg_aud_pvps_pul_touch_updated_at on app.aud_pvps_pul;
create trigger trg_aud_pvps_pul_touch_updated_at
before update on app.aud_pvps_pul
for each row execute function app.pvps_alocacao_touch_updated_at();

drop trigger if exists trg_aud_alocacao_touch_updated_at on app.aud_alocacao;
create trigger trg_aud_alocacao_touch_updated_at
before update on app.aud_alocacao
for each row execute function app.pvps_alocacao_touch_updated_at();

drop trigger if exists trg_pvps_alocacao_priority_touch_updated_at on app.pvps_alocacao_priority_zones;
create trigger trg_pvps_alocacao_priority_touch_updated_at
before update on app.pvps_alocacao_priority_zones
for each row execute function app.pvps_alocacao_touch_updated_at();

create or replace function app.pvps_alocacao_normalize_zone(p_endereco text)
returns text
language sql
immutable
as $$
    select case
        when nullif(trim(coalesce(p_endereco, '')), '') is null then 'SEM ZONA'
        else upper(left(trim(p_endereco), 4))
    end;
$$;

create or replace function app.pvps_alocacao_normalize_validade(p_val text)
returns text
language plpgsql
immutable
as $$
declare
    v_digits text;
    v_month integer;
    v_year integer;
begin
    v_digits := regexp_replace(coalesce(p_val, ''), '\D', '', 'g');
    if length(v_digits) <> 4 then
        raise exception 'VALIDADE_INVALIDA';
    end if;

    v_month := substring(v_digits from 1 for 2)::integer;
    v_year := substring(v_digits from 3 for 2)::integer;

    if v_month < 1 or v_month > 12 then
        raise exception 'VALIDADE_INVALIDA';
    end if;

    return lpad(v_month::text, 2, '0') || '/' || lpad(v_year::text, 2, '0');
end;
$$;

create or replace function app.pvps_alocacao_validade_rank(p_val text)
returns integer
language plpgsql
immutable
as $$
declare
    v_norm text;
    v_month integer;
    v_year integer;
begin
    v_norm := app.pvps_alocacao_normalize_validade(p_val);
    v_month := split_part(v_norm, '/', 1)::integer;
    v_year := split_part(v_norm, '/', 2)::integer;
    return (2000 + v_year) * 100 + v_month;
end;
$$;

create or replace function app.pvps_alocacao_resolve_cd(p_cd integer default null)
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
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;

    if authz.is_admin(v_uid) then
        v_cd := p_cd;
    else
        v_cd := coalesce(
            v_profile.cd_default,
            p_cd,
            (select min(ud.cd) from authz.user_deposits ud where ud.user_id = v_uid)
        );
    end if;

    if v_cd is null then raise exception 'CD_NAO_DEFINIDO_USUARIO'; end if;
    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return v_cd;
end;
$$;

create or replace function app.pvps_reseed(p_cd integer)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
begin
    with priority as (
        select cd, zona, min(prioridade) as prioridade
        from app.pvps_alocacao_priority_zones
        where cd = p_cd and modulo in ('pvps', 'ambos')
        group by cd, zona
    ),
    candidates as (
        select
            e.cd,
            e.coddv,
            e.dat_ult_compra,
            greatest(coalesce(e.qtd_est_disp, 0), 0) as qtd_est_disp,
            coalesce(min(pr.prioridade), 9999) as zone_priority
        from app.db_estq_entr e
        left join app.db_end sep
          on sep.cd = e.cd and sep.coddv = e.coddv and upper(trim(coalesce(sep.tipo, ''))) = 'SEP'
        left join priority pr
          on pr.cd = sep.cd and pr.zona = app.pvps_alocacao_normalize_zone(sep.endereco)
        where e.cd = p_cd
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
          and exists (
              select 1 from app.db_end d1
              where d1.cd = e.cd and d1.coddv = e.coddv and upper(trim(coalesce(d1.tipo, ''))) = 'SEP'
          )
          and exists (
              select 1 from app.db_end d2
              where d2.cd = e.cd and d2.coddv = e.coddv and upper(trim(coalesce(d2.tipo, ''))) = 'PUL'
          )
        group by e.cd, e.coddv, e.dat_ult_compra, e.qtd_est_disp
        order by zone_priority, e.dat_ult_compra desc, e.coddv
        limit 250
    ),
    expanded as (
        select
            c.cd,
            c.coddv,
            coalesce(nullif(trim(coalesce(sep.descricao, '')), ''), nullif(trim(coalesce(pul.descricao, '')), ''), format('CODDV %s', c.coddv)) as descricao,
            upper(trim(sep.endereco)) as end_sep,
            upper(trim(pul.endereco)) as end_pul,
            app.pvps_alocacao_normalize_zone(sep.endereco) as zona,
            c.qtd_est_disp,
            c.dat_ult_compra
        from candidates c
        join app.db_end sep
          on sep.cd = c.cd and sep.coddv = c.coddv and upper(trim(coalesce(sep.tipo, ''))) = 'SEP'
        join app.db_end pul
          on pul.cd = c.cd and pul.coddv = c.coddv and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where not exists (
            select 1
            from app.pvps_alocacao_blacklist bl
            where bl.cd = c.cd
              and bl.coddv = c.coddv
              and bl.modulo in ('pvps', 'ambos')
              and bl.zona = app.pvps_alocacao_normalize_zone(sep.endereco)
        )
          and not exists (
            select 1
            from app.aud_pvps ap
            where ap.cd = c.cd
              and ap.coddv = c.coddv
              and ap.end_sep = upper(trim(sep.endereco))
              and ap.status in ('concluido', 'nao_conforme')
        )
    )
    insert into app.db_pvps (
        cd, zona, coddv, descricao, end_sep, end_pul, qtd_est_disp, dat_ult_compra, is_pending
    )
    select
        e.cd, e.zona, e.coddv, e.descricao, e.end_sep, e.end_pul, e.qtd_est_disp, e.dat_ult_compra, true
    from expanded e
    on conflict (cd, coddv, end_sep, end_pul)
    do update set
        zona = excluded.zona,
        descricao = excluded.descricao,
        qtd_est_disp = excluded.qtd_est_disp,
        dat_ult_compra = excluded.dat_ult_compra,
        is_pending = case when app.db_pvps.is_pending then true else app.db_pvps.is_pending end;
end;
$$;

create or replace function app.alocacao_reseed(p_cd integer)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
begin
    with priority as (
        select cd, zona, min(prioridade) as prioridade
        from app.pvps_alocacao_priority_zones
        where cd = p_cd and modulo in ('alocacao', 'ambos')
        group by cd, zona
    ),
    candidates as (
        select
            e.cd,
            e.coddv,
            e.dat_ult_compra,
            greatest(coalesce(e.qtd_est_disp, 0), 0) as qtd_est_disp,
            coalesce(min(pr.prioridade), 9999) as zone_priority
        from app.db_estq_entr e
        left join app.db_end pul
          on pul.cd = e.cd and pul.coddv = e.coddv and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        left join priority pr
          on pr.cd = pul.cd and pr.zona = app.pvps_alocacao_normalize_zone(pul.endereco)
        where e.cd = p_cd
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
          and exists (
              select 1 from app.db_end d
              where d.cd = e.cd
                and d.coddv = e.coddv
                and upper(trim(coalesce(d.tipo, ''))) = 'PUL'
                and nullif(trim(coalesce(d.validade, '')), '') is not null
          )
        group by e.cd, e.coddv, e.dat_ult_compra, e.qtd_est_disp
        order by zone_priority, e.dat_ult_compra desc, e.coddv
        limit 250
    ),
    expanded as (
        select
            c.cd,
            c.coddv,
            coalesce(nullif(trim(coalesce(pul.descricao, '')), ''), format('CODDV %s', c.coddv)) as descricao,
            upper(trim(pul.endereco)) as endereco,
            app.pvps_alocacao_normalize_zone(pul.endereco) as zona,
            nullif(trim(coalesce(pul.andar, '')), '') as nivel,
            app.pvps_alocacao_normalize_validade(pul.validade) as val_sist,
            c.qtd_est_disp,
            c.dat_ult_compra
        from candidates c
        join app.db_end pul
          on pul.cd = c.cd and pul.coddv = c.coddv and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where nullif(trim(coalesce(pul.validade, '')), '') is not null
          and not exists (
            select 1
            from app.pvps_alocacao_blacklist bl
            where bl.cd = c.cd
              and bl.coddv = c.coddv
              and bl.modulo in ('alocacao', 'ambos')
              and bl.zona = app.pvps_alocacao_normalize_zone(pul.endereco)
        )
          and not exists (
            select 1
            from app.aud_alocacao aa
            where aa.cd = c.cd
              and aa.coddv = c.coddv
              and aa.endereco = upper(trim(pul.endereco))
        )
    )
    insert into app.db_alocacao (
        cd, zona, coddv, descricao, endereco, nivel, val_sist, qtd_est_disp, dat_ult_compra, is_pending
    )
    select
        e.cd, e.zona, e.coddv, e.descricao, e.endereco, e.nivel, e.val_sist, e.qtd_est_disp, e.dat_ult_compra, true
    from expanded e
    on conflict (cd, coddv, endereco)
    do update set
        zona = excluded.zona,
        descricao = excluded.descricao,
        nivel = excluded.nivel,
        val_sist = excluded.val_sist,
        qtd_est_disp = excluded.qtd_est_disp,
        dat_ult_compra = excluded.dat_ult_compra,
        is_pending = case when app.db_alocacao.is_pending then true else app.db_alocacao.is_pending end;
end;
$$;

create or replace function app.pvps_alocacao_replenish(p_cd integer, p_modulo text)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_modulo text;
begin
    v_modulo := lower(coalesce(p_modulo, 'ambos'));
    if v_modulo in ('pvps', 'ambos') then
        perform app.pvps_reseed(p_cd);
    end if;
    if v_modulo in ('alocacao', 'ambos') then
        perform app.alocacao_reseed(p_cd);
    end if;
end;
$$;

create or replace function public.rpc_pvps_manifest_items_page(
    p_cd integer default null,
    p_zona text default null,
    p_offset integer default 0,
    p_limit integer default 100
)
returns table (
    cd integer,
    zona text,
    coddv integer,
    descricao text,
    end_sep text,
    pul_total integer,
    pul_auditados integer,
    status text,
    end_sit text,
    val_sep text,
    audit_id uuid,
    dat_ult_compra date,
    qtd_est_disp integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zona text;
    v_offset integer;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_zona := upper(nullif(trim(coalesce(p_zona, '')), ''));
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 100), 1), 1000);

    perform app.pvps_alocacao_replenish(v_cd, 'pvps');

    return query
    with base as (
        select
            d.cd,
            d.zona,
            d.coddv,
            d.descricao,
            d.end_sep,
            max(d.dat_ult_compra) as dat_ult_compra,
            max(d.qtd_est_disp) as qtd_est_disp,
            count(*)::integer as pul_total
        from app.db_pvps d
        where d.cd = v_cd
          and d.is_pending
          and (v_zona is null or d.zona = v_zona)
        group by d.cd, d.zona, d.coddv, d.descricao, d.end_sep
    ),
    pul_done as (
        select
            ap.cd,
            ap.coddv,
            ap.end_sep,
            count(*)::integer as pul_auditados
        from app.aud_pvps ap
        join app.aud_pvps_pul apu on apu.audit_id = ap.audit_id
        where ap.cd = v_cd
        group by ap.cd, ap.coddv, ap.end_sep
    )
    select
        b.cd,
        b.zona,
        b.coddv,
        b.descricao,
        b.end_sep,
        b.pul_total,
        coalesce(pd.pul_auditados, 0) as pul_auditados,
        coalesce(ap.status, 'pendente_sep') as status,
        ap.end_sit,
        ap.val_sep,
        ap.audit_id,
        b.dat_ult_compra,
        b.qtd_est_disp
    from base b
    left join app.aud_pvps ap
      on ap.cd = b.cd and ap.coddv = b.coddv and ap.end_sep = b.end_sep
    left join pul_done pd
      on pd.cd = b.cd and pd.coddv = b.coddv and pd.end_sep = b.end_sep
    order by b.dat_ult_compra desc, b.zona, b.end_sep, b.coddv
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_pvps_pul_items(
    p_cd integer default null,
    p_coddv integer default null,
    p_end_sep text default null
)
returns table (
    end_pul text,
    val_pul text,
    auditado boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_end_sep text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_coddv is null or p_coddv <= 0 then raise exception 'CODDV_OBRIGATORIO'; end if;
    v_end_sep := upper(nullif(trim(coalesce(p_end_sep, '')), ''));
    if v_end_sep is null then raise exception 'END_SEP_OBRIGATORIO'; end if;

    return query
    with base as (
        select distinct d.end_pul
        from app.db_pvps d
        where d.cd = v_cd
          and d.coddv = p_coddv
          and d.end_sep = v_end_sep
    )
    select
        b.end_pul,
        apu.val_pul,
        (apu.audit_pul_id is not null) as auditado
    from base b
    left join app.aud_pvps ap
      on ap.cd = v_cd and ap.coddv = p_coddv and ap.end_sep = v_end_sep
    left join app.aud_pvps_pul apu
      on apu.audit_id = ap.audit_id and apu.end_pul = b.end_pul
    order by b.end_pul;
end;
$$;

create or replace function public.rpc_pvps_submit_sep(
    p_cd integer default null,
    p_coddv integer default null,
    p_end_sep text default null,
    p_end_sit text default null,
    p_val_sep text default null
)
returns table (
    audit_id uuid,
    status text,
    val_sep text,
    end_sit text,
    pul_total integer,
    pul_auditados integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
    v_mat text;
    v_nome text;
    v_end_sep text;
    v_end_sit text;
    v_val_sep text;
    v_audit_id uuid;
    v_pul_total integer;
    v_pul_auditados integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_coddv is null or p_coddv <= 0 then raise exception 'CODDV_OBRIGATORIO'; end if;
    v_end_sep := upper(nullif(trim(coalesce(p_end_sep, '')), ''));
    if v_end_sep is null then raise exception 'END_SEP_OBRIGATORIO'; end if;

    v_end_sit := lower(trim(coalesce(p_end_sit, '')));
    if v_end_sit not in ('vazio', 'obstruido') then raise exception 'END_SIT_INVALIDO'; end if;

    v_val_sep := app.pvps_alocacao_normalize_validade(p_val_sep);

    if not exists (
        select 1 from app.db_pvps d
        where d.cd = v_cd and d.coddv = p_coddv and d.end_sep = v_end_sep
    ) then
        raise exception 'ITEM_PVPS_NAO_ENCONTRADO';
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    insert into app.aud_pvps (
        cd, zona, coddv, descricao, end_sep, end_sit, val_sep,
        auditor_id, auditor_mat, auditor_nome, status, dt_hr
    )
    select
        d.cd,
        d.zona,
        d.coddv,
        d.descricao,
        d.end_sep,
        v_end_sit,
        v_val_sep,
        v_uid,
        v_mat,
        v_nome,
        'pendente_pul',
        now()
    from app.db_pvps d
    where d.cd = v_cd and d.coddv = p_coddv and d.end_sep = v_end_sep
    order by d.dat_ult_compra desc
    limit 1
    on conflict (cd, coddv, end_sep)
    do update set
        end_sit = excluded.end_sit,
        val_sep = excluded.val_sep,
        auditor_id = excluded.auditor_id,
        auditor_mat = excluded.auditor_mat,
        auditor_nome = excluded.auditor_nome,
        status = 'pendente_pul',
        dt_hr = now()
    returning app.aud_pvps.audit_id into v_audit_id;

    select count(*)::integer
    into v_pul_total
    from app.db_pvps d
    where d.cd = v_cd and d.coddv = p_coddv and d.end_sep = v_end_sep;

    select count(*)::integer
    into v_pul_auditados
    from app.aud_pvps_pul apu
    where apu.audit_id = v_audit_id;

    return query
    select v_audit_id, 'pendente_pul'::text, v_val_sep, v_end_sit, coalesce(v_pul_total, 0), coalesce(v_pul_auditados, 0);
end;
$$;

create or replace function public.rpc_pvps_submit_pul(
    p_audit_id uuid,
    p_end_pul text,
    p_val_pul text
)
returns table (
    audit_id uuid,
    status text,
    pul_total integer,
    pul_auditados integer,
    conforme boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_aud app.aud_pvps%rowtype;
    v_end_pul text;
    v_val_pul text;
    v_pul_total integer;
    v_pul_auditados integer;
    v_has_invalid boolean;
    v_conforme boolean;
    v_status text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    select * into v_aud from app.aud_pvps where audit_id = p_audit_id for update;
    if v_aud.audit_id is null then raise exception 'AUDITORIA_PVPS_NAO_ENCONTRADA'; end if;

    v_end_pul := upper(nullif(trim(coalesce(p_end_pul, '')), ''));
    if v_end_pul is null then raise exception 'END_PUL_OBRIGATORIO'; end if;
    v_val_pul := app.pvps_alocacao_normalize_validade(p_val_pul);

    if not exists (
        select 1
        from app.db_pvps d
        where d.cd = v_aud.cd
          and d.coddv = v_aud.coddv
          and d.end_sep = v_aud.end_sep
          and d.end_pul = v_end_pul
    ) then
        raise exception 'END_PUL_FORA_DA_AUDITORIA';
    end if;

    insert into app.aud_pvps_pul (audit_id, end_pul, val_pul, dt_hr)
    values (v_aud.audit_id, v_end_pul, v_val_pul, now())
    on conflict (audit_id, end_pul)
    do update set
        val_pul = excluded.val_pul,
        dt_hr = now();

    select count(*)::integer
    into v_pul_total
    from app.db_pvps d
    where d.cd = v_aud.cd and d.coddv = v_aud.coddv and d.end_sep = v_aud.end_sep;

    select count(*)::integer
    into v_pul_auditados
    from app.aud_pvps_pul apu
    where apu.audit_id = v_aud.audit_id;

    v_conforme := false;
    v_status := 'pendente_pul';

    if coalesce(v_pul_total, 0) > 0 and coalesce(v_pul_auditados, 0) >= coalesce(v_pul_total, 0) then
        select exists (
            select 1
            from app.aud_pvps_pul apu
            where apu.audit_id = v_aud.audit_id
              and app.pvps_alocacao_validade_rank(apu.val_pul) < app.pvps_alocacao_validade_rank(v_aud.val_sep)
        ) into v_has_invalid;

        v_conforme := not coalesce(v_has_invalid, false);
        v_status := case when v_conforme then 'concluido' else 'nao_conforme' end;

        update app.aud_pvps
        set status = v_status,
            dt_hr = now()
        where audit_id = v_aud.audit_id;

        update app.db_pvps
        set is_pending = false
        where cd = v_aud.cd and coddv = v_aud.coddv and end_sep = v_aud.end_sep;

        perform app.pvps_alocacao_replenish(v_aud.cd, 'pvps');
    end if;

    return query
    select v_aud.audit_id, v_status, coalesce(v_pul_total, 0), coalesce(v_pul_auditados, 0), v_conforme;
end;
$$;

create or replace function public.rpc_alocacao_manifest_items_page(
    p_cd integer default null,
    p_zona text default null,
    p_offset integer default 0,
    p_limit integer default 200
)
returns table (
    queue_id uuid,
    cd integer,
    zona text,
    coddv integer,
    descricao text,
    endereco text,
    nivel text,
    val_sist text,
    dat_ult_compra date,
    qtd_est_disp integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zona text;
    v_offset integer;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_zona := upper(nullif(trim(coalesce(p_zona, '')), ''));
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 200), 1), 1000);

    perform app.pvps_alocacao_replenish(v_cd, 'alocacao');

    return query
    select
        d.queue_id,
        d.cd,
        d.zona,
        d.coddv,
        d.descricao,
        d.endereco,
        d.nivel,
        d.val_sist,
        d.dat_ult_compra,
        d.qtd_est_disp
    from app.db_alocacao d
    where d.cd = v_cd
      and d.is_pending
      and (v_zona is null or d.zona = v_zona)
    order by d.dat_ult_compra desc, d.zona, d.endereco, d.coddv
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_alocacao_submit(
    p_queue_id uuid,
    p_end_sit text,
    p_val_conf text
)
returns table (
    audit_id uuid,
    aud_sit text,
    val_sist text,
    val_conf text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_profile record;
    v_mat text;
    v_nome text;
    v_item app.db_alocacao%rowtype;
    v_end_sit text;
    v_val_conf text;
    v_val_sist text;
    v_aud_sit text;
    v_audit_id uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    select * into v_item from app.db_alocacao where queue_id = p_queue_id for update;
    if v_item.queue_id is null then raise exception 'ITEM_ALOCACAO_NAO_ENCONTRADO'; end if;
    if not v_item.is_pending then raise exception 'ITEM_ALOCACAO_JA_AUDITADO'; end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_item.cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_end_sit := lower(trim(coalesce(p_end_sit, '')));
    if v_end_sit not in ('vazio', 'obstruido') then raise exception 'END_SIT_INVALIDO'; end if;

    v_val_conf := app.pvps_alocacao_normalize_validade(p_val_conf);
    v_val_sist := app.pvps_alocacao_normalize_validade(v_item.val_sist);
    v_aud_sit := case when v_val_conf = v_val_sist then 'conforme' else 'nao_conforme' end;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    insert into app.aud_alocacao (
        queue_id, cd, zona, coddv, descricao, endereco, nivel,
        end_sit, val_sist, val_conf, aud_sit,
        auditor_id, auditor_mat, auditor_nome, dt_hr
    )
    values (
        v_item.queue_id, v_item.cd, v_item.zona, v_item.coddv, v_item.descricao, v_item.endereco, v_item.nivel,
        v_end_sit, v_val_sist, v_val_conf, v_aud_sit,
        v_uid, v_mat, v_nome, now()
    )
    on conflict (queue_id)
    do update set
        end_sit = excluded.end_sit,
        val_sist = excluded.val_sist,
        val_conf = excluded.val_conf,
        aud_sit = excluded.aud_sit,
        auditor_id = excluded.auditor_id,
        auditor_mat = excluded.auditor_mat,
        auditor_nome = excluded.auditor_nome,
        dt_hr = now()
    returning app.aud_alocacao.audit_id into v_audit_id;

    update app.db_alocacao
    set is_pending = false
    where queue_id = v_item.queue_id;

    perform app.pvps_alocacao_replenish(v_item.cd, 'alocacao');

    return query
    select v_audit_id, v_aud_sit, v_val_sist, v_val_conf;
end;
$$;

grant execute on function public.rpc_pvps_manifest_items_page(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_pvps_pul_items(integer, integer, text) to authenticated;
grant execute on function public.rpc_pvps_submit_sep(integer, integer, text, text, text) to authenticated;
grant execute on function public.rpc_pvps_submit_pul(uuid, text, text) to authenticated;
grant execute on function public.rpc_alocacao_manifest_items_page(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_alocacao_submit(uuid, text, text) to authenticated;

select app.apply_runtime_security('db_pvps');
select app.apply_runtime_security('db_alocacao');
