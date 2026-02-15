create table if not exists app.conf_termo (
    conf_id uuid primary key default gen_random_uuid(),
    conf_date date not null default (timezone('America/Sao_Paulo', now()))::date,
    cd integer not null,
    id_etiqueta text not null,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    started_by uuid not null references auth.users(id) on delete restrict,
    started_mat text not null,
    started_nome text not null,
    status text not null default 'em_conferencia'
        check (status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')),
    falta_motivo text,
    started_at timestamptz not null default now(),
    finalized_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint uq_conf_termo_daily unique (conf_date, cd, id_etiqueta)
);

create table if not exists app.conf_termo_itens (
    item_id uuid primary key default gen_random_uuid(),
    conf_id uuid not null references app.conf_termo(conf_id) on delete cascade,
    coddv integer not null,
    descricao text not null,
    qtd_esperada integer not null check (qtd_esperada > 0),
    qtd_conferida integer not null default 0 check (qtd_conferida >= 0),
    updated_at timestamptz not null default now(),
    constraint uq_conf_termo_itens unique (conf_id, coddv)
);

create index if not exists idx_conf_termo_cd_date_status
    on app.conf_termo(cd, conf_date, status);
create index if not exists idx_conf_termo_cd_date_rota_filial
    on app.conf_termo(cd, conf_date, rota, filial);
create index if not exists idx_conf_termo_started_by_date
    on app.conf_termo(started_by, conf_date desc, updated_at desc);
create index if not exists idx_conf_termo_itens_conf
    on app.conf_termo_itens(conf_id);
create index if not exists idx_conf_termo_itens_conf_coddv
    on app.conf_termo_itens(conf_id, coddv);

create index if not exists idx_app_db_termo_cd_etiqueta
    on app.db_termo(cd, id_etiqueta);
create index if not exists idx_app_db_termo_cd_filial_rota
    on app.db_termo(cd, filial, num_rota);

create or replace function app.conf_termo_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_conf_termo_touch_updated_at on app.conf_termo;
create trigger trg_conf_termo_touch_updated_at
before update on app.conf_termo
for each row
execute function app.conf_termo_touch_updated_at();

drop trigger if exists trg_conf_termo_itens_touch_updated_at on app.conf_termo_itens;
create trigger trg_conf_termo_itens_touch_updated_at
before update on app.conf_termo_itens
for each row
execute function app.conf_termo_touch_updated_at();

alter table app.conf_termo enable row level security;
alter table app.conf_termo_itens enable row level security;

revoke all on app.conf_termo from anon;
revoke all on app.conf_termo from authenticated;
revoke all on app.conf_termo_itens from anon;
revoke all on app.conf_termo_itens from authenticated;

drop policy if exists p_conf_termo_select on app.conf_termo;
drop policy if exists p_conf_termo_insert on app.conf_termo;
drop policy if exists p_conf_termo_update on app.conf_termo;
drop policy if exists p_conf_termo_delete on app.conf_termo;

create policy p_conf_termo_select
on app.conf_termo
for select
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_conf_termo_insert
on app.conf_termo
for insert
with check (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_conf_termo_update
on app.conf_termo
for update
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
)
with check (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_conf_termo_delete
on app.conf_termo
for delete
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_termo_itens_select on app.conf_termo_itens;
drop policy if exists p_conf_termo_itens_insert on app.conf_termo_itens;
drop policy if exists p_conf_termo_itens_update on app.conf_termo_itens;
drop policy if exists p_conf_termo_itens_delete on app.conf_termo_itens;

create policy p_conf_termo_itens_select
on app.conf_termo_itens
for select
using (
    exists (
        select 1
        from app.conf_termo c
        where c.conf_id = conf_termo_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_termo_itens_insert
on app.conf_termo_itens
for insert
with check (
    exists (
        select 1
        from app.conf_termo c
        where c.conf_id = conf_termo_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_termo_itens_update
on app.conf_termo_itens
for update
using (
    exists (
        select 1
        from app.conf_termo c
        where c.conf_id = conf_termo_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
)
with check (
    exists (
        select 1
        from app.conf_termo c
        where c.conf_id = conf_termo_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_termo_itens_delete
on app.conf_termo_itens
for delete
using (
    exists (
        select 1
        from app.conf_termo c
        where c.conf_id = conf_termo_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);
