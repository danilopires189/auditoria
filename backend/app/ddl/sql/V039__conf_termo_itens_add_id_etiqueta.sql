alter table app.conf_termo_itens
    add column if not exists id_etiqueta text;

update app.conf_termo_itens i
set id_etiqueta = c.id_etiqueta
from app.conf_termo c
where c.conf_id = i.conf_id
  and (i.id_etiqueta is null or i.id_etiqueta <> c.id_etiqueta);

create or replace function app.conf_termo_itens_fill_id_etiqueta()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_id_etiqueta text;
begin
    if new.conf_id is null then
        raise exception 'CONF_ID_OBRIGATORIO';
    end if;

    select c.id_etiqueta
    into v_id_etiqueta
    from app.conf_termo c
    where c.conf_id = new.conf_id
    limit 1;

    if nullif(trim(coalesce(v_id_etiqueta, '')), '') is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    new.id_etiqueta := v_id_etiqueta;
    return new;
end;
$$;

drop trigger if exists trg_conf_termo_itens_fill_id_etiqueta on app.conf_termo_itens;
create trigger trg_conf_termo_itens_fill_id_etiqueta
before insert or update of conf_id, id_etiqueta
on app.conf_termo_itens
for each row
execute function app.conf_termo_itens_fill_id_etiqueta();

alter table app.conf_termo_itens
    alter column id_etiqueta set not null;

create index if not exists idx_conf_termo_itens_id_etiqueta
    on app.conf_termo_itens(id_etiqueta);

create index if not exists idx_conf_termo_itens_conf_etiqueta
    on app.conf_termo_itens(conf_id, id_etiqueta);
