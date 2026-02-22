create table if not exists app.atividade_extra (
    id uuid primary key default gen_random_uuid(),
    cd integer not null,
    user_id uuid not null references auth.users(id) on delete restrict,
    mat text not null,
    nome text not null,
    data_inicio date not null,
    hora_inicio time not null,
    data_fim date not null,
    hora_fim time not null,
    duracao_segundos integer not null check (duracao_segundos > 0),
    pontos numeric(9,5) not null check (pontos >= 0 and pontos <= 1.5),
    descricao text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint ck_atividade_extra_mesmo_dia check (data_inicio = data_fim)
);

create table if not exists app.atividade_extra_cd_settings (
    cd integer primary key,
    visibility_mode text not null check (visibility_mode in ('public_cd', 'owner_only')),
    updated_by uuid not null references auth.users(id) on delete restrict,
    updated_at timestamptz not null default now()
);

create index if not exists idx_atividade_extra_cd_data_inicio
    on app.atividade_extra (cd, data_inicio desc, hora_inicio desc);

create index if not exists idx_atividade_extra_user_cd_data_inicio
    on app.atividade_extra (user_id, cd, data_inicio desc, hora_inicio desc);

create index if not exists idx_atividade_extra_cd_user
    on app.atividade_extra (cd, user_id);

create index if not exists idx_atividade_extra_cd_settings_visibility_mode
    on app.atividade_extra_cd_settings (visibility_mode);

create or replace function app.atividade_extra_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_atividade_extra_touch_updated_at on app.atividade_extra;
create trigger trg_atividade_extra_touch_updated_at
before update on app.atividade_extra
for each row
execute function app.atividade_extra_touch_updated_at();

drop trigger if exists trg_atividade_extra_cd_settings_touch_updated_at on app.atividade_extra_cd_settings;
create trigger trg_atividade_extra_cd_settings_touch_updated_at
before update on app.atividade_extra_cd_settings
for each row
execute function app.atividade_extra_touch_updated_at();

alter table app.atividade_extra enable row level security;
alter table app.atividade_extra_cd_settings enable row level security;

revoke all on app.atividade_extra from anon;
revoke all on app.atividade_extra from authenticated;
revoke all on app.atividade_extra_cd_settings from anon;
revoke all on app.atividade_extra_cd_settings from authenticated;

drop policy if exists p_atividade_extra_select on app.atividade_extra;
drop policy if exists p_atividade_extra_insert on app.atividade_extra;
drop policy if exists p_atividade_extra_update on app.atividade_extra;
drop policy if exists p_atividade_extra_delete on app.atividade_extra;

create policy p_atividade_extra_select
on app.atividade_extra
for select
using (
    authz.session_is_recent(6)
    and authz.can_access_cd(auth.uid(), cd)
    and (
        authz.user_role(auth.uid()) = 'admin'
        or user_id = auth.uid()
        or coalesce(
            (
                select s.visibility_mode
                from app.atividade_extra_cd_settings s
                where s.cd = atividade_extra.cd
                limit 1
            ),
            'public_cd'
        ) = 'public_cd'
    )
);

create policy p_atividade_extra_insert
on app.atividade_extra
for insert
with check (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and authz.can_access_cd(auth.uid(), cd)
);

create policy p_atividade_extra_update
on app.atividade_extra
for update
using (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and authz.can_access_cd(auth.uid(), cd)
)
with check (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and authz.can_access_cd(auth.uid(), cd)
);

create policy p_atividade_extra_delete
on app.atividade_extra
for delete
using (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and authz.can_access_cd(auth.uid(), cd)
);

drop policy if exists p_atividade_extra_cd_settings_select on app.atividade_extra_cd_settings;
drop policy if exists p_atividade_extra_cd_settings_insert on app.atividade_extra_cd_settings;
drop policy if exists p_atividade_extra_cd_settings_update on app.atividade_extra_cd_settings;

create policy p_atividade_extra_cd_settings_select
on app.atividade_extra_cd_settings
for select
using (
    authz.session_is_recent(6)
    and authz.can_access_cd(auth.uid(), cd)
);

