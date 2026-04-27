drop function if exists public.rpc_ctrl_validade_indicadores_zona_ignorada_add(integer, text);

create or replace function public.rpc_ctrl_validade_indicadores_zona_ignorada_add(
    p_cd integer default null,
    p_zona text default null
)
returns table (
    zona text,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zona_key text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if not authz.is_admin(v_uid) then raise exception 'APENAS_ADMIN'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_zona_key := app.ctrl_validade_indicadores_normalize_zona(p_zona);
    if nullif(v_zona_key, '') is null then raise exception 'ZONA_OBRIGATORIA'; end if;

    insert into app.ctrl_validade_indicadores_zonas_ignoradas (cd, zona, created_by)
    values (v_cd, v_zona_key, v_uid)
    on conflict on constraint pk_ctrl_validade_indicadores_zonas_ignoradas do update
    set created_by = excluded.created_by,
        created_at = timezone('utc', now());

    return query
    select ign.zona, ign.created_at
    from app.ctrl_validade_indicadores_zonas_ignoradas ign
    where ign.cd = v_cd and ign.zona = v_zona_key;
end;
$$;

grant execute on function public.rpc_ctrl_validade_indicadores_zona_ignorada_add(integer, text) to authenticated;
