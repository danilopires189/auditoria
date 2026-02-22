create or replace function public.rpc_produtividade_visibility_set(
    p_cd integer,
    p_visibility_mode text
)
returns table (
    cd integer,
    visibility_mode text,
    updated_by uuid,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if authz.user_role(v_uid) <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    v_cd := app.produtividade_resolve_cd(p_cd);
    v_mode := lower(trim(coalesce(p_visibility_mode, '')));

    if v_mode not in ('public_cd', 'owner_only') then
        raise exception 'VISIBILIDADE_INVALIDA';
    end if;

    insert into app.produtividade_cd_settings as st
    select
        v_cd as cd,
        v_mode as visibility_mode,
        v_uid as updated_by,
        now() as updated_at
    on conflict on constraint produtividade_cd_settings_pkey
    do update set
        visibility_mode = excluded.visibility_mode,
        updated_by = excluded.updated_by,
        updated_at = now();

    return query
    select
        s.cd,
        s.visibility_mode,
        s.updated_by,
        s.updated_at
    from app.produtividade_cd_settings s
    where s.cd = v_cd
    limit 1;
end;
$$;

grant execute on function public.rpc_produtividade_visibility_set(integer, text) to authenticated;
