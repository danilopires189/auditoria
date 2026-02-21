drop function if exists public.rpc_pvps_admin_rules_active_list(integer, text);

create function public.rpc_pvps_admin_rules_active_list(
    p_cd integer default null,
    p_modulo text default 'ambos'
)
returns table (
    rule_id uuid,
    cd integer,
    modulo text,
    rule_kind text,
    target_type text,
    target_value text,
    priority_value integer,
    created_by uuid,
    created_by_mat text,
    created_by_nome text,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_modulo text;
begin
    perform app.pvps_admin_assert();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_modulo := app.pvps_admin_normalize_modulo(p_modulo);

    return query
    select
        r.rule_id,
        r.cd,
        r.modulo,
        r.rule_kind,
        r.target_type,
        r.target_value,
        r.priority_value,
        r.created_by,
        nullif(trim(coalesce(p.mat, '')), '') as created_by_mat,
        nullif(trim(coalesce(p.nome, '')), '') as created_by_nome,
        r.created_at
    from app.pvps_admin_rules r
    left join authz.profiles p on p.user_id = r.created_by
    where r.cd = v_cd
      and r.active
      and (v_modulo = 'ambos' or r.modulo = v_modulo)
    order by
      case r.rule_kind when 'blacklist' then 0 else 1 end,
      coalesce(r.priority_value, 9999),
      r.target_type,
      r.target_value,
      r.created_at desc;
end;
$$;

drop function if exists public.rpc_pvps_admin_rules_history_list(integer, text, integer, integer);

create function public.rpc_pvps_admin_rules_history_list(
    p_cd integer default null,
    p_modulo text default 'ambos',
    p_limit integer default 250,
    p_offset integer default 0
)
returns table (
    history_id uuid,
    rule_id uuid,
    cd integer,
    modulo text,
    rule_kind text,
    target_type text,
    target_value text,
    priority_value integer,
    action_type text,
    apply_mode text,
    affected_pvps integer,
    affected_alocacao integer,
    actor_user_id uuid,
    actor_user_mat text,
    actor_user_nome text,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_modulo text;
    v_limit integer;
    v_offset integer;
begin
    perform app.pvps_admin_assert();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_modulo := app.pvps_admin_normalize_modulo(p_modulo);
    v_limit := least(greatest(coalesce(p_limit, 250), 1), 1000);
    v_offset := greatest(coalesce(p_offset, 0), 0);

    return query
    select
        h.history_id,
        h.rule_id,
        h.cd,
        h.modulo,
        h.rule_kind,
        h.target_type,
        h.target_value,
        h.priority_value,
        h.action_type,
        h.apply_mode,
        h.affected_pvps,
        h.affected_alocacao,
        h.actor_user_id,
        nullif(trim(coalesce(p.mat, '')), '') as actor_user_mat,
        nullif(trim(coalesce(p.nome, '')), '') as actor_user_nome,
        h.created_at
    from app.pvps_admin_rule_history h
    left join authz.profiles p on p.user_id = h.actor_user_id
    where h.cd = v_cd
      and (v_modulo = 'ambos' or h.modulo = v_modulo)
    order by h.created_at desc
    offset v_offset
    limit v_limit;
end;
$$;

grant execute on function public.rpc_pvps_admin_rules_active_list(integer, text) to authenticated;
grant execute on function public.rpc_pvps_admin_rules_history_list(integer, text, integer, integer) to authenticated;
