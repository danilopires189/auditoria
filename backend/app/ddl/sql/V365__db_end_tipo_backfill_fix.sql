create or replace function app.db_end_normalize_tipo(
    p_endereco text,
    p_tipo text default null
)
returns text
language sql
immutable
as $$
    select case
        when upper(trim(coalesce(p_tipo, ''))) in ('SEP', 'PUL') then upper(trim(coalesce(p_tipo, '')))
        when nullif(trim(coalesce(p_endereco, '')), '') is null then null
        when split_part(upper(trim(coalesce(p_endereco, ''))), ' ', 1) like 'P%' then 'PUL'
        else 'SEP'
    end
$$;

update app.db_end
set tipo = app.db_end_normalize_tipo(endereco, tipo)
where nullif(trim(coalesce(tipo, '')), '') is null
  and nullif(trim(coalesce(endereco, '')), '') is not null;
