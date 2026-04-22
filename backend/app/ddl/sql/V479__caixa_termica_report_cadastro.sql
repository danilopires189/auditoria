create or replace function public.rpc_caixa_termica_report_cadastro(
    p_cd integer default null
)
returns table (
    id uuid,
    codigo text,
    descricao text,
    capacidade_litros integer,
    marca text,
    status text,
    created_at timestamptz,
    created_mat text,
    created_nome text,
    updated_at timestamptz,
    updated_mat text,
    updated_nome text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_role text;
    v_cd integer;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_role := authz.user_role(auth.uid());
    if v_role <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    v_cd := coalesce(
        p_cd,
        (select cd_default from authz.profiles where user_id = auth.uid() limit 1)
    );
    if v_cd is null then
        raise exception 'CD_NAO_DEFINIDO_USUARIO';
    end if;

    if not authz.can_access_cd(auth.uid(), v_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    select
        c.id,
        c.codigo,
        c.descricao,
        c.capacidade_litros,
        c.marca,
        c.status,
        c.created_at,
        c.created_mat,
        c.created_nome,
        c.updated_at,
        c.updated_mat,
        c.updated_nome
    from app.controle_caixa_termica c
    where c.cd = v_cd
      and c.deleted_at is null
    order by c.codigo asc;
end;
$$;

grant execute on function public.rpc_caixa_termica_report_cadastro(integer) to authenticated;
