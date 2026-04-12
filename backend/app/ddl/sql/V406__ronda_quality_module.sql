create table if not exists app.aud_ronda_quality_sessions (
    audit_id uuid primary key default gen_random_uuid(),
    month_ref date not null,
    cd integer not null,
    zone_type text not null check (zone_type in ('SEP', 'PUL')),
    zona text not null,
    audit_result text not null check (audit_result in ('sem_ocorrencia', 'com_ocorrencia')),
    auditor_id uuid not null references auth.users(id) on delete restrict,
    auditor_mat text not null,
    auditor_nome text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists app.aud_ronda_quality_occurrences (
    occurrence_id uuid primary key default gen_random_uuid(),
    audit_id uuid not null references app.aud_ronda_quality_sessions(audit_id) on delete cascade,
    month_ref date not null,
    cd integer not null,
    zone_type text not null check (zone_type in ('SEP', 'PUL')),
    zona text not null,
    coluna integer,
    endereco text not null,
    nivel text,
    motivo text not null,
    observacao text not null,
    correction_status text not null default 'nao_corrigido' check (correction_status in ('nao_corrigido', 'corrigido')),
    correction_updated_at timestamptz,
    correction_updated_by uuid references auth.users(id) on delete set null,
    correction_updated_mat text,
    correction_updated_nome text,
    created_at timestamptz not null default now(),
    created_by uuid not null references auth.users(id) on delete restrict,
    constraint ck_aud_ronda_quality_occurrences_endereco check (nullif(trim(coalesce(endereco, '')), '') is not null),
    constraint ck_aud_ronda_quality_occurrences_motivo check (nullif(trim(coalesce(motivo, '')), '') is not null),
    constraint ck_aud_ronda_quality_occurrences_observacao check (nullif(trim(coalesce(observacao, '')), '') is not null)
);

create index if not exists idx_aud_ronda_quality_sessions_month_cd_type_zona
    on app.aud_ronda_quality_sessions(month_ref, cd, zone_type, zona, created_at desc);

create index if not exists idx_aud_ronda_quality_sessions_cd_created
    on app.aud_ronda_quality_sessions(cd, created_at desc);

create index if not exists idx_aud_ronda_quality_occurrences_month_cd_type_zona
    on app.aud_ronda_quality_occurrences(month_ref, cd, zone_type, zona, created_at desc);

create index if not exists idx_aud_ronda_quality_occurrences_cd_status
    on app.aud_ronda_quality_occurrences(cd, correction_status, created_at desc);

create index if not exists idx_aud_ronda_quality_occurrences_audit_id
    on app.aud_ronda_quality_occurrences(audit_id, created_at);

create index if not exists idx_aud_ronda_quality_occurrences_endereco
    on app.aud_ronda_quality_occurrences(cd, zone_type, zona, upper(trim(endereco)));

create or replace function app.ronda_quality_resolve_cd(p_cd integer default null)
returns integer
language sql
stable
security definer
set search_path = app, authz, public
as $$
    select authz.resolve_requested_cd(p_cd);
$$;

create or replace function app.ronda_quality_current_month()
returns date
language sql
stable
as $$
    select date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
$$;

create or replace function app.ronda_quality_resolve_month_ref(p_month_ref date default null)
returns date
language sql
stable
as $$
    select coalesce(date_trunc('month', p_month_ref::timestamp)::date, app.ronda_quality_current_month());
$$;

create or replace function app.ronda_quality_normalize_zone(
    p_endereco text,
    p_zone_type text default null
)
returns text
language plpgsql
immutable
as $$
declare
    v_endereco text;
    v_zone_type text;
    v_zone text;
begin
    v_endereco := upper(trim(coalesce(p_endereco, '')));
    v_zone_type := upper(trim(coalesce(p_zone_type, '')));

    if v_endereco = '' then
        return null;
    end if;

    v_endereco := regexp_replace(v_endereco, '\s+', '', 'g');

    if v_zone_type = 'PUL' then
        v_zone := split_part(v_endereco, '.', 1);
    else
        v_zone := left(v_endereco, 4);
    end if;

    return nullif(trim(coalesce(v_zone, '')), '');
end;
$$;

create or replace function app.ronda_quality_normalize_column(p_endereco text)
returns integer
language plpgsql
immutable
as $$
declare
    v_endereco text;
    v_column_raw text;
begin
    v_endereco := regexp_replace(upper(trim(coalesce(p_endereco, ''))), '\s+', '', 'g');
    if v_endereco = '' then
        return null;
    end if;

    v_column_raw := split_part(v_endereco, '.', 3);
    if v_column_raw !~ '^\d+$' then
        return null;
    end if;

    return v_column_raw::integer;
end;
$$;

create or replace function app.ronda_quality_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_aud_ronda_quality_sessions_touch_updated_at on app.aud_ronda_quality_sessions;

create trigger trg_aud_ronda_quality_sessions_touch_updated_at
before update on app.aud_ronda_quality_sessions
for each row execute function app.ronda_quality_touch_updated_at();

alter table app.aud_ronda_quality_sessions enable row level security;
alter table app.aud_ronda_quality_occurrences enable row level security;

revoke all on app.aud_ronda_quality_sessions from anon;
revoke all on app.aud_ronda_quality_sessions from authenticated;
revoke all on app.aud_ronda_quality_occurrences from anon;
revoke all on app.aud_ronda_quality_occurrences from authenticated;

grant select, insert on app.aud_ronda_quality_sessions to authenticated;
grant select, insert, update on app.aud_ronda_quality_occurrences to authenticated;

drop policy if exists p_aud_ronda_quality_sessions_select on app.aud_ronda_quality_sessions;
drop policy if exists p_aud_ronda_quality_sessions_insert on app.aud_ronda_quality_sessions;
drop policy if exists p_aud_ronda_quality_occurrences_select on app.aud_ronda_quality_occurrences;
drop policy if exists p_aud_ronda_quality_occurrences_insert on app.aud_ronda_quality_occurrences;
drop policy if exists p_aud_ronda_quality_occurrences_update on app.aud_ronda_quality_occurrences;

create policy p_aud_ronda_quality_sessions_select
on app.aud_ronda_quality_sessions
for select
using (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_aud_ronda_quality_sessions_insert
on app.aud_ronda_quality_sessions
for insert
with check (
    authz.session_is_recent(6)
    and auditor_id = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_aud_ronda_quality_occurrences_select
on app.aud_ronda_quality_occurrences
for select
using (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_aud_ronda_quality_occurrences_insert
on app.aud_ronda_quality_occurrences
for insert
with check (
    authz.session_is_recent(6)
    and created_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_aud_ronda_quality_occurrences_update
on app.aud_ronda_quality_occurrences
for update
using (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
)
with check (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create or replace function public.rpc_ronda_quality_zone_list(
    p_cd integer default null,
    p_zone_type text default null,
    p_month_ref date default null,
    p_search text default null
)
returns table (
    cd integer,
    month_ref date,
    zone_type text,
    zona text,
    total_enderecos integer,
    produtos_unicos integer,
    enderecos_com_ocorrencia integer,
    percentual_conformidade numeric,
    audited_in_month boolean,
    total_auditorias integer,
    last_audit_at timestamptz,
    total_colunas integer,
    total_niveis integer
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zone_type text;
    v_month_ref date;
    v_search text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_zone_type := upper(trim(coalesce(p_zone_type, '')));
    if v_zone_type not in ('SEP', 'PUL') then
        raise exception 'ZONE_TYPE_INVALIDO';
    end if;

    v_cd := app.ronda_quality_resolve_cd(p_cd);
    v_month_ref := app.ronda_quality_resolve_month_ref(p_month_ref);
    v_search := upper(trim(coalesce(p_search, '')));
    if v_search = '' then
        v_search := null;
    end if;

    return query
    with base_rows as (
        select
            d.cd,
            app.ronda_quality_normalize_zone(d.endereco, v_zone_type) as zona,
            upper(trim(d.endereco)) as endereco,
            d.coddv,
            app.ronda_quality_normalize_column(d.endereco) as coluna,
            nullif(trim(coalesce(d.andar, '')), '') as nivel
        from app.db_end d
        where d.cd = v_cd
          and upper(trim(coalesce(d.tipo, ''))) = v_zone_type
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
    ),
    filtered_base as (
        select *
        from base_rows
        where zona is not null
          and (v_search is null or zona like '%' || v_search || '%')
    ),
    zone_base as (
        select
            v_cd as cd,
            v_month_ref as month_ref,
            v_zone_type as zone_type,
            b.zona,
            count(distinct b.endereco)::integer as total_enderecos,
            count(distinct b.coddv)::integer as produtos_unicos,
            (count(distinct b.coluna) filter (where b.coluna is not null))::integer as total_colunas,
            (count(distinct b.nivel) filter (where b.nivel is not null))::integer as total_niveis
        from filtered_base b
        group by b.zona
    ),
    occurrence_stats as (
        select
            o.zona,
            count(distinct upper(trim(o.endereco)))::integer as enderecos_com_ocorrencia
        from app.aud_ronda_quality_occurrences o
        where o.cd = v_cd
          and o.zone_type = v_zone_type
          and o.month_ref = v_month_ref
        group by o.zona
    ),
    session_stats as (
        select
            s.zona,
            count(*)::integer as total_auditorias,
            max(s.created_at) as last_audit_at
        from app.aud_ronda_quality_sessions s
        where s.cd = v_cd
          and s.zone_type = v_zone_type
          and s.month_ref = v_month_ref
        group by s.zona
    )
    select
        zb.cd,
        zb.month_ref,
        zb.zone_type,
        zb.zona,
        zb.total_enderecos,
        zb.produtos_unicos,
        coalesce(os.enderecos_com_ocorrencia, 0) as enderecos_com_ocorrencia,
        case
            when zb.total_enderecos <= 0 then 100::numeric
            else round((((zb.total_enderecos - coalesce(os.enderecos_com_ocorrencia, 0))::numeric / zb.total_enderecos::numeric) * 100)::numeric, 1)
        end as percentual_conformidade,
        coalesce(ss.total_auditorias, 0) > 0 as audited_in_month,
        coalesce(ss.total_auditorias, 0) as total_auditorias,
        ss.last_audit_at,
        coalesce(zb.total_colunas, 0) as total_colunas,
        coalesce(zb.total_niveis, 0) as total_niveis
    from zone_base zb
    left join occurrence_stats os on os.zona = zb.zona
    left join session_stats ss on ss.zona = zb.zona
    order by
        (coalesce(ss.total_auditorias, 0) > 0),
        zb.zona;
end;
$$;

create or replace function public.rpc_ronda_quality_month_options(
    p_cd integer default null
)
returns table (
    month_start date,
    month_label text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_current_month date;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.ronda_quality_resolve_cd(p_cd);
    v_current_month := app.ronda_quality_current_month();

    return query
    with months as (
        select distinct s.month_ref
        from app.aud_ronda_quality_sessions s
        where s.cd = v_cd

        union

        select v_current_month
    )
    select
        m.month_ref as month_start,
        trim(to_char(m.month_ref, 'TMMonth')) || ' de ' || to_char(m.month_ref, 'YYYY') as month_label
    from months m
    order by m.month_ref desc;
end;
$$;

create or replace function public.rpc_ronda_quality_zone_detail(
    p_cd integer default null,
    p_zone_type text default null,
    p_zona text default null,
    p_month_ref date default null
)
returns table (
    cd integer,
    month_ref date,
    zone_type text,
    zona text,
    total_enderecos integer,
    produtos_unicos integer,
    enderecos_com_ocorrencia integer,
    percentual_conformidade numeric,
    audited_in_month boolean,
    total_auditorias integer,
    last_audit_at timestamptz,
    total_colunas integer,
    total_niveis integer,
    column_stats jsonb,
    level_stats jsonb,
    history_rows jsonb
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zone_type text;
    v_zona text;
    v_month_ref date;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_zone_type := upper(trim(coalesce(p_zone_type, '')));
    if v_zone_type not in ('SEP', 'PUL') then
        raise exception 'ZONE_TYPE_INVALIDO';
    end if;

    v_zona := upper(trim(coalesce(p_zona, '')));
    if v_zona = '' then
        raise exception 'ZONA_OBRIGATORIA';
    end if;

    v_cd := app.ronda_quality_resolve_cd(p_cd);
    v_month_ref := app.ronda_quality_resolve_month_ref(p_month_ref);

    return query
    with base_rows as (
        select
            d.cd,
            app.ronda_quality_normalize_zone(d.endereco, v_zone_type) as zona,
            upper(trim(d.endereco)) as endereco,
            d.coddv,
            app.ronda_quality_normalize_column(d.endereco) as coluna,
            nullif(trim(coalesce(d.andar, '')), '') as nivel
        from app.db_end d
        where d.cd = v_cd
          and upper(trim(coalesce(d.tipo, ''))) = v_zone_type
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
    ),
    zone_rows as (
        select *
        from base_rows
        where zona = v_zona
    ),
    zone_summary as (
        select
            count(distinct zr.endereco)::integer as total_enderecos,
            count(distinct zr.coddv)::integer as produtos_unicos,
            (count(distinct zr.coluna) filter (where zr.coluna is not null))::integer as total_colunas,
            (count(distinct zr.nivel) filter (where zr.nivel is not null))::integer as total_niveis
        from zone_rows zr
    ),
    occurrence_stats as (
        select
            count(distinct upper(trim(o.endereco)))::integer as enderecos_com_ocorrencia
        from app.aud_ronda_quality_occurrences o
        where o.cd = v_cd
          and o.zone_type = v_zone_type
          and o.month_ref = v_month_ref
          and o.zona = v_zona
    ),
    session_stats as (
        select
            count(*)::integer as total_auditorias,
            max(s.created_at) as last_audit_at
        from app.aud_ronda_quality_sessions s
        where s.cd = v_cd
          and s.zone_type = v_zone_type
          and s.month_ref = v_month_ref
          and s.zona = v_zona
    ),
    column_stats_rows as (
        select
            zr.coluna,
            count(distinct zr.endereco)::integer as total_enderecos,
            count(distinct zr.coddv)::integer as produtos_unicos
        from zone_rows zr
        where zr.coluna is not null
        group by zr.coluna
        order by zr.coluna
    ),
    level_stats_rows as (
        select
            zr.nivel,
            count(distinct zr.endereco)::integer as total_enderecos,
            count(distinct zr.coddv)::integer as produtos_unicos
        from zone_rows zr
        where zr.nivel is not null
        group by zr.nivel
        order by zr.nivel
    ),
    occurrence_payload as (
        select
            o.audit_id,
            jsonb_agg(
                jsonb_build_object(
                    'occurrence_id', o.occurrence_id,
                    'motivo', o.motivo,
                    'endereco', o.endereco,
                    'nivel', o.nivel,
                    'coluna', o.coluna,
                    'observacao', o.observacao,
                    'correction_status', o.correction_status,
                    'correction_updated_at', o.correction_updated_at,
                    'correction_updated_mat', o.correction_updated_mat,
                    'correction_updated_nome', o.correction_updated_nome,
                    'created_at', o.created_at
                )
                order by o.created_at, o.endereco, o.occurrence_id
            ) as occurrences
        from app.aud_ronda_quality_occurrences o
        where o.cd = v_cd
          and o.zone_type = v_zone_type
          and o.month_ref = v_month_ref
          and o.zona = v_zona
        group by o.audit_id
    ),
    history_payload as (
        select
            coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'audit_id', s.audit_id,
                        'audit_result', s.audit_result,
                        'auditor_nome', s.auditor_nome,
                        'auditor_mat', s.auditor_mat,
                        'created_at', s.created_at,
                        'occurrence_count', jsonb_array_length(coalesce(op.occurrences, '[]'::jsonb)),
                        'occurrences', coalesce(op.occurrences, '[]'::jsonb)
                    )
                    order by s.created_at asc, s.audit_id asc
                ),
                '[]'::jsonb
            ) as rows
        from app.aud_ronda_quality_sessions s
        left join occurrence_payload op on op.audit_id = s.audit_id
        where s.cd = v_cd
          and s.zone_type = v_zone_type
          and s.month_ref = v_month_ref
          and s.zona = v_zona
    )
    select
        v_cd as cd,
        v_month_ref as month_ref,
        v_zone_type as zone_type,
        v_zona as zona,
        coalesce(zs.total_enderecos, 0) as total_enderecos,
        coalesce(zs.produtos_unicos, 0) as produtos_unicos,
        coalesce(os.enderecos_com_ocorrencia, 0) as enderecos_com_ocorrencia,
        case
            when coalesce(zs.total_enderecos, 0) <= 0 then 100::numeric
            else round((((zs.total_enderecos - coalesce(os.enderecos_com_ocorrencia, 0))::numeric / zs.total_enderecos::numeric) * 100)::numeric, 1)
        end as percentual_conformidade,
        coalesce(ss.total_auditorias, 0) > 0 as audited_in_month,
        coalesce(ss.total_auditorias, 0) as total_auditorias,
        ss.last_audit_at,
        coalesce(zs.total_colunas, 0) as total_colunas,
        coalesce(zs.total_niveis, 0) as total_niveis,
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'coluna', csr.coluna,
                        'total_enderecos', csr.total_enderecos,
                        'produtos_unicos', csr.produtos_unicos
                    )
                    order by csr.coluna
                )
                from column_stats_rows csr
            ),
            '[]'::jsonb
        ) as column_stats,
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'nivel', lsr.nivel,
                        'total_enderecos', lsr.total_enderecos,
                        'produtos_unicos', lsr.produtos_unicos
                    )
                    order by lsr.nivel
                )
                from level_stats_rows lsr
            ),
            '[]'::jsonb
        ) as level_stats,
        hp.rows as history_rows
    from zone_summary zs
    cross join occurrence_stats os
    cross join session_stats ss
    cross join history_payload hp;
