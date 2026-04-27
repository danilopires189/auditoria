create or replace function app.almox_norm_codigo(p_codigo text)
returns text
language sql
immutable
as $$
    select regexp_replace(coalesce(p_codigo, ''), '\D', '', 'g');
$$;
