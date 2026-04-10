create or replace function app.apply_runtime_security(p_table text)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    has_cd boolean;
    policy_name text;
    v_cd integer;
begin
    if not exists (
        select 1
        from information_schema.tables
        where table_schema = 'app'
          and table_name = p_table
    ) then
        raise exception 'app table % does not exist', p_table;
    end if;

    execute format('alter table app.%I enable row level security', p_table);
    execute format('revoke all on table app.%I from anon', p_table);
    execute format('revoke insert, update, delete, truncate, references, trigger on table app.%I from authenticated', p_table);
    execute format('grant select on table app.%I to authenticated', p_table);

    policy_name := format('p_%s_select', p_table);
    execute format('drop policy if exists %I on app.%I', policy_name, p_table);

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'app'
          and table_name = p_table
          and column_name = 'cd'
    ) into has_cd;

    if p_table = 'db_barras' then
        execute format(
            'create policy %I on app.%I for select using (authz.can_read_global_dim(auth.uid()))',
            policy_name,
            p_table
        );
    elsif p_table = 'db_transf_cd' then
        execute format(
            'create policy %I on app.%I for select using (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), cd_ori) or authz.can_access_cd(auth.uid(), cd_des))',
            policy_name,
            p_table
        );
    elsif has_cd then
        execute format(
            'create policy %I on app.%I for select using (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), cd))',
            policy_name,
            p_table
        );
    else
        execute format(
            'create policy %I on app.%I for select using (authz.is_admin(auth.uid()))',
            policy_name,
            p_table
        );
    end if;

    if p_table = 'db_end' then
        execute 'drop trigger if exists trg_db_end_apply_tipo_default on app.db_end';
        execute '
            create trigger trg_db_end_apply_tipo_default
            before insert or update on app.db_end
            for each row execute function app.db_end_apply_tipo_default()
        ';

        update app.db_end
        set tipo = app.db_end_normalize_tipo(endereco, tipo)
        where nullif(trim(coalesce(tipo, '''')), '''') is null
          and nullif(trim(coalesce(endereco, '''')), '''') is not null;
    end if;

    if p_table in ('db_end', 'db_estq_entr') then
        for v_cd in 1..11 loop
            perform app.pvps_alocacao_replenish_if_needed(v_cd, 'ambos', true, 0, 0);
        end loop;
    end if;
end;
$$;

select app.apply_runtime_security('db_transf_cd');
