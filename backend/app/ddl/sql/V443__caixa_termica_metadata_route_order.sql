-- Metadados da caixa térmica, enriquecimento de expedição por etiqueta e admin.

alter table app.controle_caixa_termica
    add column if not exists capacidade_litros integer,
    add column if not exists marca text,
    add column if not exists created_mat text,
    add column if not exists created_nome text,
    add column if not exists updated_by uuid references auth.users(id),
    add column if not exists updated_mat text,
    add column if not exists updated_nome text,
    add column if not exists deleted_at timestamptz,
    add column if not exists deleted_by uuid references auth.users(id),
    add column if not exists deleted_mat text,
    add column if not exists deleted_nome text;

alter table app.controle_caixa_termica_movs
    add column if not exists pedido bigint,
    add column if not exists data_pedido date;

update app.controle_caixa_termica c
set created_mat = coalesce(c.created_mat, p.mat),
    created_nome = coalesce(c.created_nome, p.nome)
from authz.profiles p
where p.user_id = c.created_by
  and (c.created_mat is null or c.created_nome is null);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'chk_caixa_termica_capacidade_litros'
          and conrelid = 'app.controle_caixa_termica'::regclass
    ) then
        alter table app.controle_caixa_termica
            add constraint chk_caixa_termica_capacidade_litros
            check (capacidade_litros is null or capacidade_litros > 0);
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'chk_caixa_termica_marca'
          and conrelid = 'app.controle_caixa_termica'::regclass
    ) then
        alter table app.controle_caixa_termica
            add constraint chk_caixa_termica_marca
            check (marca is null or marca in ('Ecobox', 'Coleman', 'Isopor genérica'));
    end if;
end;
$$;

drop function if exists public.rpc_caixa_termica_list(integer);
drop function if exists public.rpc_caixa_termica_by_codigo(integer, text);
drop function if exists public.rpc_caixa_termica_insert(integer, text, text, text, uuid, text, text);
drop function if exists public.rpc_caixa_termica_insert(integer, text, text, text, integer, text, uuid, text, text);
drop function if exists public.rpc_caixa_termica_expedir(uuid, integer, text, integer, text, text, text, uuid, text, text);
drop function if exists public.rpc_caixa_termica_receber(uuid, integer, text, uuid, text, text);
drop function if exists public.rpc_caixa_termica_historico(uuid);
drop function if exists public.rpc_caixa_termica_feed_diario(integer, date);
drop function if exists public.rpc_caixa_termica_update(uuid, integer, text, text, text, integer, text, uuid, text, text);
drop function if exists public.rpc_caixa_termica_delete(uuid, integer, uuid, text, text);