create policy p_atividade_extra_cd_settings_insert
on app.atividade_extra_cd_settings
for insert
with check (
    authz.session_is_recent(6)
    and authz.user_role(auth.uid()) = 'admin'
    and authz.can_access_cd(auth.uid(), cd)
    and updated_by = auth.uid()
);

create policy p_atividade_extra_cd_settings_update
on app.atividade_extra_cd_settings
for update
using (
    authz.session_is_recent(6)
    and authz.user_role(auth.uid()) = 'admin'
    and authz.can_access_cd(auth.uid(), cd)
)
with check (
    authz.session_is_recent(6)
    and authz.user_role(auth.uid()) = 'admin'
    and authz.can_access_cd(auth.uid(), cd)
    and updated_by = auth.uid()
);

drop function if exists public.rpc_atividade_extra_visibility_get(integer);
drop function if exists public.rpc_atividade_extra_visibility_set(integer, text);
drop function if exists public.rpc_atividade_extra_insert(integer, date, time, date, time, text);
drop function if exists public.rpc_atividade_extra_update(uuid, date, time, date, time, text);
drop function if exists public.rpc_atividade_extra_delete(uuid);
drop function if exists public.rpc_atividade_extra_collaborators(integer);
drop function if exists public.rpc_atividade_extra_entries(integer, uuid);

create or replace function app.atividade_extra_points(p_duration_seconds integer)
returns numeric
language plpgsql
immutable
as $$
declare
    v_duration integer := greatest(coalesce(p_duration_seconds, 0), 0);
    v_result numeric;
begin
    if v_duration < 300 then
        return 0;
    end if;

    if v_duration >= 21600 then
        return 1.5;
    end if;

    v_result := 0.01 + floor((v_duration - 300)::numeric / 1014::numeric) * 0.07095;
    return round(least(v_result, 1.5), 5);
end;
$$;

create or replace function app.atividade_extra_hms(p_duration_seconds bigint)
returns text
language sql
immutable
as $$
    select
        lpad((greatest(coalesce(p_duration_seconds, 0), 0) / 3600)::text, 2, '0')
        || ':'
        || lpad(((greatest(coalesce(p_duration_seconds, 0), 0) % 3600) / 60)::text, 2, '0')
        || ':'
        || lpad((greatest(coalesce(p_duration_seconds, 0), 0) % 60)::text, 2, '0');
$$;

create or replace function app.atividade_extra_resolve_cd(p_cd integer default null)
returns integer
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_role text;
    v_cd integer;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    v_role := coalesce(authz.user_role(v_uid), 'auditor');

    if v_role = 'admin' then
        v_cd := coalesce(
            p_cd,
            v_profile.cd_default,
            (
                select min(u.cd)
                from app.db_usuario u
                where u.cd is not null
            )
        );
    else
        v_cd := coalesce(
            v_profile.cd_default,
            p_cd,
            (
                select min(ud.cd)
                from authz.user_deposits ud
                where ud.user_id = v_uid
            )
        );
    end if;

    if v_cd is null then
        raise exception 'CD_NAO_DEFINIDO_USUARIO';
    end if;

    if not authz.can_access_cd(v_uid, v_cd) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return v_cd;
end;
$$;

create or replace function app.atividade_extra_validate_payload(
    p_data_inicio date,
    p_hora_inicio time,
    p_data_fim date,
    p_hora_fim time
)
returns integer
language plpgsql
as $$
declare
    v_now_brt timestamp;
    v_start_ts timestamp;
    v_end_ts timestamp;
    v_duration integer;
