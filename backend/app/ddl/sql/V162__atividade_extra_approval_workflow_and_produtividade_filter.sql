-- Approval workflow for Atividade Extra + produtividade filter for approved-only points.

alter table app.atividade_extra
    add column if not exists approval_status text,
    add column if not exists approved_at timestamptz,
    add column if not exists approved_by uuid,
    add column if not exists approved_by_mat text,
    add column if not exists approved_by_nome text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'ck_atividade_extra_approval_status'
          and conrelid = 'app.atividade_extra'::regclass
    ) then
        alter table app.atividade_extra
            add constraint ck_atividade_extra_approval_status
            check (approval_status in ('pending', 'approved'));
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_atividade_extra_approved_by'
          and conrelid = 'app.atividade_extra'::regclass
    ) then
        alter table app.atividade_extra
            add constraint fk_atividade_extra_approved_by
            foreign key (approved_by) references auth.users(id) on delete set null;
    end if;
end;
$$;

update app.atividade_extra
set approval_status = 'approved'
where approval_status is null;

alter table app.atividade_extra
    alter column approval_status set default 'pending',
    alter column approval_status set not null;

create index if not exists idx_atividade_extra_cd_status_data_inicio
    on app.atividade_extra (cd, approval_status, data_inicio desc, hora_inicio desc);

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
        descricao,
        approval_status,
        approved_at,
        approved_by,
        approved_by_mat,
        approved_by_nome
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
        v_desc,
        'pending',
        null,
        null,
        null,
        null
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

    if coalesce(v_row.approval_status, 'pending') <> 'pending' then
        raise exception 'ATIVIDADE_APROVADA_NAO_EDITAVEL';
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
    v_is_admin boolean;
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

    v_is_admin := authz.user_role(v_uid) = 'admin';

    delete from app.atividade_extra a
    where a.id = p_id
      and authz.can_access_cd(v_uid, a.cd)
      and (a.user_id = v_uid or v_is_admin);

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
          and coalesce(a.approval_status, 'approved') = 'approved'
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
        round(coalesce(sum(b.pontos), 0), 3)::numeric(12,5) as pontos_soma,
        coalesce(sum(b.duracao_segundos), 0)::bigint as tempo_total_segundos,
        app.atividade_extra_hms(coalesce(sum(b.duracao_segundos), 0)::bigint) as tempo_total_hms,
        count(*)::bigint as atividades_count
    from base b
    group by b.user_id
    order by
        round(coalesce(sum(b.pontos), 0), 3) desc,
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
        round(a.pontos, 3)::numeric(9,5) as pontos,
        a.descricao,
        a.created_at,
        a.updated_at,
        (a.user_id = v_uid and coalesce(a.approval_status, 'pending') = 'pending') as can_edit
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
    order by a.data_inicio desc, a.hora_inicio desc, a.created_at desc, a.id desc;
end;
$$;

drop function if exists public.rpc_atividade_extra_entries_v2(integer, uuid);
drop function if exists public.rpc_atividade_extra_pending_entries(integer);
drop function if exists public.rpc_atividade_extra_approve(uuid);

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
        (a.user_id = v_uid and coalesce(a.approval_status, 'pending') = 'pending') as can_edit,
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
    order by a.created_at asc, a.data_inicio asc, a.hora_inicio asc, a.id asc;
end;
$$;

create or replace function public.rpc_atividade_extra_approve(p_id uuid)
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
set row_security = off
as $$
declare
    v_uid uuid;
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

    if authz.user_role(v_uid) <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_id is null then
        raise exception 'ID_OBRIGATORIO';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    select *
    into v_row
    from app.atividade_extra a
    where a.id = p_id
      and authz.can_access_cd(v_uid, a.cd)
    limit 1;

    if v_row.id is null then
        raise exception 'ATIVIDADE_NAO_ENCONTRADA_OU_SEM_ACESSO';
    end if;

    if coalesce(v_row.approval_status, 'pending') = 'approved' then
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
            round(v_row.pontos, 3)::numeric(9,5),
            v_row.descricao,
            'approved'::text,
            v_row.approved_at,
            v_row.approved_by,
            v_row.approved_by_mat,
            v_row.approved_by_nome,
            v_row.created_at,
            v_row.updated_at,
            false,
            true,
            false;
        return;
    end if;

    update app.atividade_extra a
    set
        approval_status = 'approved',
        approved_at = now(),
        approved_by = v_uid,
        approved_by_mat = coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        approved_by_nome = coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
        pontos = app.atividade_extra_points(a.duracao_segundos)::numeric(9,5),
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
        round(v_row.pontos, 3)::numeric(9,5),
        v_row.descricao,
        'approved'::text,
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

grant execute on function public.rpc_atividade_extra_entries_v2(integer, uuid) to authenticated;
grant execute on function public.rpc_atividade_extra_pending_entries(integer) to authenticated;
grant execute on function public.rpc_atividade_extra_approve(uuid) to authenticated;

