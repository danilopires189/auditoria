do $$
declare
    v_constraint record;
begin
    for v_constraint in
        select c.conname
        from pg_constraint c
        join pg_class t
          on t.oid = c.conrelid
        join pg_namespace n
          on n.oid = t.relnamespace
        where n.nspname = 'app'
          and t.relname = 'db_prod_vol'
          and c.contype = 'u'
          and pg_get_constraintdef(c.oid) = 'UNIQUE (cd, aud)'
    loop
        execute format(
            'alter table app.db_prod_vol drop constraint %I',
            v_constraint.conname
        );
    end loop;
end $$;
