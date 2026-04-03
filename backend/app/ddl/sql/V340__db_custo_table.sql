create table if not exists app.db_custo (
    coddv integer not null,
    custo numeric,
    updated_at timestamptz not null default now(),
    constraint uq_app_db_custo unique (coddv)
);

create index if not exists idx_app_db_custo_coddv
    on app.db_custo(coddv);

alter table app.db_custo enable row level security;

revoke all on table app.db_custo from anon;
revoke insert, update, delete, truncate, references, trigger on table app.db_custo from authenticated;
grant select on table app.db_custo to authenticated;

drop policy if exists p_db_custo_select on app.db_custo;

create policy p_db_custo_select
    on app.db_custo
    for select
    using (authz.session_is_recent(6) and authz.can_read_global_dim(auth.uid()));