create or replace function app.produtividade_events_base(
    p_cd integer,
    p_dt_ini date default null,
    p_dt_fim date default null
)
returns table (
    activity_key text,
    activity_label text,
    unit_label text,
    user_id uuid,
    mat text,
    nome text,
    event_date date,
    metric_value numeric(18,3),
    detail text,
    source_ref text,
    event_at timestamptz
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
    with profiles_cd as (
        select
            p.user_id,
            coalesce(nullif(trim(p.mat), ''), '-') as mat,
            coalesce(nullif(trim(p.nome), ''), 'Usuário') as nome,
            app.produtividade_norm_digits(p.mat) as mat_norm,
            app.produtividade_norm_text(p.nome) as nome_norm
        from authz.profiles p
        join authz.user_deposits ud
          on ud.user_id = p.user_id
         and ud.cd = p_cd
    ),
    inventario_enderecos as (
        select
            c.cd,
            c.counted_by as user_id,
            min(c.counted_mat) as mat,
            min(c.counted_nome) as nome,
            c.cycle_date as event_date,
            c.zona,
            upper(c.endereco) as endereco,
            c.etapa::integer as etapa,
            min(c.count_id::text) as source_ref,
            max(c.updated_at) as event_at
        from app.conf_inventario_counts c
        where c.cd = p_cd
        group by
            c.cd,
            c.counted_by,
            c.cycle_date,
            c.zona,
            upper(c.endereco),
            c.etapa
    ),
    prod_vol_src as (
        select
            v.cd,
            coalesce(v.aud, '') as aud,
            coalesce(v.vol_conf, 0) as vol_conf,
            app.produtividade_norm_digits(v.aud) as aud_digits,
            app.produtividade_norm_text(v.aud) as aud_norm,
            timezone('America/Sao_Paulo', now())::date as event_date,
            v.updated_at
        from app.db_prod_vol v
        where v.cd = p_cd
          and coalesce(v.vol_conf, 0) > 0
    ),
    prod_blitz_src as (
        select
            b.cd,
            b.filial,
            b.nr_pedido,
            coalesce(b.auditor, '') as auditor,
            coalesce(b.qtd_un, 0) as qtd_un,
            app.produtividade_norm_digits(b.auditor) as aud_digits,
            app.produtividade_norm_text(b.auditor) as aud_norm,
            coalesce(
                timezone('America/Sao_Paulo', b.dt_conf)::date,
                timezone('America/Sao_Paulo', b.updated_at)::date
            ) as event_date,
            coalesce(b.dt_conf, b.updated_at) as event_at
        from app.db_prod_blitz b
        where b.cd = p_cd
          and coalesce(b.qtd_un, 0) > 0
    )
    select
        e.activity_key,
        e.activity_label,
        e.unit_label,
        e.user_id,
        e.mat,
        e.nome,
        e.event_date,
        e.metric_value,
        e.detail,
        e.source_ref,
        e.event_at
    from (
        select
            'coleta_sku'::text as activity_key,
            'Coleta de Mercadoria'::text as activity_label,
            'sku'::text as unit_label,
            c.user_id,
            c.mat_aud as mat,
            c.nome_aud as nome,
            timezone('America/Sao_Paulo', c.data_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | %s', c.coddv, left(coalesce(c.descricao, ''), 110)) as detail,
            c.id::text as source_ref,
            c.data_hr as event_at
        from app.aud_coleta c
        where c.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', c.data_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', c.data_hr)::date <= p_dt_fim)

        union all

        select
            'pvps_endereco'::text as activity_key,
            'PVPS'::text as activity_label,
            'endereços'::text as unit_label,
            p.auditor_id as user_id,
            p.auditor_mat as mat,
            p.auditor_nome as nome,
            timezone('America/Sao_Paulo', p.dt_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('SEP %s | Coddv %s', p.end_sep, p.coddv) as detail,
            p.audit_id::text as source_ref,
            p.dt_hr as event_at
        from app.aud_pvps p
        where p.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', p.dt_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', p.dt_hr)::date <= p_dt_fim)

        union all

        select
            'atividade_extra_pontos'::text as activity_key,
            'Atividade Extra'::text as activity_label,
            'pontos'::text as unit_label,
            a.user_id,
            a.mat,
            a.nome,
            a.data_inicio as event_date,
            round(coalesce(a.pontos, 0), 3)::numeric(18,3) as metric_value,
            left(coalesce(a.descricao, ''), 160) as detail,
            a.id::text as source_ref,
            a.created_at as event_at
        from app.atividade_extra a
        where a.cd = p_cd
          and coalesce(a.approval_status, 'approved') = 'approved'
          and (p_dt_ini is null or a.data_inicio >= p_dt_ini)
          and (p_dt_fim is null or a.data_inicio <= p_dt_fim)

        union all

        select
            'alocacao_endereco'::text as activity_key,
            'Alocação'::text as activity_label,
            'endereços'::text as unit_label,
            a.auditor_id as user_id,
            a.auditor_mat as mat,
            a.auditor_nome as nome,
            timezone('America/Sao_Paulo', a.dt_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Endereço %s | Coddv %s', a.endereco, a.coddv) as detail,
            a.audit_id::text as source_ref,
            a.dt_hr as event_at
        from app.aud_alocacao a
        where a.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', a.dt_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', a.dt_hr)::date <= p_dt_fim)

        union all

        select
            'entrada_notas_sku'::text as activity_key,
            'Entrada de Notas'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_entrada_notas_itens i
        join app.conf_entrada_notas c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'termo_sku'::text as activity_key,
            'Conferência de Termo'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_termo_itens i
        join app.conf_termo c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'pedido_direto_sku'::text as activity_key,
            'Conferência Pedido Direto'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_pedido_direto_itens i
        join app.conf_pedido_direto c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'zerados_endereco'::text as activity_key,
            'Inventário (Zerados)'::text as activity_label,
            'endereços'::text as unit_label,
            z.user_id,
            z.mat,
            z.nome,
            z.event_date,
            1::numeric(18,3) as metric_value,
            format('Zona %s | Endereço %s | Etapa %s', z.zona, z.endereco, z.etapa) as detail,
            z.source_ref,
            z.event_at
        from inventario_enderecos z
        where (p_dt_ini is null or z.event_date >= p_dt_ini)
          and (p_dt_fim is null or z.event_date <= p_dt_fim)

        union all

        select
            'devolucao_nfd'::text as activity_key,
            'Devolução de Mercadoria'::text as activity_label,
            'nfd'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) as event_date,
            1::numeric(18,3) as metric_value,
            coalesce(
                format('NFD %s', c.nfd::text),
                format('Chave %s', nullif(trim(coalesce(c.chave, '')), '')),
                format('Ref %s', left(c.conf_id::text, 8))
            ) as detail,
            c.conf_id::text as source_ref,
            coalesce(c.finalized_at, c.updated_at) as event_at
        from app.conf_devolucao c
        where c.cd = p_cd
          and c.conference_kind = 'com_nfd'
          and c.status in ('finalizado_ok', 'finalizado_falta')
          and (
              p_dt_ini is null
              or coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) >= p_dt_ini
          )
          and (
              p_dt_fim is null
              or coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) <= p_dt_fim
          )

        union all

        select
            'prod_vol_mes'::text as activity_key,
            'Produtividade Volume (base externa)'::text as activity_label,
            'volume'::text as unit_label,
            pr.user_id,
            pr.mat,
            pr.nome,
            v.event_date,
            v.vol_conf::numeric(18,3) as metric_value,
            format('Auditor "%s" | total mensal', nullif(trim(v.aud), '')) as detail,
            format('prod_vol:%s', nullif(trim(v.aud), '')) as source_ref,
            v.updated_at as event_at
        from prod_vol_src v
        join lateral (
            select
                p.user_id,
                p.mat,
                p.nome
            from profiles_cd p
            where (
                v.aud_digits <> ''
                and p.mat_norm = v.aud_digits
            ) or (
                v.aud_norm <> ''
                and p.nome_norm = v.aud_norm
            )
            order by
                case when v.aud_digits <> '' and p.mat_norm = v.aud_digits then 0 else 1 end,
                p.user_id
            limit 1
        ) pr on true
        where (p_dt_ini is null or v.event_date >= p_dt_ini)
          and (p_dt_fim is null or v.event_date <= p_dt_fim)

        union all

        select
            'prod_blitz_un'::text as activity_key,
            'Produtividade Blitz (base externa)'::text as activity_label,
            'unidades'::text as unit_label,
            pr.user_id,
            pr.mat,
            pr.nome,
            b.event_date,
            b.qtd_un::numeric(18,3) as metric_value,
            format('Filial %s | Pedido %s', b.filial::text, b.nr_pedido::text) as detail,
            format('prod_blitz:%s:%s', b.filial::text, b.nr_pedido::text) as source_ref,
            b.event_at
        from prod_blitz_src b
        join lateral (
            select
                p.user_id,
                p.mat,
                p.nome
            from profiles_cd p
            where (
                b.aud_digits <> ''
                and p.mat_norm = b.aud_digits
            ) or (
                b.aud_norm <> ''
                and p.nome_norm = b.aud_norm
            )
            order by
                case when b.aud_digits <> '' and p.mat_norm = b.aud_digits then 0 else 1 end,
                p.user_id
            limit 1
        ) pr on true
        where (p_dt_ini is null or b.event_date >= p_dt_ini)
          and (p_dt_fim is null or b.event_date <= p_dt_fim)
    ) e;
$$;


