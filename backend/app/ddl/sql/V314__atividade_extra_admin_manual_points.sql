-- Admin manual points flow for Atividade Extra.

alter table app.atividade_extra
    add column if not exists entry_mode text;

update app.atividade_extra
set entry_mode = 'timed'
where entry_mode is null;

alter table app.atividade_extra
    alter column entry_mode set default 'timed',
    alter column entry_mode set not null;

do $$
declare
    v_constraint_name text;
begin
    for v_constraint_name in
        select c.conname
        from pg_constraint c
        where c.conrelid = 'app.atividade_extra'::regclass
          and c.contype = 'c'
          and pg_get_constraintdef(c.oid) ilike '%duracao_segundos > 0%'
    loop
        execute format('alter table app.atividade_extra drop constraint %I', v_constraint_name);
    end loop;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'ck_atividade_extra_duration_non_negative'
          and conrelid = 'app.atividade_extra'::regclass
    ) then
        alter table app.atividade_extra
            add constraint ck_atividade_extra_duration_non_negative
            check (duracao_segundos >= 0);
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'ck_atividade_extra_entry_mode'
          and conrelid = 'app.atividade_extra'::regclass
    ) then
        alter table app.atividade_extra
            add constraint ck_atividade_extra_entry_mode
            check (entry_mode in ('timed', 'manual_points'));
    end if;
end;
$$;

create index if not exists idx_atividade_extra_cd_mode_data_inicio
    on app.atividade_extra (cd, entry_mode, data_inicio desc, created_at desc);

drop function if exists app.atividade_extra_validate_manual_points(date, numeric);
create or replace function app.atividade_extra_validate_manual_points(
    p_data_atividade date,
    p_pontos numeric
)
returns numeric(9,5)
language plpgsql
as $$
declare
    v_now_brt timestamp;
    v_points numeric(9,5);
begin
    if p_data_atividade is null then
        raise exception 'DATA_INICIO_OBRIGATORIA';
    end if;

    if p_pontos is null then
        raise exception 'PONTOS_OBRIGATORIOS';
    end if;

    v_points := round(p_pontos::numeric, 5)::numeric(9,5);
    if v_points <= 0 or v_points > 1.5 then
        raise exception 'PONTOS_FORA_FAIXA';
    end if;

    v_now_brt := timezone('America/Sao_Paulo', now());

    if date_trunc('month', p_data_atividade::timestamp)::date <> date_trunc('month', v_now_brt)::date then
        raise exception 'MES_FORA_DO_ATUAL';
    end if;

    if p_data_atividade > v_now_brt::date then
        raise exception 'FUTURO_NAO_PERMITIDO';
    end if;

    return v_points;
end;
$$;

