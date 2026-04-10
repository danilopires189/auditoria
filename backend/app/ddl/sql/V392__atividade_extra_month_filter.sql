drop function if exists public.rpc_atividade_extra_month_options(integer);
create or replace function public.rpc_atividade_extra_month_options(p_cd integer default null)
returns table (
    month_start date,
    month_label text
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
        select a.data_inicio
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
    )
    select
        date_trunc('month', b.data_inicio)::date as month_start,
        to_char(date_trunc('month', b.data_inicio)::date, 'MM/YYYY') as month_label
    from base b
    where b.data_inicio is not null
    group by 1
    order by 1 desc;
end;
$$;

drop function if exists public.rpc_atividade_extra_collaborators(integer);
drop function if exists public.rpc_atividade_extra_collaborators(integer, date);
create or replace function public.rpc_atividade_extra_collaborators(
    p_cd integer default null,
    p_month_start date default null
)
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
    v_month_start date;
    v_month_end date;
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
    v_month_start := date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date;
    v_month_end := (v_month_start + interval '1 month - 1 day')::date;

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
          and a.data_inicio >= v_month_start
          and a.data_inicio <= v_month_end
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

drop function if exists public.rpc_atividade_extra_entries_v2(integer, uuid);
drop function if exists public.rpc_atividade_extra_entries_v2(integer, uuid, date);
create or replace function public.rpc_atividade_extra_entries_v2(
    p_cd integer default null,
    p_target_user_id uuid default null,
    p_month_start date default null
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
    v_month_start date;
    v_month_end date;
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
    v_month_start := date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date;
    v_month_end := (v_month_start + interval '1 month - 1 day')::date;

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
      and a.data_inicio >= v_month_start
      and a.data_inicio <= v_month_end
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

drop function if exists public.rpc_atividade_extra_pending_entries(integer);
drop function if exists public.rpc_atividade_extra_pending_entries(integer, date);
create or replace function public.rpc_atividade_extra_pending_entries(
    p_cd integer default null,
    p_month_start date default null
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
    v_month_start date;
    v_month_end date;
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
    v_month_start := date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date;
    v_month_end := (v_month_start + interval '1 month - 1 day')::date;

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
      and a.data_inicio >= v_month_start
      and a.data_inicio <= v_month_end
      and coalesce(a.approval_status, 'pending') = 'pending'
    order by a.data_inicio desc, a.hora_inicio desc, a.created_at desc, a.id desc;
end;
$$;

grant execute on function public.rpc_atividade_extra_month_options(integer) to authenticated;
grant execute on function public.rpc_atividade_extra_collaborators(integer, date) to authenticated;
grant execute on function public.rpc_atividade_extra_entries_v2(integer, uuid, date) to authenticated;
grant execute on function public.rpc_atividade_extra_pending_entries(integer, date) to authenticated;
