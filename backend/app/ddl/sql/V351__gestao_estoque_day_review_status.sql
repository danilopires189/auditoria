create table if not exists app.gestao_estoque_day_review_events (
    event_id uuid primary key default gen_random_uuid(),
    cd integer not null,
    movement_date date not null,
    review_status text not null check (review_status in ('pendente', 'revisado')),
    actor_id uuid not null references auth.users(id) on delete restrict,
    actor_mat text not null,
    actor_nome text not null,
    reviewed_at timestamptz not null default now()
);

create index if not exists idx_gestao_estoque_day_review_events_cd_date
    on app.gestao_estoque_day_review_events (cd, movement_date desc, reviewed_at desc);

create index if not exists idx_gestao_estoque_day_review_events_actor
    on app.gestao_estoque_day_review_events (actor_id, reviewed_at desc);

alter table app.gestao_estoque_day_review_events enable row level security;

revoke all on table app.gestao_estoque_day_review_events from anon;
revoke all on table app.gestao_estoque_day_review_events from authenticated;

create or replace function app.gestao_estoque_day_review_state_payload(
    p_cd integer,
    p_date date
)
returns table (
    movement_date date,
    review_status text,
    last_reviewed_at timestamptz,
    reviewers jsonb
)
language sql
stable
security definer
set search_path = app, public
as $$
    with latest_event as (
        select
            e.movement_date,
            e.review_status,
            e.reviewed_at
        from app.gestao_estoque_day_review_events e
        where e.cd = p_cd
          and e.movement_date = p_date
        order by e.reviewed_at desc, e.event_id desc
        limit 1
    ),
    latest_per_actor as (
        select distinct on (e.actor_id)
            e.actor_id,
            e.actor_mat,
            e.actor_nome,
            e.review_status,
            e.reviewed_at
        from app.gestao_estoque_day_review_events e
        where e.cd = p_cd
          and e.movement_date = p_date
        order by e.actor_id, e.reviewed_at desc, e.event_id desc
    ),
    reviewers_agg as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'actor_id', l.actor_id,
                    'actor_mat', l.actor_mat,
                    'actor_nome', l.actor_nome,
                    'review_status', l.review_status,
                    'reviewed_at', l.reviewed_at
                )
                order by l.reviewed_at desc, l.actor_nome, l.actor_mat
            ),
            '[]'::jsonb
        ) as rows
        from latest_per_actor l
    )
    select
        p_date as movement_date,
        coalesce(le.review_status, 'pendente') as review_status,
        le.reviewed_at as last_reviewed_at,
        ra.rows as reviewers
    from reviewers_agg ra
    left join latest_event le on true;
$$;

drop function if exists public.rpc_gestao_estoque_day_review_state(integer, date);

create function public.rpc_gestao_estoque_day_review_state(
    p_cd integer default null,
    p_date date default null
)
returns table (
    movement_date date,
    review_status text,
    last_reviewed_at timestamptz,
    reviewers jsonb
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_date date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_date := coalesce(p_date, app.gestao_estoque_today_brasilia());

    return query
    select *
    from app.gestao_estoque_day_review_state_payload(v_cd, v_date);
end;
$$;

drop function if exists public.rpc_gestao_estoque_set_day_review_status(integer, date, text);

create function public.rpc_gestao_estoque_set_day_review_status(
    p_cd integer default null,
    p_date date default null,
    p_status text default 'revisado'
)
returns table (
    movement_date date,
    review_status text,
    last_reviewed_at timestamptz,
    reviewers jsonb
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_date date;
    v_status text;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_date := coalesce(p_date, app.gestao_estoque_today_brasilia());
    v_status := lower(trim(coalesce(p_status, '')));

    if v_status not in ('pendente', 'revisado') then
        raise exception 'REVIEW_STATUS_INVALIDO';
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;

    insert into app.gestao_estoque_day_review_events (
        cd,
        movement_date,
        review_status,
        actor_id,
        actor_mat,
        actor_nome,
        reviewed_at
    )
    values (
        v_cd,
        v_date,
        v_status,
        v_uid,
        coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
        now()
    );

    return query
    select *
    from app.gestao_estoque_day_review_state_payload(v_cd, v_date);
end;
$$;

grant execute on function public.rpc_gestao_estoque_day_review_state(integer, date) to authenticated;
grant execute on function public.rpc_gestao_estoque_set_day_review_status(integer, date, text) to authenticated;