end;
$$;

create or replace function public.rpc_ronda_quality_submit_audit(
    p_cd integer default null,
    p_zone_type text default null,
    p_zona text default null,
    p_audit_result text default null,
    p_occurrences jsonb default '[]'::jsonb
)
returns table (
    audit_id uuid,
    month_ref date,
    cd integer,
    zone_type text,
    zona text,
    audit_result text,
    occurrence_count integer,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zone_type text;
    v_zona text;
    v_audit_result text;
    v_month_ref date;
    v_profile record;
    v_audit_id uuid;
    v_occurrences jsonb;
    v_item jsonb;
    v_endereco text;
    v_motivo text;
    v_observacao text;
    v_nivel text;
    v_coluna integer;
    v_item_zona text;
    v_inserted integer := 0;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_zone_type := upper(trim(coalesce(p_zone_type, '')));
    if v_zone_type not in ('SEP', 'PUL') then
        raise exception 'ZONE_TYPE_INVALIDO';
    end if;

    v_zona := upper(trim(coalesce(p_zona, '')));
    if v_zona = '' then
        raise exception 'ZONA_OBRIGATORIA';
    end if;

    v_audit_result := lower(trim(coalesce(p_audit_result, '')));
    if v_audit_result not in ('sem_ocorrencia', 'com_ocorrencia') then
        raise exception 'AUDIT_RESULT_INVALIDO';
    end if;

    v_occurrences := coalesce(p_occurrences, '[]'::jsonb);
    if jsonb_typeof(v_occurrences) <> 'array' then
        raise exception 'OCCURRENCES_INVALIDAS';
    end if;
    if v_audit_result = 'sem_ocorrencia' and jsonb_array_length(v_occurrences) > 0 then
        raise exception 'SEM_OCORRENCIA_NAO_ACEITA_ITENS';
    end if;
    if v_audit_result = 'com_ocorrencia' and jsonb_array_length(v_occurrences) <= 0 then
        raise exception 'OCORRENCIA_OBRIGATORIA';
    end if;

    v_cd := app.ronda_quality_resolve_cd(p_cd);
    v_month_ref := app.ronda_quality_current_month();

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    insert into app.aud_ronda_quality_sessions (
        month_ref,
        cd,
        zone_type,
        zona,
        audit_result,
        auditor_id,
        auditor_mat,
        auditor_nome
    )
    values (
        v_month_ref,
        v_cd,
        v_zone_type,
        v_zona,
        v_audit_result,
        v_uid,
        coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
    )
    returning app.aud_ronda_quality_sessions.audit_id, app.aud_ronda_quality_sessions.created_at
    into v_audit_id, created_at;

    if v_audit_result = 'com_ocorrencia' then
        for v_item in select value from jsonb_array_elements(v_occurrences)
        loop
            v_endereco := upper(trim(coalesce(v_item ->> 'endereco', '')));
            v_motivo := trim(coalesce(v_item ->> 'motivo', ''));
            v_observacao := trim(coalesce(v_item ->> 'observacao', ''));
            v_nivel := nullif(trim(coalesce(v_item ->> 'nivel', '')), '');

            if v_endereco = '' then
                raise exception 'ENDERECO_OBRIGATORIO';
            end if;
            if v_motivo = '' then
                raise exception 'MOTIVO_OBRIGATORIO';
            end if;
            if v_observacao = '' then
                raise exception 'OBSERVACAO_OBRIGATORIA';
            end if;
            if v_zone_type = 'PUL' and v_nivel is null then
                raise exception 'NIVEL_OBRIGATORIO_PUL';
            end if;
            if v_zone_type = 'SEP' and v_nivel is not null then
                v_nivel := null;
            end if;

            if v_zone_type = 'SEP' and v_motivo not in (
                'Produto misturado no mesmo bin',
                'Bin com excesso',
                'Bin virado com produto dentro',
                'Produto líquido deitado',
                'Bin sem etiqueta ou sem identificação',
                'Produto sem bin',
                'Envelopado sem sinalização de etiqueta vermelha',
                'Remanejamento sem troca da etiqueta de endereço',
                'Produto não envelopado ou desmembrado no bin'
            ) then
                raise exception 'MOTIVO_INVALIDO_SEP';
            end if;

            if v_zone_type = 'PUL' and v_motivo not in (
                'Produto com escadinha',
                'Produto misturado',
                'Produto com validade misturada',
                'Produto mal armazenado',
                'Produto avariado',
                'Produto vencido',
                'Sem etiqueta de validade',
                'Sem etiqueta de endereço',
                'Sem etiqueta de endereço e validade',
                'Produto sem identificação',
                'Etiqueta manual ilegível',
                'Duas ou mais avarias na mesma caixa'
            ) then
                raise exception 'MOTIVO_INVALIDO_PUL';
            end if;

            v_item_zona := app.ronda_quality_normalize_zone(v_endereco, v_zone_type);
            if v_item_zona is distinct from v_zona then
                raise exception 'ENDERECO_FORA_DA_ZONA';
            end if;

            v_coluna := case when v_zone_type = 'PUL' then app.ronda_quality_normalize_column(v_endereco) else null end;

            insert into app.aud_ronda_quality_occurrences (
                audit_id,
                month_ref,
                cd,
                zone_type,
                zona,
                coluna,
                endereco,
                nivel,
                motivo,
                observacao,
                correction_status,
                created_by
            )
            values (
                v_audit_id,
                v_month_ref,
                v_cd,
                v_zone_type,
                v_zona,
                v_coluna,
                v_endereco,
                v_nivel,
                v_motivo,
                v_observacao,
                'nao_corrigido',
                v_uid
            );

            v_inserted := v_inserted + 1;
        end loop;
    end if;

    audit_id := v_audit_id;
    month_ref := v_month_ref;
    cd := v_cd;
    zone_type := v_zone_type;
    zona := v_zona;
    audit_result := v_audit_result;
    occurrence_count := v_inserted;
    return next;
end;
$$;

create or replace function public.rpc_ronda_quality_occurrence_history(
    p_cd integer default null,
    p_zone_type text default null,
    p_month_ref date default null,
    p_status text default 'todos',
    p_search text default null,
    p_limit integer default 200,
    p_offset integer default 0
)
returns table (
    occurrence_id uuid,
    audit_id uuid,
    month_ref date,
    cd integer,
    zone_type text,
    zona text,
    coluna integer,
    endereco text,
    nivel text,
    motivo text,
    observacao text,
    correction_status text,
    correction_updated_at timestamptz,
    correction_updated_mat text,
    correction_updated_nome text,
    created_at timestamptz,
    auditor_nome text,
    auditor_mat text,
    audit_result text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zone_type text;
    v_month_ref date;
    v_status text;
    v_search text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.ronda_quality_resolve_cd(p_cd);
    v_zone_type := upper(trim(coalesce(p_zone_type, '')));
    if v_zone_type = '' then
        v_zone_type := null;
    elsif v_zone_type not in ('SEP', 'PUL') then
        raise exception 'ZONE_TYPE_INVALIDO';
    end if;

    v_status := lower(trim(coalesce(p_status, 'todos')));
    if v_status not in ('todos', 'corrigido', 'nao_corrigido') then
        raise exception 'CORRECTION_STATUS_INVALIDO';
    end if;

    v_search := upper(trim(coalesce(p_search, '')));
    if v_search = '' then
        v_search := null;
    end if;

    v_month_ref := case when p_month_ref is null then null else app.ronda_quality_resolve_month_ref(p_month_ref) end;

    return query
    select
        o.occurrence_id,
        o.audit_id,
        o.month_ref,
        o.cd,
        o.zone_type,
        o.zona,
        o.coluna,
        o.endereco,
        o.nivel,
        o.motivo,
        o.observacao,
        o.correction_status,
        o.correction_updated_at,
        o.correction_updated_mat,
        o.correction_updated_nome,
        o.created_at,
        s.auditor_nome,
        s.auditor_mat,
        s.audit_result
    from app.aud_ronda_quality_occurrences o
    join app.aud_ronda_quality_sessions s on s.audit_id = o.audit_id
    where o.cd = v_cd
      and (v_zone_type is null or o.zone_type = v_zone_type)
      and (v_month_ref is null or o.month_ref = v_month_ref)
      and (
          v_status = 'todos'
          or (v_status = 'corrigido' and o.correction_status = 'corrigido')
          or (v_status = 'nao_corrigido' and o.correction_status = 'nao_corrigido')
      )
      and (
          v_search is null
          or o.zona like '%' || v_search || '%'
          or upper(trim(o.endereco)) like '%' || v_search || '%'
          or upper(trim(o.motivo)) like '%' || v_search || '%'
          or upper(trim(o.observacao)) like '%' || v_search || '%'
          or upper(trim(coalesce(s.auditor_nome, ''))) like '%' || v_search || '%'
      )
    order by o.month_ref asc, o.created_at asc, o.occurrence_id asc
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

create or replace function public.rpc_ronda_quality_occurrence_set_correction(
    p_occurrence_id uuid,
    p_correction_status text
)
returns table (
    occurrence_id uuid,
    correction_status text,
    correction_updated_at timestamptz,
    correction_updated_mat text,
    correction_updated_nome text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_status text;
    v_profile record;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;
    if p_occurrence_id is null then
        raise exception 'OCCURRENCE_ID_OBRIGATORIO';
    end if;

    v_status := lower(trim(coalesce(p_correction_status, '')));
    if v_status not in ('corrigido', 'nao_corrigido') then
        raise exception 'CORRECTION_STATUS_INVALIDO';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    select o.cd
    into v_cd
    from app.aud_ronda_quality_occurrences o
    where o.occurrence_id = p_occurrence_id;

    if v_cd is null then
        raise exception 'OCCURRENCE_NAO_ENCONTRADA';
    end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    update app.aud_ronda_quality_occurrences o
    set correction_status = v_status,
        correction_updated_at = now(),
        correction_updated_by = v_uid,
        correction_updated_mat = coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        correction_updated_nome = coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
    where o.occurrence_id = p_occurrence_id
    returning
        o.occurrence_id,
        o.correction_status,
        o.correction_updated_at,
        o.correction_updated_mat,
        o.correction_updated_nome;
end;
$$;

grant execute on function public.rpc_ronda_quality_zone_list(integer, text, date, text) to authenticated;
grant execute on function public.rpc_ronda_quality_month_options(integer) to authenticated;
grant execute on function public.rpc_ronda_quality_zone_detail(integer, text, text, date) to authenticated;
grant execute on function public.rpc_ronda_quality_submit_audit(integer, text, text, text, jsonb) to authenticated;
grant execute on function public.rpc_ronda_quality_occurrence_history(integer, text, date, text, text, integer, integer) to authenticated;
grant execute on function public.rpc_ronda_quality_occurrence_set_correction(uuid, text) to authenticated;
