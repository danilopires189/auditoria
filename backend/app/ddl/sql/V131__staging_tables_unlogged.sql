do $$
declare
    r record;
begin
    for r in
        select tablename
        from pg_tables
        where schemaname = 'staging'
    loop
        execute format('alter table staging.%I set unlogged', r.tablename);
    end loop;
end;
$$;