create or replace function public.rpc_caixa_termica_list(
    p_cd integer default null
)
returns table (
    id uuid, cd integer, codigo text, descricao text, observacoes text,
    capacidade_litros integer, marca text, status text,
    created_at timestamptz, created_by uuid, created_mat text, created_nome text,
    updated_at timestamptz, updated_by uuid, updated_mat text, updated_nome text,
    deleted_at timestamptz, deleted_by uuid, deleted_mat text, deleted_nome text,
    last_mov_tipo text, last_mov_data_hr timestamptz, last_mov_placa text,
    last_mov_rota text, last_mov_filial integer, last_mov_filial_nome text,
    last_mov_pedido bigint, last_mov_data_pedido date,
    last_mov_mat_resp text, last_mov_nome_resp text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := coalesce(p_cd, (select cd_default from authz.profiles where user_id = v_uid limit 1));
    if v_cd is null then raise exception 'CD_NAO_DEFINIDO_USUARIO'; end if;

    return query
    select
        c.id, c.cd, c.codigo, c.descricao, c.observacoes, c.capacidade_litros, c.marca,
        c.status, c.created_at, c.created_by, c.created_mat, c.created_nome,
        c.updated_at, c.updated_by, c.updated_mat, c.updated_nome,
        c.deleted_at, c.deleted_by, c.deleted_mat, c.deleted_nome,
        m.tipo, m.data_hr, m.placa, m.rota, m.filial, m.filial_nome, m.pedido, m.data_pedido,
        m.mat_resp, m.nome_resp
    from app.controle_caixa_termica c
    left join lateral (
        select mv.tipo, mv.data_hr, mv.placa, mv.rota, mv.filial, mv.filial_nome,
               mv.pedido, mv.data_pedido, mv.mat_resp, mv.nome_resp
        from app.controle_caixa_termica_movs mv
        where mv.caixa_id = c.id
        order by mv.data_hr desc
        limit 1
    ) m on true
    where c.cd = v_cd
      and c.deleted_at is null
    order by c.updated_at desc;
end;
$$;

create or replace function public.rpc_caixa_termica_by_codigo(
    p_cd integer default null,
    p_codigo text default null
)
returns table (
    id uuid, cd integer, codigo text, descricao text, observacoes text,
    capacidade_litros integer, marca text, status text,
    created_at timestamptz, created_by uuid, created_mat text, created_nome text,
    updated_at timestamptz, updated_by uuid, updated_mat text, updated_nome text,
    deleted_at timestamptz, deleted_by uuid, deleted_mat text, deleted_nome text,
    last_mov_tipo text, last_mov_data_hr timestamptz, last_mov_placa text,
    last_mov_rota text, last_mov_filial integer, last_mov_filial_nome text,
    last_mov_pedido bigint, last_mov_data_pedido date,
    last_mov_mat_resp text, last_mov_nome_resp text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := coalesce(p_cd, (select cd_default from authz.profiles where user_id = v_uid limit 1));
    if v_cd is null then raise exception 'CD_NAO_DEFINIDO_USUARIO'; end if;
    if nullif(trim(coalesce(p_codigo, '')), '') is null then raise exception 'CODIGO_OBRIGATORIO'; end if;

    return query
    select *
    from public.rpc_caixa_termica_list(v_cd) l
    where upper(trim(l.codigo)) = upper(trim(p_codigo))
    limit 1;
end;
$$;

create or replace function public.rpc_caixa_termica_insert(
    p_cd integer default null,
    p_codigo text default null,
    p_descricao text default null,
    p_observacoes text default null,
    p_capacidade_litros integer default null,
    p_marca text default null,
    p_user_id uuid default null,
    p_mat text default null,
    p_nome text default null
)
returns table (
    id uuid, cd integer, codigo text, descricao text, observacoes text,
    capacidade_litros integer, marca text, status text,
    created_at timestamptz, created_by uuid, created_mat text, created_nome text,
    updated_at timestamptz, updated_by uuid, updated_mat text, updated_nome text,
    deleted_at timestamptz, deleted_by uuid, deleted_mat text, deleted_nome text,
    last_mov_tipo text, last_mov_data_hr timestamptz, last_mov_placa text,
    last_mov_rota text, last_mov_filial integer, last_mov_filial_nome text,
    last_mov_pedido bigint, last_mov_data_pedido date,
    last_mov_mat_resp text, last_mov_nome_resp text
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_codigo text;
    v_marca text;
    v_new_id uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := coalesce(p_cd, (select cd_default from authz.profiles where user_id = v_uid limit 1));
    if v_cd is null then raise exception 'CD_NAO_DEFINIDO_USUARIO'; end if;

    v_codigo := nullif(trim(upper(coalesce(p_codigo, ''))), '');
    if v_codigo is null then raise exception 'CODIGO_OBRIGATORIO'; end if;
    if nullif(trim(coalesce(p_descricao, '')), '') is null then raise exception 'DESCRICAO_OBRIGATORIA'; end if;
    if p_capacidade_litros is null or p_capacidade_litros <= 0 then raise exception 'CAPACIDADE_OBRIGATORIA'; end if;

    v_marca := nullif(trim(coalesce(p_marca, '')), '');
    if v_marca is null then raise exception 'MARCA_OBRIGATORIA'; end if;
    if lower(v_marca) = 'ecobox' then
        v_marca := 'Ecobox';
    elsif lower(v_marca) = 'coleman' then
        v_marca := 'Coleman';
    elsif lower(v_marca) in ('isopor generica', 'isopor genérica') then
        v_marca := 'Isopor genérica';
    else
        raise exception 'MARCA_INVALIDA';
    end if;

    if exists (
        select 1
        from app.controle_caixa_termica c
        where c.cd = v_cd
          and upper(trim(c.codigo)) = v_codigo
    ) then
        raise exception 'CAIXA_JA_CADASTRADA';
    end if;

    insert into app.controle_caixa_termica (
        cd, codigo, descricao, observacoes, capacidade_litros, marca, status,
        created_by, created_mat, created_nome
    )
    values (
        v_cd, v_codigo, trim(p_descricao), nullif(trim(coalesce(p_observacoes, '')), ''),
        p_capacidade_litros, v_marca, 'disponivel',
        v_uid, coalesce(nullif(trim(p_mat), ''), '-'), coalesce(nullif(trim(p_nome), ''), 'Usuário')
    )
    returning app.controle_caixa_termica.id into v_new_id;

    return query
    select *
    from public.rpc_caixa_termica_by_codigo(v_cd, v_codigo);
end;
$$;

create or replace function public.rpc_caixa_termica_expedir(
    p_caixa_id uuid default null,
    p_cd integer default null,
    p_etiqueta_volume text default null,
    p_filial integer default null,
    p_filial_nome text default null,
    p_rota text default null,
    p_placa text default null,
    p_user_id uuid default null,
    p_mat text default null,
    p_nome text default null
)
returns table (
    box_id uuid, box_codigo text, box_status text, box_updated_at timestamptz,
    mov_id uuid, mov_tipo text, mov_data_hr timestamptz, mov_placa text,
    mov_rota text, mov_filial integer, mov_filial_nome text, mov_etiqueta_volume text,
    mov_pedido bigint, mov_data_pedido date
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_status text;
    v_mov_id uuid;
    v_now timestamptz := now();
    v_tag text;
    v_len integer;
    v_current_year integer;
    v_year_text text;
    v_year_num integer;
    v_pedido_text text;
    v_day_num integer;
    v_filial_text text;
    v_filial_num integer;
    v_route_rota text;
    v_route_nome text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_caixa_id is null then raise exception 'CAIXA_ID_OBRIGATORIO'; end if;

    v_cd := coalesce(p_cd, (select cd_default from authz.profiles where user_id = v_uid limit 1));
    if v_cd is null then raise exception 'CD_NAO_DEFINIDO_USUARIO'; end if;

    select c.status into v_status
    from app.controle_caixa_termica c
    where c.id = p_caixa_id
      and c.cd = v_cd
      and c.deleted_at is null
    for update;

    if not found then raise exception 'CAIXA_NAO_ENCONTRADA'; end if;
    if v_status <> 'disponivel' then raise exception 'CAIXA_NAO_DISPONIVEL'; end if;

    v_tag := regexp_replace(coalesce(p_etiqueta_volume, ''), '\s+', '', 'g');
    v_tag := nullif(upper(v_tag), '');
    if v_tag is not null then
        v_len := char_length(v_tag);
        v_current_year := extract(year from timezone('America/Sao_Paulo', now()))::integer;

        if v_len not in (17, 18, 23, 25, 26, 27) then
            raise exception 'ETIQUETA_TAMANHO_INVALIDO';
        end if;

        if v_len in (23, 25, 26, 27) then
            if left(v_tag, 1) not between '1' and '9' then raise exception 'ETIQUETA_INVALIDA_PREFIXO'; end if;
            v_year_text := substring(v_tag from 2 for 4);
            if v_year_text !~ '^\d{4}$' then raise exception 'ETIQUETA_INVALIDA_ANO'; end if;
            v_year_num := v_year_text::integer;
            if v_year_num < 2024 or v_year_num > v_current_year then raise exception 'ETIQUETA_INVALIDA_ANO'; end if;
        end if;

        if v_len = 17 then
            if v_cd <> 2 then raise exception 'ETIQUETA_TAMANHO_INVALIDO'; end if;
            v_pedido_text := left(v_tag, 7);
            v_filial_text := right(v_tag, 3);
        elsif v_len = 18 then
            if v_cd <> 2 then raise exception 'ETIQUETA_TAMANHO_INVALIDO'; end if;
            v_pedido_text := left(v_tag, 7);
            v_filial_text := right(v_tag, 4);
        else
            v_pedido_text := substring(v_tag from 2 for 7);
            v_filial_text := substring(v_tag from 12 for 4);
        end if;

        if v_pedido_text !~ '^\d{7}$' then raise exception 'PEDIDO_INVALIDO'; end if;
        if v_filial_text !~ '^\d+$' then raise exception 'FILIAL_INVALIDA'; end if;

        v_day_num := coalesce(nullif(substring(v_pedido_text from 5 for 3), ''), '0')::integer;
        if v_day_num < 1 or v_day_num > 366 then raise exception 'PEDIDO_INVALIDO'; end if;
        v_filial_num := coalesce(nullif(regexp_replace(v_filial_text, '^0+', ''), ''), '0')::integer;

        select nullif(trim(r.rota), ''), nullif(trim(r.nome), '')
        into v_route_rota, v_route_nome
        from app.db_rotas r
        where r.cd = v_cd
          and r.filial = v_filial_num
        order by r.updated_at desc nulls last
        limit 1;
    end if;

    update app.controle_caixa_termica
    set status = 'em_transito',
        updated_at = v_now
    where id = p_caixa_id;

    insert into app.controle_caixa_termica_movs (
        caixa_id, tipo, cd, etiqueta_volume, filial, filial_nome,
        rota, placa, obs_recebimento, user_id_resp, mat_resp, nome_resp,
        data_hr, pedido, data_pedido
    ) values (
        p_caixa_id, 'expedicao', v_cd, v_tag,
        coalesce(v_filial_num, p_filial),
        coalesce(v_route_nome, nullif(trim(coalesce(p_filial_nome, '')), '')),
        coalesce(v_route_rota, nullif(trim(coalesce(p_rota, '')), ''), case when v_tag is not null then 'Sem rota' else null end),
        nullif(trim(upper(coalesce(p_placa, ''))), ''),
        null,
        v_uid,
        coalesce(nullif(trim(p_mat), ''), '-'),
        coalesce(nullif(trim(p_nome), ''), 'Usuário'),
        v_now,
        case when v_pedido_text is not null then v_pedido_text::bigint else null end,
        case when v_pedido_text is not null then make_date(left(v_pedido_text, 4)::integer, 1, 1) + (v_day_num - 1) else null end
    )
    returning id into v_mov_id;

    return query
    select
        c.id, c.codigo, c.status, c.updated_at,
        m.id, m.tipo, m.data_hr, m.placa, m.rota, m.filial, m.filial_nome, m.etiqueta_volume,
        m.pedido, m.data_pedido
    from app.controle_caixa_termica c
    join app.controle_caixa_termica_movs m on m.id = v_mov_id
    where c.id = p_caixa_id;
end;
$$;

create or replace function public.rpc_caixa_termica_receber(
    p_caixa_id uuid default null,
    p_cd integer default null,
    p_obs_recebimento text default null,
    p_user_id uuid default null,
    p_mat text default null,
    p_nome text default null
)
returns table (
    box_id uuid, box_codigo text, box_status text, box_updated_at timestamptz,
    mov_id uuid, mov_tipo text, mov_data_hr timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_status text;
    v_mov_id uuid;
    v_now timestamptz := now();
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_caixa_id is null then raise exception 'CAIXA_ID_OBRIGATORIO'; end if;

    v_cd := coalesce(p_cd, (select cd_default from authz.profiles where user_id = v_uid limit 1));
    if v_cd is null then raise exception 'CD_NAO_DEFINIDO_USUARIO'; end if;

    select c.status into v_status
    from app.controle_caixa_termica c
    where c.id = p_caixa_id
      and c.cd = v_cd
      and c.deleted_at is null
    for update;

    if not found then raise exception 'CAIXA_NAO_ENCONTRADA'; end if;
    if v_status <> 'em_transito' then raise exception 'CAIXA_NAO_EM_TRANSITO'; end if;

    update app.controle_caixa_termica
    set status = 'disponivel',
        updated_at = v_now
    where id = p_caixa_id;

    insert into app.controle_caixa_termica_movs (
        caixa_id, tipo, cd, etiqueta_volume, filial, filial_nome,
        rota, placa, obs_recebimento, user_id_resp, mat_resp, nome_resp, data_hr
    ) values (
        p_caixa_id, 'recebimento', v_cd,
        null, null, null, null, null,
        nullif(trim(coalesce(p_obs_recebimento, '')), ''),
        v_uid,
        coalesce(nullif(trim(p_mat), ''), '-'),
        coalesce(nullif(trim(p_nome), ''), 'Usuário'),
        v_now
    )
    returning id into v_mov_id;

    return query
    select c.id, c.codigo, c.status, c.updated_at, m.id, m.tipo, m.data_hr
    from app.controle_caixa_termica c
    join app.controle_caixa_termica_movs m on m.id = v_mov_id
    where c.id = p_caixa_id;
end;
$$;

create or replace function public.rpc_caixa_termica_update(
    p_caixa_id uuid default null,
    p_cd integer default null,
    p_codigo text default null,
    p_descricao text default null,
    p_observacoes text default null,
    p_capacidade_litros integer default null,
    p_marca text default null,
    p_user_id uuid default null,
    p_mat text default null,
    p_nome text default null
)
returns table (
    id uuid, cd integer, codigo text, descricao text, observacoes text,
    capacidade_litros integer, marca text, status text,
    created_at timestamptz, created_by uuid, created_mat text, created_nome text,
    updated_at timestamptz, updated_by uuid, updated_mat text, updated_nome text,
    deleted_at timestamptz, deleted_by uuid, deleted_mat text, deleted_nome text,
    last_mov_tipo text, last_mov_data_hr timestamptz, last_mov_placa text,
    last_mov_rota text, last_mov_filial integer, last_mov_filial_nome text,
    last_mov_pedido bigint, last_mov_data_pedido date,
    last_mov_mat_resp text, last_mov_nome_resp text
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_codigo text;
    v_marca text;
    v_now timestamptz := now();
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if coalesce(authz.user_role(v_uid), '') <> 'admin' then raise exception 'APENAS_ADMIN'; end if;
    if p_caixa_id is null then raise exception 'CAIXA_ID_OBRIGATORIO'; end if;

    v_cd := coalesce(p_cd, (select cd_default from authz.profiles where user_id = v_uid limit 1));
    if v_cd is null then raise exception 'CD_NAO_DEFINIDO_USUARIO'; end if;

    v_codigo := nullif(trim(upper(coalesce(p_codigo, ''))), '');
    if v_codigo is null then raise exception 'CODIGO_OBRIGATORIO'; end if;
    if nullif(trim(coalesce(p_descricao, '')), '') is null then raise exception 'DESCRICAO_OBRIGATORIA'; end if;
    if p_capacidade_litros is null or p_capacidade_litros <= 0 then raise exception 'CAPACIDADE_OBRIGATORIA'; end if;

    v_marca := nullif(trim(coalesce(p_marca, '')), '');
    if v_marca is null then raise exception 'MARCA_OBRIGATORIA'; end if;
    if lower(v_marca) = 'ecobox' then
        v_marca := 'Ecobox';
    elsif lower(v_marca) = 'coleman' then
        v_marca := 'Coleman';
    elsif lower(v_marca) in ('isopor generica', 'isopor genérica') then
        v_marca := 'Isopor genérica';
    else
        raise exception 'MARCA_INVALIDA';
    end if;

    if exists (
        select 1
        from app.controle_caixa_termica c
        where c.cd = v_cd
          and upper(trim(c.codigo)) = v_codigo
          and c.id <> p_caixa_id
    ) then
        raise exception 'CAIXA_JA_CADASTRADA';
    end if;

    update app.controle_caixa_termica c
    set codigo = v_codigo,
        descricao = trim(p_descricao),
        observacoes = nullif(trim(coalesce(p_observacoes, '')), ''),
        capacidade_litros = p_capacidade_litros,
        marca = v_marca,
        updated_at = v_now,
        updated_by = v_uid,
        updated_mat = coalesce(nullif(trim(p_mat), ''), '-'),
        updated_nome = coalesce(nullif(trim(p_nome), ''), 'Usuário')
    where c.id = p_caixa_id
      and c.cd = v_cd
      and c.deleted_at is null;

    if not found then raise exception 'CAIXA_NAO_ENCONTRADA'; end if;

    return query
    select *
    from public.rpc_caixa_termica_by_codigo(v_cd, v_codigo);
end;
$$;

create or replace function public.rpc_caixa_termica_delete(
    p_caixa_id uuid default null,
    p_cd integer default null,
    p_user_id uuid default null,
    p_mat text default null,
    p_nome text default null
)
returns table (
    id uuid,
    deleted_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_status text;
    v_now timestamptz := now();
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if coalesce(authz.user_role(v_uid), '') <> 'admin' then raise exception 'APENAS_ADMIN'; end if;
    if p_caixa_id is null then raise exception 'CAIXA_ID_OBRIGATORIO'; end if;

    v_cd := coalesce(p_cd, (select cd_default from authz.profiles where user_id = v_uid limit 1));
    if v_cd is null then raise exception 'CD_NAO_DEFINIDO_USUARIO'; end if;

    select c.status into v_status
    from app.controle_caixa_termica c
    where c.id = p_caixa_id
      and c.cd = v_cd
      and c.deleted_at is null
    for update;

    if not found then raise exception 'CAIXA_NAO_ENCONTRADA'; end if;
    if v_status = 'em_transito' then raise exception 'CAIXA_EM_TRANSITO_NAO_PODE_EXCLUIR'; end if;

    update app.controle_caixa_termica c
    set deleted_at = v_now,
        deleted_by = v_uid,
        deleted_mat = coalesce(nullif(trim(p_mat), ''), '-'),
        deleted_nome = coalesce(nullif(trim(p_nome), ''), 'Usuário'),
        updated_at = v_now,
        updated_by = v_uid,
        updated_mat = coalesce(nullif(trim(p_mat), ''), '-'),
        updated_nome = coalesce(nullif(trim(p_nome), ''), 'Usuário')
    where c.id = p_caixa_id
    returning c.id, c.deleted_at into id, deleted_at;

    return next;
end;
$$;

create or replace function public.rpc_caixa_termica_historico(
    p_caixa_id uuid default null
)
returns table (
    id uuid, caixa_id uuid, tipo text, cd integer, etiqueta_volume text,
    filial integer, filial_nome text, rota text, placa text, obs_recebimento text,
    mat_resp text, nome_resp text, data_hr timestamptz, created_at timestamptz,
    pedido bigint, data_pedido date
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_caixa_id is null then raise exception 'CAIXA_ID_OBRIGATORIO'; end if;

    return query
    select
        m.id, m.caixa_id, m.tipo, m.cd,
        m.etiqueta_volume, m.filial, m.filial_nome, m.rota, m.placa,
        m.obs_recebimento, m.mat_resp, m.nome_resp, m.data_hr, m.created_at,
        m.pedido, m.data_pedido
    from app.controle_caixa_termica_movs m
    where m.caixa_id = p_caixa_id
    order by m.data_hr asc;
end;
$$;

create or replace function public.rpc_caixa_termica_feed_diario(
    p_cd integer default null,
    p_data date default null
)
returns table (
    rota text,
    filial integer,
    filial_nome text,
    expedicoes bigint,
    recebimentos bigint,
    ultimo_mov timestamptz,
    caixas jsonb
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_data date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := coalesce(p_cd, (select cd_default from authz.profiles where user_id = v_uid limit 1));
    if v_cd is null then raise exception 'CD_NAO_DEFINIDO_USUARIO'; end if;
    v_data := coalesce(p_data, timezone('America/Sao_Paulo', now())::date);

    return query
    select
        coalesce(nullif(trim(m.rota), ''), 'Sem rota') as rota,
        m.filial,
        m.filial_nome,
        count(*) filter (where m.tipo = 'expedicao') as expedicoes,
        count(*) filter (where m.tipo = 'recebimento') as recebimentos,
        max(m.data_hr) as ultimo_mov,
        jsonb_agg(
            jsonb_build_object(
                'codigo', c.codigo,
                'tipo', m.tipo,
                'data_hr', m.data_hr,
                'pedido', m.pedido,
                'data_pedido', m.data_pedido
            ) order by m.data_hr desc
        ) as caixas
    from app.controle_caixa_termica_movs m
    join app.controle_caixa_termica c on c.id = m.caixa_id
    where m.cd = v_cd
      and timezone('America/Sao_Paulo', m.data_hr)::date = v_data
    group by coalesce(nullif(trim(m.rota), ''), 'Sem rota'), m.filial, m.filial_nome
    order by max(m.data_hr) desc;
end;
$$;

grant execute on function public.rpc_caixa_termica_list(integer) to authenticated;
grant execute on function public.rpc_caixa_termica_by_codigo(integer, text) to authenticated;
grant execute on function public.rpc_caixa_termica_insert(integer, text, text, text, integer, text, uuid, text, text) to authenticated;
grant execute on function public.rpc_caixa_termica_expedir(uuid, integer, text, integer, text, text, text, uuid, text, text) to authenticated;
grant execute on function public.rpc_caixa_termica_receber(uuid, integer, text, uuid, text, text) to authenticated;
grant execute on function public.rpc_caixa_termica_update(uuid, integer, text, text, text, integer, text, uuid, text, text) to authenticated;
grant execute on function public.rpc_caixa_termica_delete(uuid, integer, uuid, text, text) to authenticated;
grant execute on function public.rpc_caixa_termica_historico(uuid) to authenticated;
grant execute on function public.rpc_caixa_termica_feed_diario(integer, date) to authenticated;
