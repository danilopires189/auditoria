create or replace function app.swap_tables(p_table text, p_swap_table text)
returns text
language plpgsql
security definer
set search_path = app, public
as $$
declare
    old_table text;
begin
    old_table := format('__old_%s_%s', p_table, to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'));

    execute format('alter table app.%I rename to %I', p_table, old_table);
    execute format('alter table app.%I rename to %I', p_swap_table, p_table);

    perform app.apply_runtime_security(p_table);

    return old_table;
end;
$$;

create or replace function app.safe_drop_table(p_table text)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
begin
    execute format('drop table if exists app.%I', p_table);
end;
$$;