begin
    if p_data_inicio is null then
        raise exception 'DATA_INICIO_OBRIGATORIA';
    end if;

    if p_hora_inicio is null then
        raise exception 'HORA_INICIO_OBRIGATORIA';
    end if;

    if p_data_fim is null then
        raise exception 'DATA_FIM_OBRIGATORIA';
    end if;

    if p_hora_fim is null then
        raise exception 'HORA_FIM_OBRIGATORIA';
    end if;

    if p_data_inicio <> p_data_fim then
        raise exception 'DATA_FIM_DIFERENTE_DATA_INICIO';
    end if;

    if p_hora_inicio < time '06:00' or p_hora_inicio > time '21:30' then
        raise exception 'HORARIO_INICIO_FORA_JANELA';
    end if;

    if p_hora_fim < time '06:00' or p_hora_fim > time '21:30' then
        raise exception 'HORARIO_FIM_FORA_JANELA';
    end if;

    v_now_brt := timezone('America/Sao_Paulo', now());

    if date_trunc('month', p_data_inicio::timestamp)::date <> date_trunc('month', v_now_brt)::date then
        raise exception 'MES_FORA_DO_ATUAL';
    end if;

    v_start_ts := p_data_inicio::timestamp + p_hora_inicio;
    v_end_ts := p_data_fim::timestamp + p_hora_fim;

    if v_end_ts <= v_start_ts then
        raise exception 'INTERVALO_INVALIDO';
    end if;

    if v_start_ts > v_now_brt or v_end_ts > v_now_brt then
        raise exception 'FUTURO_NAO_PERMITIDO';
    end if;

    v_duration := extract(epoch from (v_end_ts - v_start_ts))::integer;
    if v_duration <= 0 then
        raise exception 'INTERVALO_INVALIDO';
    end if;

    return v_duration;
end;
$$;

