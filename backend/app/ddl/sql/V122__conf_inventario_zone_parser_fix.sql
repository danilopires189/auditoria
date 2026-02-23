create or replace function app.conf_inventario_zone_from_sep_endereco(p_endereco text)
returns text
language plpgsql
immutable
as $$
declare
    v_endereco text;
    v_match text[];
begin
    v_endereco := upper(nullif(trim(coalesce(p_endereco, '')), ''));
    if v_endereco is null then
        return 'SEM ZONA';
    end if;

    -- Capture the leading alphanumeric zone token and cap it at 4 chars.
    v_match := regexp_match(v_endereco, '^([A-Z0-9]{1,4})');
    if v_match is not null and array_length(v_match, 1) > 0 then
        return v_match[1];
    end if;

    if char_length(v_endereco) <= 4 then
        return v_endereco;
    end if;

    return substring(v_endereco from 1 for 4);
end;
$$;

create or replace function app.conf_inventario_normalize_seed_zones(p_zonas text[])
returns text[]
language sql
immutable
as $$
    select coalesce(
        array_agg(z order by z),
        '{}'::text[]
    )
    from (
        select distinct nullif(app.conf_inventario_zone_from_sep_endereco(v), 'SEM ZONA') as z
        from unnest(coalesce(p_zonas, '{}'::text[])) as u(v)
    ) s
    where s.z is not null;
$$;
