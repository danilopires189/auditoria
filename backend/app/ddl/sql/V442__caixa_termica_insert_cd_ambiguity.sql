-- Corrige ambiguidade entre a coluna app.controle_caixa_termica.cd
-- e a coluna de retorno cd da RPC de cadastro.

create or replace function public.rpc_caixa_termica_insert(
    p_cd          integer default null,
    p_codigo      text    default null,
    p_descricao   text    default null,
    p_observacoes text    default null,
    p_user_id     uuid    default null,
    p_mat         text    default null,
    p_nome        text    default null
)
returns table (
    id          uuid,
    cd          integer,
    codigo      text,
    descricao   text,
    observacoes text,
    status      text,
    created_at  timestamptz,
    created_by  uuid,
    updated_at  timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid     uuid;
    v_cd      integer;
    v_codigo  text;
    v_new_id  uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := coalesce(p_cd, (
        select cd_default from authz.profiles where user_id = v_uid limit 1
    ));
    if v_cd is null then raise exception 'CD_NAO_DEFINIDO_USUARIO'; end if;

    v_codigo := nullif(trim(upper(coalesce(p_codigo, ''))), '');
    if v_codigo is null then raise exception 'CODIGO_OBRIGATORIO'; end if;
    if nullif(trim(coalesce(p_descricao, '')), '') is null then
        raise exception 'DESCRICAO_OBRIGATORIA';
    end if;

    if exists (
        select 1
        from app.controle_caixa_termica c
        where c.cd = v_cd
          and upper(trim(c.codigo)) = v_codigo
    ) then
        raise exception 'CAIXA_JA_CADASTRADA';
    end if;

    insert into app.controle_caixa_termica (cd, codigo, descricao, observacoes, status, created_by)
    values (v_cd, v_codigo, trim(p_descricao), nullif(trim(coalesce(p_observacoes, '')), ''), 'disponivel', v_uid)
    returning app.controle_caixa_termica.id into v_new_id;

    return query
    select c.id, c.cd, c.codigo, c.descricao, c.observacoes, c.status, c.created_at, c.created_by, c.updated_at
    from app.controle_caixa_termica c
    where c.id = v_new_id;
end;
$$;

grant execute on function public.rpc_caixa_termica_insert(integer, text, text, text, uuid, text, text) to authenticated;