create or replace function public.rpc_atividade_extra_visibility_get(p_cd integer default null)
returns table (
    cd integer,
    visibility_mode text,
    updated_by uuid,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.atividade_extra_resolve_cd(p_cd);

    return query
    select
        v_cd,
        coalesce(s.visibility_mode, 'public_cd'),
        s.updated_by,
        s.updated_at
    from (
        select st.visibility_mode, st.updated_by, st.updated_at
        from app.atividade_extra_cd_settings st
        where st.cd = v_cd
        limit 1
    ) s
    right join (select 1) d on true;
end;
$$;

create or replace function public.rpc_atividade_extra_visibility_set(
    p_cd integer,
    p_visibility_mode text
)
returns table (
    cd integer,
    visibility_mode text,
    updated_by uuid,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if authz.user_role(v_uid) <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    v_cd := app.atividade_extra_resolve_cd(p_cd);
    v_mode := lower(trim(coalesce(p_visibility_mode, '')));

    if v_mode not in ('public_cd', 'owner_only') then
        raise exception 'VISIBILIDADE_INVALIDA';
    end if;

    insert into app.atividade_extra_cd_settings (
        cd,
        visibility_mode,
        updated_by,
        updated_at
    )
    values (
        v_cd,
        v_mode,
        v_uid,
        now()
    )
    on conflict (cd)
    do update set
        visibility_mode = excluded.visibility_mode,
        updated_by = excluded.updated_by,
        updated_at = now();

    return query
    select
        st.cd,
        st.visibility_mode,
        st.updated_by,
        st.updated_at
    from app.atividade_extra_cd_settings st
    where st.cd = v_cd
    limit 1;
end;
$$;

create or replace function public.rpc_atividade_extra_insert(
    p_cd integer,
    p_data_inicio date,
    p_hora_inicio time,
    p_data_fim date,
    p_hora_fim time,
    p_descricao text
)
returns table (
    id uuid,
    cd integer,
    user_id uuid,
    mat text,
    nome text,
    data_inicio date,
    hora_inicio time,
    data_fim date,
    hora_fim time,
    duracao_segundos integer,
    tempo_gasto_hms text,
    pontos numeric(9,5),
    descricao text,
    created_at timestamptz,
    updated_at timestamptz,
    can_edit boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_duration integer;
    v_points numeric(9,5);
    v_desc text;
    v_profile record;
    v_row app.atividade_extra%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.atividade_extra_resolve_cd(p_cd);
    v_desc := nullif(trim(coalesce(p_descricao, '')), '');
    if v_desc is null then
        raise exception 'DESCRICAO_OBRIGATORIA';
    end if;

    v_duration := app.atividade_extra_validate_payload(
        p_data_inicio,
        p_hora_inicio,
        p_data_fim,
        p_hora_fim
    );
    v_points := app.atividade_extra_points(v_duration)::numeric(9,5);

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    insert into app.atividade_extra (
        cd,
        user_id,
        mat,
        nome,
        data_inicio,
        hora_inicio,
        data_fim,
        hora_fim,
        duracao_segundos,
        pontos,
        descricao
    )
    values (
        v_cd,
        v_uid,
        coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
        p_data_inicio,
        p_hora_inicio,
        p_data_fim,
        p_hora_fim,
        v_duration,
        v_points,
        v_desc
    )
    returning * into v_row;

    return query
    select
        v_row.id,
        v_row.cd,
        v_row.user_id,
        v_row.mat,
        v_row.nome,
        v_row.data_inicio,
        v_row.hora_inicio,
        v_row.data_fim,
        v_row.hora_fim,
        v_row.duracao_segundos,
        app.atividade_extra_hms(v_row.duracao_segundos::bigint),
        v_row.pontos,
        v_row.descricao,
        v_row.created_at,
        v_row.updated_at,
        true;
end;
$$;

create or replace function public.rpc_atividade_extra_update(
    p_id uuid,
    p_data_inicio date,
    p_hora_inicio time,
    p_data_fim date,
    p_hora_fim time,
    p_descricao text
)
returns table (
    id uuid,
    cd integer,
    user_id uuid,
    mat text,
    nome text,
    data_inicio date,
    hora_inicio time,
    data_fim date,
    hora_fim time,
    duracao_segundos integer,
    tempo_gasto_hms text,
    pontos numeric(9,5),
    descricao text,
    created_at timestamptz,
    updated_at timestamptz,
    can_edit boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_duration integer;
    v_points numeric(9,5);
    v_desc text;
    v_row app.atividade_extra%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if p_id is null then
        raise exception 'ID_OBRIGATORIO';
    end if;

    v_desc := nullif(trim(coalesce(p_descricao, '')), '');
    if v_desc is null then
        raise exception 'DESCRICAO_OBRIGATORIA';
    end if;

    select *
    into v_row
    from app.atividade_extra a
    where a.id = p_id
      and a.user_id = v_uid
      and authz.can_access_cd(v_uid, a.cd)
    limit 1;

    if v_row.id is null then
        raise exception 'ATIVIDADE_NAO_ENCONTRADA_OU_SEM_ACESSO';
    end if;

    v_duration := app.atividade_extra_validate_payload(
        p_data_inicio,
        p_hora_inicio,
        p_data_fim,
        p_hora_fim
    );
    v_points := app.atividade_extra_points(v_duration)::numeric(9,5);

    update app.atividade_extra a
    set
        data_inicio = p_data_inicio,
        hora_inicio = p_hora_inicio,
        data_fim = p_data_fim,
        hora_fim = p_hora_fim,
        duracao_segundos = v_duration,
        pontos = v_points,
        descricao = v_desc,
        updated_at = now()
    where a.id = v_row.id
    returning * into v_row;

    return query
    select
        v_row.id,
        v_row.cd,
        v_row.user_id,
        v_row.mat,
        v_row.nome,
        v_row.data_inicio,
        v_row.hora_inicio,
        v_row.data_fim,
        v_row.hora_fim,
        v_row.duracao_segundos,
        app.atividade_extra_hms(v_row.duracao_segundos::bigint),
        v_row.pontos,
        v_row.descricao,
        v_row.created_at,
        v_row.updated_at,
        true;
end;
$$;

create or replace function public.rpc_atividade_extra_delete(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if p_id is null then
        raise exception 'ID_OBRIGATORIO';
    end if;

    delete from app.atividade_extra a
    where a.id = p_id
      and a.user_id = v_uid
      and authz.can_access_cd(v_uid, a.cd);

    if not found then
        raise exception 'ATIVIDADE_NAO_ENCONTRADA_OU_SEM_ACESSO';
    end if;

    return true;
end;
$$;

create or replace function public.rpc_atividade_extra_collaborators(p_cd integer default null)
returns table (
    user_id uuid,
    mat text,
    nome text,
    pontos_soma numeric(12,5),
    tempo_total_segundos bigint,
    tempo_total_hms text,
    atividades_count bigint
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
    v_mode text;
    v_is_admin boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.atividade_extra_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';

    select coalesce(st.visibility_mode, 'public_cd')
    into v_mode
    from app.atividade_extra_cd_settings st
    where st.cd = v_cd
    limit 1;

    v_mode := coalesce(v_mode, 'public_cd');

    return query
    with base as (
        select a.*
        from app.atividade_extra a
        where a.cd = v_cd
          and (
              v_is_admin
              or v_mode = 'public_cd'
              or a.user_id = v_uid
          )
    )
    select
        b.user_id,
        min(b.mat) as mat,
        min(b.nome) as nome,
        coalesce(sum(b.pontos), 0)::numeric(12,5) as pontos_soma,
        coalesce(sum(b.duracao_segundos), 0)::bigint as tempo_total_segundos,
        app.atividade_extra_hms(coalesce(sum(b.duracao_segundos), 0)::bigint) as tempo_total_hms,
        count(*)::bigint as atividades_count
    from base b
    group by b.user_id
    order by
        coalesce(sum(b.pontos), 0) desc,
        coalesce(sum(b.duracao_segundos), 0) desc,
        min(b.nome);
end;
$$;

create or replace function public.rpc_atividade_extra_entries(
    p_cd integer default null,
    p_target_user_id uuid default null
)
returns table (
    id uuid,
    cd integer,
    user_id uuid,
    mat text,
    nome text,
    data_inicio date,
    hora_inicio time,
    data_fim date,
    hora_fim time,
    duracao_segundos integer,
    tempo_gasto_hms text,
    pontos numeric(9,5),
    descricao text,
    created_at timestamptz,
    updated_at timestamptz,
    can_edit boolean
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
    v_mode text;
    v_is_admin boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.atividade_extra_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';

    select coalesce(st.visibility_mode, 'public_cd')
    into v_mode
    from app.atividade_extra_cd_settings st
    where st.cd = v_cd
    limit 1;

    v_mode := coalesce(v_mode, 'public_cd');

    if p_target_user_id is not null
       and p_target_user_id <> v_uid
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    return query
    select
        a.id,
        a.cd,
        a.user_id,
        a.mat,
        a.nome,
        a.data_inicio,
        a.hora_inicio,
        a.data_fim,
        a.hora_fim,
        a.duracao_segundos,
        app.atividade_extra_hms(a.duracao_segundos::bigint) as tempo_gasto_hms,
        a.pontos,
        a.descricao,
        a.created_at,
        a.updated_at,
        (a.user_id = v_uid) as can_edit
    from app.atividade_extra a
    where a.cd = v_cd
      and (
          v_is_admin
          or v_mode = 'public_cd'
          or a.user_id = v_uid
      )
      and (p_target_user_id is null or a.user_id = p_target_user_id)
    order by a.data_inicio desc, a.hora_inicio desc, a.created_at desc, a.id desc;
end;
$$;

grant execute on function public.rpc_atividade_extra_visibility_get(integer) to authenticated;
grant execute on function public.rpc_atividade_extra_visibility_set(integer, text) to authenticated;
grant execute on function public.rpc_atividade_extra_insert(integer, date, time, date, time, text) to authenticated;
grant execute on function public.rpc_atividade_extra_update(uuid, date, time, date, time, text) to authenticated;
grant execute on function public.rpc_atividade_extra_delete(uuid) to authenticated;
grant execute on function public.rpc_atividade_extra_collaborators(integer) to authenticated;
grant execute on function public.rpc_atividade_extra_entries(integer, uuid) to authenticated;
