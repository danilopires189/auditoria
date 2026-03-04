create index if not exists idx_pvps_admin_rules_live_lookup
    on app.pvps_admin_rules(cd, rule_kind, modulo, target_type, target_value)
    where active and removed_at is null;

create index if not exists idx_pvps_admin_rules_live_list_sort
    on app.pvps_admin_rules(
        cd,
        modulo,
        rule_kind,
        priority_value,
        target_type,
        target_value,
        created_at desc
    )
    where active and removed_at is null;

create index if not exists idx_pvps_admin_rules_not_removed_cd
    on app.pvps_admin_rules(cd)
    where removed_at is null;

drop index if exists app.idx_pvps_admin_rules_cd_active;

create or replace function app.pvps_admin_is_item_blacklisted(
    p_cd integer,
    p_modulo text,
    p_zona text,
    p_coddv integer,
    p_item_key text default null
)
returns boolean
language sql
stable
as $$
    with candidate_rules as (
        select r.rule_id
        from app.pvps_admin_rules r
        where r.active
          and r.removed_at is null
          and r.cd = p_cd
          and r.rule_kind = 'blacklist'
          and r.modulo = any(array['ambos', lower(coalesce(p_modulo, ''))])
          and (
            (r.target_type = 'zona' and r.target_value = upper(trim(coalesce(p_zona, ''))))
            or (r.target_type = 'coddv' and r.target_value = coalesce(p_coddv, 0)::text)
          )
    )
    select exists (
        select 1
        from candidate_rules cr
        where not exists (
            select 1
            from app.pvps_admin_rule_grace g
            where g.rule_id = cr.rule_id
              and g.modulo = lower(coalesce(p_modulo, ''))
              and g.item_key = coalesce(p_item_key, '')
        )
    );
$$;

create or replace function app.pvps_admin_priority_score(
    p_cd integer,
    p_modulo text,
    p_zona text,
    p_coddv integer,
    p_item_key text default null
)
returns integer
language sql
stable
as $$
    select coalesce(min(r.priority_value), 9999)::integer
    from app.pvps_admin_rules r
    where r.active
      and r.removed_at is null
      and r.cd = p_cd
      and r.rule_kind = 'priority'
      and r.modulo = any(array['ambos', lower(coalesce(p_modulo, ''))])
      and (
        (r.target_type = 'zona' and r.target_value = upper(trim(coalesce(p_zona, ''))))
        or (r.target_type = 'coddv' and r.target_value = coalesce(p_coddv, 0)::text)
      )
      and not exists (
          select 1
          from app.pvps_admin_rule_grace g
          where g.rule_id = r.rule_id
            and g.modulo = lower(coalesce(p_modulo, ''))
            and g.item_key = coalesce(p_item_key, '')
      );
$$;

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
      and r.removed_at is null
      and (v_modulo = 'ambos' or r.modulo = v_modulo)
    order by
      r.rule_kind,
      coalesce(r.priority_value, 9999),
      r.target_type,
      r.target_value,
      r.created_at desc;
end;
$$;

grant execute on function public.rpc_pvps_admin_rules_active_list(integer, text) to authenticated;

analyze app.pvps_admin_rules;
