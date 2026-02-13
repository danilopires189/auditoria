create table if not exists authz.identity_challenges (
    challenge_id uuid primary key default gen_random_uuid(),
    purpose text not null check (purpose in ('register', 'reset_password')),
    mat text not null,
    dt_nasc date not null,
    dt_adm date not null,
    nome text not null,
    cargo text not null,
    role_suggested text not null check (role_suggested in ('admin', 'auditor')),
    cd_default integer,
    cds integer[] not null default '{}',
    expires_at timestamptz not null default (now() + interval '15 minutes'),
    consumed_at timestamptz,
    created_at timestamptz not null default now(),
    created_by uuid,
    created_ip inet default inet_client_addr()
);

create index if not exists idx_authz_identity_challenges_purpose_expires
    on authz.identity_challenges(purpose, expires_at desc);
create index if not exists idx_authz_identity_challenges_mat
    on authz.identity_challenges(mat);
create index if not exists idx_authz_identity_challenges_open
    on authz.identity_challenges(consumed_at)
    where consumed_at is null;

revoke all on authz.identity_challenges from public;
revoke all on authz.identity_challenges from anon;
revoke all on authz.identity_challenges from authenticated;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'uq_authz_profiles_mat'
    ) then
        alter table authz.profiles
            add constraint uq_authz_profiles_mat unique (mat);
    end if;
end
$$;

create index if not exists idx_app_db_usuario_identity
    on app.db_usuario(mat, dt_nasc, dt_adm);

create or replace function authz.normalize_mat(p_mat text)
returns text
language sql
immutable
as $$
    select regexp_replace(coalesce(p_mat, ''), '[^0-9]', '', 'g');
$$;

create or replace function authz.role_from_cargo(p_cargo text)
returns text
language sql
stable
as $$
    select case
        when upper(trim(coalesce(p_cargo, ''))) like 'SUPER%' then 'admin'
        else 'auditor'
    end;
$$;

create or replace function authz.session_is_recent(p_max_hours integer default 6)
returns boolean
language plpgsql
stable
as $$
declare
    v_iat bigint;
    v_issued_at timestamptz;
begin
    if auth.uid() is null then
        return false;
    end if;

    begin
        v_iat := nullif(auth.jwt() ->> 'iat', '')::bigint;
    exception
        when others then
            return false;
    end;

    if v_iat is null then
        return false;
    end if;

    v_issued_at := to_timestamp(v_iat);
    return now() <= v_issued_at + make_interval(hours => greatest(p_max_hours, 1));
end;
$$;

create or replace function authz.start_identity_challenge(
    p_mat text,
    p_dt_nasc date,
    p_dt_adm date,
    p_purpose text default 'register'
)
returns table (
    challenge_id uuid,
    nome text,
    cargo text,
    role_suggested text,
    cd_default integer,
    cds integer[],
    expires_at timestamptz
)
language plpgsql
security definer
set search_path = authz, app, public
as $$
declare
    v_mat text;
    v_nome text;
    v_cargo text;
    v_cd_default integer;
    v_cds integer[];
    v_role text;
    v_challenge_id uuid;
    v_expires_at timestamptz;
begin
    v_mat := authz.normalize_mat(p_mat);

    if v_mat = '' then
        raise exception 'MATRICULA_INVALIDA';
    end if;

    if p_purpose not in ('register', 'reset_password') then
        raise exception 'PURPOSE_INVALIDO';
    end if;

    select
        min(u.nome),
        min(u.cargo),
        min(u.cd),
        array_agg(distinct u.cd order by u.cd)
    into
        v_nome,
        v_cargo,
        v_cd_default,
        v_cds
    from app.db_usuario u
    where authz.normalize_mat(u.mat) = v_mat
      and u.dt_nasc = p_dt_nasc
      and u.dt_adm = p_dt_adm;

    if v_nome is null then
        raise exception 'MATRICULA_OU_DATAS_INVALIDAS';
    end if;

    if p_purpose = 'register' and exists (
        select 1
        from authz.profiles p
        where authz.normalize_mat(p.mat) = v_mat
    ) then
        raise exception 'MATRICULA_JA_CADASTRADA';
    end if;

    if p_purpose = 'reset_password' and not exists (
        select 1
        from authz.profiles p
        where authz.normalize_mat(p.mat) = v_mat
    ) then
        raise exception 'USUARIO_NAO_CADASTRADO';
    end if;

    v_role := authz.role_from_cargo(v_cargo);

    insert into authz.identity_challenges (
        purpose,
        mat,
        dt_nasc,
        dt_adm,
        nome,
        cargo,
        role_suggested,
        cd_default,
        cds,
        created_by
    )
    values (
        p_purpose,
        v_mat,
        p_dt_nasc,
        p_dt_adm,
        v_nome,
        v_cargo,
        v_role,
        v_cd_default,
        coalesce(v_cds, '{}'),
        auth.uid()
    )
    returning
        authz.identity_challenges.challenge_id,
        authz.identity_challenges.expires_at
    into
        v_challenge_id,
        v_expires_at;

    return query
    select
        v_challenge_id,
        v_nome,
        v_cargo,
        v_role,
        v_cd_default,
        coalesce(v_cds, '{}'),
        v_expires_at;
end;
$$;

