-- Reaplica a correção de relatórios para ambientes que ainda estejam com as
-- versões antigas dos RPCs, onde apenas admin global conseguia passar pelas
-- validações de relatório.

create or replace function authz.resolve_admin_report_cd(
    p_user_id uuid,
    p_cd integer
)
returns integer
language plpgsql
stable
security definer
set search_path = authz, public
as $$
begin
    if p_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if coalesce(authz.user_role(p_user_id), '') <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    if not authz.can_access_cd(p_user_id, p_cd) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return p_cd;
end;
$$;

grant execute on function authz.resolve_admin_report_cd(uuid, integer) to authenticated;

do $$
declare
    v_signature text;
    v_sql text;
begin
    foreach v_signature in array array[
        'public.rpc_conf_entrada_notas_report_count(date,date,integer)',
        'public.rpc_conf_entrada_notas_report_rows(date,date,integer,integer,integer)',
        'public.rpc_conf_entrada_notas_report_contributors(date,date,integer)',
        'public.rpc_conf_termo_report_count(date,date,integer)',
        'public.rpc_conf_termo_report_rows(date,date,integer,integer,integer)',
        'public.rpc_conf_pedido_direto_report_count(date,date,integer)',
        'public.rpc_conf_pedido_direto_report_rows(date,date,integer,integer,integer)',
        'public.rpc_conf_volume_avulso_report_count(date,date,integer)',
        'public.rpc_conf_volume_avulso_report_rows(date,date,integer,integer,integer)'
    ]
    loop
        select pg_get_functiondef(to_regprocedure(v_signature))
        into v_sql;

        if v_sql is null then
            raise exception 'REPORT_FUNCTION_NOT_FOUND: %', v_signature;
        end if;

        v_sql := regexp_replace(
            v_sql,
            $old$
                if not authz\.is_admin\(v_uid\) then
                    \s+raise exception 'APENAS_ADMIN';
                    \s+end if;
            $old$,
            $new$
                if coalesce(authz.user_role(v_uid), '') <> 'admin' then
                    raise exception 'APENAS_ADMIN';
                end if;
            $new$,
            'ix'
        );

        v_sql := regexp_replace(
            v_sql,
            $old$v_cd := app\.[a-z_]+_resolve_cd\(p_cd\);$old$,
            $new$v_cd := authz.resolve_admin_report_cd(v_uid, p_cd);$new$,
            'i'
        );

        v_sql := regexp_replace(v_sql, ';\s*$', '');

        execute v_sql;
    end loop;
end;
$$;