drop function if exists public.rpc_atividade_extra_assignable_users(integer);
create or replace function public.rpc_atividade_extra_assignable_users(
    p_cd integer default null
)
returns table (
    user_id uuid,
    mat text,
    nome text
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

    return query
    select
        p.user_id,
        coalesce(nullif(trim(coalesce(p.mat, '')), ''), 'SEM_MATRICULA') as mat,
        coalesce(nullif(trim(coalesce(p.nome, '')), ''), 'USUARIO') as nome
    from authz.user_deposits ud
    join authz.profiles p
      on p.user_id = ud.user_id
    where ud.cd = v_cd
      and coalesce(p.role, 'viewer') <> 'viewer'
    order by
        coalesce(nullif(trim(coalesce(p.nome, '')), ''), 'USUARIO'),
        coalesce(nullif(trim(coalesce(p.mat, '')), ''), 'SEM_MATRICULA');
end;
$$;

drop function if exists public.rpc_atividade_extra_insert_admin_points(integer, uuid, date, numeric, text);
create or replace function public.rpc_atividade_extra_insert_admin_points(
    p_cd integer,
    p_target_user_id uuid,
    p_data_atividade date,
    p_pontos numeric,
    p_descricao text
)
returns table (
    id uuid,
    cd integer,
    user_id uuid,
    mat text,
    nome text,
    entry_mode text,
    data_inicio date,
    hora_inicio time,
    data_fim date,
    hora_fim time,
    duracao_segundos integer,
    tempo_gasto_hms text,
    pontos numeric(9,5),
    descricao text,
    approval_status text,
    approved_at timestamptz,
    approved_by uuid,
    approved_by_mat text,
    approved_by_nome text,
    created_at timestamptz,
    updated_at timestamptz,
    can_edit boolean,
    can_delete boolean,
    can_approve boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_desc text;
    v_points numeric(9,5);
    v_admin_profile record;
    v_target_profile record;
    v_row app.atividade_extra%rowtype;
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

    if p_target_user_id is null then
        raise exception 'COLABORADOR_OBRIGATORIO';
    end if;

    v_cd := app.atividade_extra_resolve_cd(p_cd);
    v_desc := nullif(trim(coalesce(p_descricao, '')), '');
    if v_desc is null then
        raise exception 'DESCRICAO_OBRIGATORIA';
    end if;

    v_points := app.atividade_extra_validate_manual_points(p_data_atividade, p_pontos);

    select *
    into v_admin_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_admin_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    select
        p.user_id,
        coalesce(nullif(trim(coalesce(p.mat, '')), ''), 'SEM_MATRICULA') as mat,
        coalesce(nullif(trim(coalesce(p.nome, '')), ''), 'USUARIO') as nome
    into v_target_profile
    from authz.user_deposits ud
    join authz.profiles p
      on p.user_id = ud.user_id
    where ud.cd = v_cd
      and ud.user_id = p_target_user_id
      and coalesce(p.role, 'viewer') <> 'viewer'
    limit 1;

    if v_target_profile.user_id is null then
        raise exception 'COLABORADOR_SEM_ACESSO_CD';
    end if;

    insert into app.atividade_extra (
        cd,
        user_id,
        mat,
        nome,
        entry_mode,
        data_inicio,
        hora_inicio,
        data_fim,
        hora_fim,
        duracao_segundos,
        pontos,
        descricao,
        approval_status,
        approved_at,
        approved_by,
        approved_by_mat,
        approved_by_nome
    )
    values (
        v_cd,
        v_target_profile.user_id,
        v_target_profile.mat,
        v_target_profile.nome,
        'manual_points',
        p_data_atividade,
        time '06:00',
        p_data_atividade,
        time '06:00',
        0,
        v_points,
        v_desc,
        'approved',
        now(),
        v_uid,
        coalesce(nullif(trim(coalesce(v_admin_profile.mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(v_admin_profile.nome, '')), ''), 'USUARIO')
    )
    returning * into v_row;

    return query
    select
        v_row.id,
        v_row.cd,
        v_row.user_id,
        v_row.mat,
        v_row.nome,
        v_row.entry_mode,
        v_row.data_inicio,
        v_row.hora_inicio,
        v_row.data_fim,
        v_row.hora_fim,
        v_row.duracao_segundos,
        app.atividade_extra_hms(v_row.duracao_segundos::bigint),
        round(v_row.pontos, 3)::numeric(9,5),
        v_row.descricao,
        coalesce(v_row.approval_status, 'approved'),
        v_row.approved_at,
        v_row.approved_by,
        v_row.approved_by_mat,
        v_row.approved_by_nome,
        v_row.created_at,
        v_row.updated_at,
        false,
        true,
        false;
end;
$$;

create or replace function public.rpc_atividade_extra_entries_v2(
    p_cd integer default null,
    p_target_user_id uuid default null
)
returns table (
    id uuid,
    cd integer,
    user_id uuid,
    mat text,
    nome text,
    entry_mode text,
    data_inicio date,
    hora_inicio time,
    data_fim date,
    hora_fim time,
    duracao_segundos integer,
    tempo_gasto_hms text,
    pontos numeric(9,5),
    descricao text,
    approval_status text,
    approved_at timestamptz,
    approved_by uuid,
    approved_by_mat text,
    approved_by_nome text,
    created_at timestamptz,
    updated_at timestamptz,
    can_edit boolean,
    can_delete boolean,
    can_approve boolean
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
        coalesce(a.entry_mode, 'timed') as entry_mode,
        a.data_inicio,
        a.hora_inicio,
        a.data_fim,
        a.hora_fim,
        a.duracao_segundos,
        app.atividade_extra_hms(a.duracao_segundos::bigint) as tempo_gasto_hms,
        round(a.pontos, 3)::numeric(9,5) as pontos,
        a.descricao,
        coalesce(a.approval_status, 'approved') as approval_status,
        a.approved_at,
        a.approved_by,
        a.approved_by_mat,
        a.approved_by_nome,
        a.created_at,
        a.updated_at,
        (
            a.user_id = v_uid
            and coalesce(a.approval_status, 'pending') = 'pending'
            and coalesce(a.entry_mode, 'timed') = 'timed'
        ) as can_edit,
        (a.user_id = v_uid or v_is_admin) as can_delete,
        (v_is_admin and coalesce(a.approval_status, 'pending') = 'pending') as can_approve
    from app.atividade_extra a
    where a.cd = v_cd
      and (
          v_is_admin
          or a.user_id = v_uid
          or (
              v_mode = 'public_cd'
              and coalesce(a.approval_status, 'approved') = 'approved'
          )
      )
      and (p_target_user_id is null or a.user_id = p_target_user_id)
    order by
        case when coalesce(a.approval_status, 'approved') = 'pending' then 0 else 1 end,
        a.data_inicio desc,
        a.hora_inicio desc,
        a.created_at desc,
        a.id desc;
end;
$$;

create or replace function public.rpc_atividade_extra_pending_entries(
    p_cd integer default null
)
returns table (
    id uuid,
    cd integer,
    user_id uuid,
    mat text,
    nome text,
    entry_mode text,
    data_inicio date,
    hora_inicio time,
    data_fim date,
    hora_fim time,
    duracao_segundos integer,
    tempo_gasto_hms text,
    pontos numeric(9,5),
    descricao text,
    approval_status text,
    approved_at timestamptz,
    approved_by uuid,
    approved_by_mat text,
    approved_by_nome text,
    created_at timestamptz,
    updated_at timestamptz,
    can_edit boolean,
    can_delete boolean,
    can_approve boolean
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

    return query
    select
        a.id,
        a.cd,
        a.user_id,
        a.mat,
        a.nome,
        coalesce(a.entry_mode, 'timed') as entry_mode,
        a.data_inicio,
        a.hora_inicio,
        a.data_fim,
        a.hora_fim,
        a.duracao_segundos,
        app.atividade_extra_hms(a.duracao_segundos::bigint) as tempo_gasto_hms,
        round(a.pontos, 3)::numeric(9,5) as pontos,
        a.descricao,
        coalesce(a.approval_status, 'pending') as approval_status,
        a.approved_at,
        a.approved_by,
        a.approved_by_mat,
        a.approved_by_nome,
        a.created_at,
        a.updated_at,
        false as can_edit,
        true as can_delete,
        true as can_approve
    from app.atividade_extra a
    where a.cd = v_cd
      and coalesce(a.approval_status, 'pending') = 'pending'
    order by a.data_inicio desc, a.hora_inicio desc, a.created_at desc, a.id desc;
end;
$$;

grant execute on function public.rpc_atividade_extra_assignable_users(integer) to authenticated;
grant execute on function public.rpc_atividade_extra_insert_admin_points(integer, uuid, date, numeric, text) to authenticated;