create or replace function authz.complete_registration(p_challenge_id uuid)
returns table (
    user_id uuid,
    mat text,
    nome text,
    role text,
    cd_default integer,
    cds integer[]
)
language plpgsql
security definer
set search_path = authz, app, public
as $$
declare
    v_challenge authz.identity_challenges%rowtype;
    v_existing_user_id uuid;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    select *
    into v_challenge
    from authz.identity_challenges c
    where c.challenge_id = p_challenge_id
      and c.purpose = 'register'
    for update;

    if not found then
        raise exception 'CHALLENGE_INVALIDO';
    end if;

    if v_challenge.consumed_at is not null then
        raise exception 'CHALLENGE_JA_CONSUMIDO';
    end if;

    if v_challenge.expires_at < now() then
        raise exception 'CHALLENGE_EXPIRADO';
    end if;

    select p.user_id
    into v_existing_user_id
    from authz.profiles p
    where authz.normalize_mat(p.mat) = authz.normalize_mat(v_challenge.mat)
    limit 1;

    if v_existing_user_id is not null and v_existing_user_id <> auth.uid() then
        raise exception 'MATRICULA_JA_CADASTRADA';
    end if;

    insert into authz.profiles (
        user_id,
        nome,
        mat,
        role,
        cd_default,
        created_at
    )
    values (
        auth.uid(),
        v_challenge.nome,
        v_challenge.mat,
        v_challenge.role_suggested,
        v_challenge.cd_default,
        now()
    )
    on conflict (user_id)
    do update set
        nome = excluded.nome,
        mat = excluded.mat,
        role = excluded.role,
        cd_default = excluded.cd_default;

    delete from authz.user_deposits
    where user_id = auth.uid();

    insert into authz.user_deposits (
        user_id,
        cd,
        created_at
    )
    select
        auth.uid(),
        cd_item,
        now()
    from unnest(coalesce(v_challenge.cds, '{}')) as cd_item
    on conflict (user_id, cd) do nothing;

    update authz.identity_challenges
    set consumed_at = now()
    where challenge_id = p_challenge_id;

    return query
    select
        auth.uid(),
        v_challenge.mat,
        v_challenge.nome,
        v_challenge.role_suggested,
        v_challenge.cd_default,
        coalesce(v_challenge.cds, '{}');
end;
$$;

create or replace function authz.consume_password_reset_challenge(p_challenge_id uuid)
returns table (
    user_id uuid,
    mat text,
    nome text,
    role text
)
language plpgsql
security definer
set search_path = authz, app, public
as $$
declare
    v_challenge authz.identity_challenges%rowtype;
    v_user_id uuid;
begin
    select *
    into v_challenge
    from authz.identity_challenges c
    where c.challenge_id = p_challenge_id
      and c.purpose = 'reset_password'
    for update;

    if not found then
        raise exception 'CHALLENGE_INVALIDO';
    end if;

    if v_challenge.consumed_at is not null then
        raise exception 'CHALLENGE_JA_CONSUMIDO';
    end if;

    if v_challenge.expires_at < now() then
        raise exception 'CHALLENGE_EXPIRADO';
    end if;

    select p.user_id
    into v_user_id
    from authz.profiles p
    where authz.normalize_mat(p.mat) = authz.normalize_mat(v_challenge.mat)
    limit 1;

    if v_user_id is null then
        raise exception 'USUARIO_NAO_CADASTRADO';
    end if;

    update authz.identity_challenges
    set consumed_at = now()
    where challenge_id = p_challenge_id;

    return query
    select
        v_user_id,
        v_challenge.mat,
        v_challenge.nome,
        v_challenge.role_suggested;
end;
$$;

create or replace function app.apply_runtime_security(p_table text)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    has_cd boolean;
    policy_name text;
begin
    if not exists (
        select 1
        from information_schema.tables
        where table_schema = 'app'
          and table_name = p_table
    ) then
        raise exception 'app table % does not exist', p_table;
    end if;

    execute format('alter table app.%I enable row level security', p_table);
    execute format('revoke all on table app.%I from anon', p_table);
    execute format('revoke insert, update, delete, truncate, references, trigger on table app.%I from authenticated', p_table);
    execute format('grant select on table app.%I to authenticated', p_table);

    policy_name := format('p_%s_select', p_table);
    execute format('drop policy if exists %I on app.%I', policy_name, p_table);

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'app'
          and table_name = p_table
          and column_name = 'cd'
    ) into has_cd;

    if p_table = 'db_barras' then
        execute format(
            'create policy %I on app.%I for select using (authz.session_is_recent(6) and authz.can_read_global_dim(auth.uid()))',
            policy_name,
            p_table
        );
    elsif has_cd then
        execute format(
            'create policy %I on app.%I for select using (authz.session_is_recent(6) and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), cd)))',
            policy_name,
            p_table
        );
    else
        execute format(
            'create policy %I on app.%I for select using (authz.session_is_recent(6) and authz.is_admin(auth.uid()))',
            policy_name,
            p_table
        );
    end if;
end;
$$;

select app.apply_runtime_security('db_entrada_notas');
select app.apply_runtime_security('db_avulso');
select app.apply_runtime_security('db_usuario');
select app.apply_runtime_security('db_barras');
select app.apply_runtime_security('db_devolucao');
select app.apply_runtime_security('db_pedido_direto');
select app.apply_runtime_security('db_termo');

grant execute on function authz.normalize_mat(text) to authenticated;
grant execute on function authz.role_from_cargo(text) to authenticated;
grant execute on function authz.session_is_recent(integer) to authenticated;

grant usage on schema authz to anon;
grant execute on function authz.start_identity_challenge(text, date, date, text) to anon;
grant execute on function authz.start_identity_challenge(text, date, date, text) to authenticated;
grant execute on function authz.complete_registration(uuid) to authenticated;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        execute 'grant execute on function authz.consume_password_reset_challenge(uuid) to service_role';
    end if;
end
$$;

