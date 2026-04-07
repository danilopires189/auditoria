create or replace function app.db_end_apply_tipo_default()
returns trigger
language plpgsql
as $$
begin
    new.tipo := app.db_end_normalize_tipo(new.endereco, new.tipo);
    return new;
end;
$$;

drop trigger if exists trg_db_end_apply_tipo_default on app.db_end;

create trigger trg_db_end_apply_tipo_default
before insert or update on app.db_end
for each row execute function app.db_end_apply_tipo_default();

update app.db_end
set tipo = app.db_end_normalize_tipo(endereco, tipo)
where nullif(trim(coalesce(tipo, '')), '') is null
  and nullif(trim(coalesce(endereco, '')), '') is not null;

select app.pvps_alocacao_replenish_if_needed(cd, 'ambos', true, 0, 0)
from generate_series(1, 11) as cd;
