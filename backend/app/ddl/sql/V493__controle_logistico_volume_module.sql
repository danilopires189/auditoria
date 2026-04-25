create table if not exists app.controle_logistico_volume_lotes (
    lote_id uuid primary key default gen_random_uuid(),
    cd integer not null,
    pedido bigint not null,
    data_pedido date,
    dv text,
    filial bigint not null,
    filial_nome text,
    rota text not null default 'Sem rota',
    volume_total_informado integer not null check (volume_total_informado > 0),
    started_by uuid not null references auth.users(id) on delete restrict,
    started_mat text not null,
    started_nome text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_clv_lote unique (cd, pedido, filial)
);

create table if not exists app.controle_logistico_volume_movimentos (
    mov_id uuid primary key default gen_random_uuid(),
    lote_id uuid not null references app.controle_logistico_volume_lotes(lote_id) on delete cascade,
    cd integer not null,
    etapa text not null check (etapa in ('recebimento_cd', 'entrada_galpao', 'saida_galpao', 'entrega_filial')),
    etiqueta text not null,
    id_knapp text,
    volume text,
    volume_key text not null,
    fracionado boolean not null default false,
    fracionado_qtd integer check (fracionado_qtd is null or fracionado_qtd > 0),
    fracionado_tipo text check (fracionado_tipo is null or fracionado_tipo in ('pedido_direto', 'termolabeis')),
    user_id uuid not null references auth.users(id) on delete restrict,
    mat_operador text not null,
    nome_operador text not null,
    data_hr timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_clv_mov_cd_etapa_volume unique (cd, etapa, volume_key)
);

create index if not exists idx_clv_lotes_cd_pedido on app.controle_logistico_volume_lotes(cd, pedido, filial);
create index if not exists idx_clv_lotes_updated on app.controle_logistico_volume_lotes(cd, updated_at desc);
create index if not exists idx_clv_mov_lote_etapa on app.controle_logistico_volume_movimentos(lote_id, etapa);
create index if not exists idx_clv_mov_cd_etapa_data on app.controle_logistico_volume_movimentos(cd, etapa, data_hr desc);

create or replace function app.clv_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_clv_lotes_touch_updated_at on app.controle_logistico_volume_lotes;
create trigger trg_clv_lotes_touch_updated_at
before update on app.controle_logistico_volume_lotes
for each row
execute function app.clv_touch_updated_at();

drop trigger if exists trg_clv_mov_touch_updated_at on app.controle_logistico_volume_movimentos;
create trigger trg_clv_mov_touch_updated_at
before update on app.controle_logistico_volume_movimentos
for each row
execute function app.clv_touch_updated_at();

create or replace function app.clv_strip_leading_zeros(p_value text)
returns text
language plpgsql
immutable
as $$
declare
    v_value text;
begin
    v_value := regexp_replace(coalesce(p_value, ''), '\s+', '', 'g');
    if v_value = '' then
        return null;
    end if;

    v_value := regexp_replace(v_value, '^0+', '');
    if v_value = '' then
        return '0';
    end if;

    return v_value;
end;
$$;

create or replace function app.clv_current_profile()
returns table (
    user_id uuid,
    mat text,
    nome text,
    role text,
    cd_default integer
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    if authz.normalize_mat(coalesce(v_profile.mat, '')) <> '88885' then
        raise exception 'CLV_ACESSO_RESTRITO';
    end if;

    return query
    select
        v_uid,
        coalesce(nullif(trim(v_profile.mat), ''), '88885')::text,
        coalesce(nullif(trim(v_profile.nome), ''), 'USUARIO')::text,
        coalesce(nullif(trim(v_profile.role), ''), 'auditor')::text,
        v_profile.cd_default::integer;
end;
$$;

create or replace function app.clv_resolve_cd(p_cd integer default null)
returns integer
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_profile record;
    v_cd integer;
begin
    select *
    into v_profile
    from app.clv_current_profile()
    limit 1;

    v_uid := v_profile.user_id;

    if authz.is_admin(v_uid) then
        v_cd := coalesce(p_cd, v_profile.cd_default);
    else
        v_cd := coalesce(v_profile.cd_default, p_cd);
    end if;

    if v_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return v_cd;
end;
$$;

create or replace function app.clv_normalize_fracionado_tipo(p_tipo text)
returns text
language sql
immutable
as $$
    select case
        when lower(trim(coalesce(p_tipo, ''))) in ('pedido_direto', 'pedido direto') then 'pedido_direto'
        when lower(trim(coalesce(p_tipo, ''))) in ('termolabeis', 'termolábeis', 'termo') then 'termolabeis'
        else null
    end;
$$;

create or replace function app.clv_parse_etiqueta(
    p_cd integer,
    p_etiqueta text,
    p_id_knapp text default null
)
returns table (
    etiqueta text,
    id_knapp text,
    pedido bigint,
    data_pedido date,
    dv text,
    filial bigint,
    volume text,
    volume_key text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_etiqueta text;
    v_id_knapp text;
    v_len integer;
    v_current_year integer;
    v_year_text text;
    v_year_num integer;
    v_pedido_text text;
    v_day_num integer;
    v_max_day_num integer;
    v_dv_text text;
    v_filial_text text;
    v_volume_text text;
begin
    v_etiqueta := upper(regexp_replace(coalesce(p_etiqueta, ''), '\s+', '', 'g'));
    if v_etiqueta = '' then
        raise exception 'ETIQUETA_OBRIGATORIA';
    end if;

    v_id_knapp := regexp_replace(coalesce(p_id_knapp, ''), '\D+', '', 'g');
    v_id_knapp := nullif(v_id_knapp, '');
    v_len := char_length(v_etiqueta);

    if v_len not in (17, 18, 23, 25, 26, 27) then
        raise exception 'ETIQUETA_TAMANHO_INVALIDO';
    end if;

    v_current_year := extract(year from timezone('America/Sao_Paulo', now()))::integer;

    if v_len in (23, 25, 26, 27) then
        if left(v_etiqueta, 1) not between '1' and '9' then
            raise exception 'ETIQUETA_INVALIDA_PREFIXO';
        end if;

        v_year_text := substring(v_etiqueta from 2 for 4);
        if v_year_text !~ '^\d{4}$' then
            raise exception 'ETIQUETA_INVALIDA_ANO';
        end if;

        v_year_num := v_year_text::integer;
        if v_year_num < 2024 or v_year_num > v_current_year then
            raise exception 'ETIQUETA_INVALIDA_ANO';
        end if;
    end if;

    if v_len in (17, 18) then
        if p_cd <> 2 then
            raise exception 'ETIQUETA_17_18_CD_INVALIDO';
        end if;
        if v_id_knapp is null or v_id_knapp !~ '^\d{8}$' then
            raise exception 'ID_KNAPP_INVALIDO';
        end if;
    else
        v_id_knapp := null;
    end if;

    if v_len = 17 then
        v_pedido_text := left(v_etiqueta, 7);
        v_dv_text := substring(v_etiqueta from 8 for 1);
        v_filial_text := right(v_etiqueta, 3);
        v_volume_text := app.clv_strip_leading_zeros(v_id_knapp);
    elsif v_len = 18 then
        v_pedido_text := left(v_etiqueta, 7);
        v_dv_text := substring(v_etiqueta from 8 for 1);
        v_filial_text := right(v_etiqueta, 4);
        v_volume_text := app.clv_strip_leading_zeros(v_id_knapp);
    else
        v_pedido_text := substring(v_etiqueta from 2 for 7);
        v_dv_text := substring(v_etiqueta from 9 for 3);
        v_filial_text := substring(v_etiqueta from 12 for 4);
        v_volume_text := case
            when v_len = 23 then app.clv_strip_leading_zeros(right(v_etiqueta, 3))
            when v_len = 25 then app.clv_strip_leading_zeros(right(v_etiqueta, 2))
            when v_len = 26 then app.clv_strip_leading_zeros(substring(v_etiqueta from 17 for 3))
            else app.clv_strip_leading_zeros(substring(v_etiqueta from 18 for 3))
        end;
    end if;

    if v_pedido_text !~ '^\d{7}$' then
        raise exception 'PEDIDO_INVALIDO';
    end if;

    if v_filial_text !~ '^\d+$' then
        raise exception 'FILIAL_INVALIDA';
    end if;

    v_year_num := left(v_pedido_text, 4)::integer;
    if v_year_num < 2024 or v_year_num > v_current_year then
        raise exception 'PEDIDO_INVALIDO';
    end if;

    v_day_num := coalesce(nullif(substring(v_pedido_text from 5 for 3), ''), '0')::integer;
    v_max_day_num := extract(doy from make_date(v_year_num, 12, 31))::integer;
    if v_day_num < 1 or v_day_num > v_max_day_num then
        raise exception 'PEDIDO_INVALIDO';
    end if;

    return query
    select
        v_etiqueta,
        v_id_knapp,
        v_pedido_text::bigint,
        (make_date(v_year_num, 1, 1) + (v_day_num - 1))::date,
        app.clv_strip_leading_zeros(v_dv_text),
        app.clv_strip_leading_zeros(v_filial_text)::bigint,
        nullif(v_volume_text, ''),
        case
            when v_len in (17, 18) then format('KNAPP:%s', v_id_knapp)
            else format('ETQ:%s', v_etiqueta)
        end;
end;
$$;

create or replace function app.clv_feed_rows(
    p_cd integer,
    p_pedido bigint default null,
    p_today_only boolean default false
)
returns table (
    lote_id uuid,
    cd integer,
    pedido bigint,
    data_pedido date,
    dv text,
    filial bigint,
    filial_nome text,
    rota text,
    volume_total_informado integer,
    recebido_count integer,
    entrada_count integer,
    saida_count integer,
    entrega_count integer,
    pendente_recebimento integer,
    pendente_entrada integer,
    pendente_saida integer,
    pendente_entrega integer,
    updated_at timestamptz,
    movimentos jsonb
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
    with lotes as (
        select l.*
        from app.controle_logistico_volume_lotes l
        where l.cd = p_cd
          and (p_pedido is null or l.pedido = p_pedido)
          and (
              not p_today_only
              or timezone('America/Sao_Paulo', l.updated_at)::date = timezone('America/Sao_Paulo', now())::date
              or exists (
                  select 1
                  from app.controle_logistico_volume_movimentos mt
                  where mt.lote_id = l.lote_id
                    and timezone('America/Sao_Paulo', mt.data_hr)::date = timezone('America/Sao_Paulo', now())::date
              )
          )
    ),
    counts as (
        select
            l.lote_id,
            count(*) filter (where m.etapa = 'recebimento_cd')::integer as recebido_count,
            count(*) filter (where m.etapa = 'entrada_galpao')::integer as entrada_count,
            count(*) filter (where m.etapa = 'saida_galpao')::integer as saida_count,
            count(*) filter (where m.etapa = 'entrega_filial')::integer as entrega_count,
            coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'mov_id', m.mov_id,
                        'etapa', m.etapa,
                        'etiqueta', m.etiqueta,
                        'id_knapp', m.id_knapp,
                        'volume', m.volume,
                        'volume_key', m.volume_key,
                        'fracionado', m.fracionado,
                        'fracionado_qtd', m.fracionado_qtd,
                        'fracionado_tipo', m.fracionado_tipo,
                        'mat_operador', m.mat_operador,
                        'nome_operador', m.nome_operador,
                        'data_hr', m.data_hr
                    )
                    order by m.data_hr desc, m.mov_id desc
                ) filter (where m.mov_id is not null),
                '[]'::jsonb
            ) as movimentos
        from lotes l
        left join app.controle_logistico_volume_movimentos m
          on m.lote_id = l.lote_id
        group by l.lote_id
    )
    select
        l.lote_id,
        l.cd,
        l.pedido,
        l.data_pedido,
        l.dv,
        l.filial,
        l.filial_nome,
        l.rota,
        l.volume_total_informado,
        coalesce(c.recebido_count, 0),
        coalesce(c.entrada_count, 0),
        coalesce(c.saida_count, 0),
        coalesce(c.entrega_count, 0),
        greatest(l.volume_total_informado - coalesce(c.recebido_count, 0), 0),
        greatest(coalesce(c.recebido_count, 0) - coalesce(c.entrada_count, 0), 0),
        greatest(coalesce(c.recebido_count, 0) - coalesce(c.saida_count, 0), 0),
        greatest(coalesce(c.recebido_count, 0) - coalesce(c.entrega_count, 0), 0),
        l.updated_at,
        coalesce(c.movimentos, '[]'::jsonb)
    from lotes l
    left join counts c on c.lote_id = l.lote_id
    order by l.filial, l.pedido, l.updated_at desc;
$$;

create or replace function public.rpc_clv_recebimento_scan(
    p_cd integer,
    p_etiqueta text,
    p_id_knapp text default null,
    p_volume_total_informado integer default null,
    p_fracionado boolean default false,
    p_fracionado_qtd integer default null,
    p_fracionado_tipo text default null,
    p_data_hr timestamptz default null
)
returns table (
    lote_id uuid,
    cd integer,
    pedido bigint,
    data_pedido date,
    dv text,
    filial bigint,
    filial_nome text,
    rota text,
    volume_total_informado integer,
    recebido_count integer,
    entrada_count integer,
    saida_count integer,
    entrega_count integer,
    pendente_recebimento integer,
    pendente_entrada integer,
    pendente_saida integer,
    pendente_entrega integer,
    updated_at timestamptz,
    movimentos jsonb
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
    v_cd integer;
    v_parsed record;
    v_lote_id uuid;
    v_recebido_count integer;
    v_total integer;
    v_rota text;
    v_filial_nome text;
    v_uf text;
    v_fracionado boolean;
    v_fracionado_qtd integer;
    v_fracionado_tipo text;
begin
    select * into v_profile from app.clv_current_profile() limit 1;
    v_cd := app.clv_resolve_cd(p_cd);
    v_total := coalesce(p_volume_total_informado, 0);
    if v_total <= 0 then
        raise exception 'TOTAL_VOLUME_INVALIDO';
    end if;

    select * into v_parsed from app.clv_parse_etiqueta(v_cd, p_etiqueta, p_id_knapp) limit 1;

    if exists (
        select 1
        from app.controle_logistico_volume_movimentos m
        where m.cd = v_cd
          and m.etapa = 'recebimento_cd'
          and m.volume_key = v_parsed.volume_key
    ) then
        raise exception 'VOLUME_JA_INFORMADO';
    end if;

    select l.lote_id
    into v_lote_id
    from app.controle_logistico_volume_lotes l
    where l.cd = v_cd
      and l.pedido = v_parsed.pedido
      and l.filial = v_parsed.filial
    limit 1;

    if v_lote_id is not null then
        select count(*)::integer
        into v_recebido_count
        from app.controle_logistico_volume_movimentos m
        where m.lote_id = v_lote_id
          and m.etapa = 'recebimento_cd';

        if v_total < coalesce(v_recebido_count, 0) + 1 then
            raise exception 'TOTAL_VOLUME_MENOR_QUE_BIPADO';
        end if;
    end if;

    select
        nullif(trim(r.rota), ''),
        nullif(trim(r.nome), ''),
        nullif(trim(r.uf), '')
    into v_rota, v_filial_nome, v_uf
    from app.db_rotas r
    where r.cd = v_cd
      and r.filial = v_parsed.filial
    order by r.updated_at desc nulls last
    limit 1;

    insert into app.controle_logistico_volume_lotes (
        cd,
        pedido,
        data_pedido,
        dv,
        filial,
        filial_nome,
        rota,
        volume_total_informado,
        started_by,
        started_mat,
        started_nome
    )
    values (
        v_cd,
        v_parsed.pedido,
        v_parsed.data_pedido,
        v_parsed.dv,
        v_parsed.filial,
        v_filial_nome,
        coalesce(v_rota, 'Sem rota'),
        v_total,
        v_profile.user_id,
        v_profile.mat,
        v_profile.nome
    )
    on conflict on constraint uq_clv_lote
    do update set
        data_pedido = excluded.data_pedido,
        dv = excluded.dv,
        filial_nome = excluded.filial_nome,
        rota = excluded.rota,
        volume_total_informado = excluded.volume_total_informado
    returning controle_logistico_volume_lotes.lote_id into v_lote_id;

    v_fracionado := coalesce(p_fracionado, false);
    v_fracionado_tipo := app.clv_normalize_fracionado_tipo(p_fracionado_tipo);
    if v_fracionado then
        if coalesce(p_fracionado_qtd, 0) <= 0 then
            raise exception 'FRACIONADO_QTD_INVALIDA';
        end if;
        if v_fracionado_tipo is null then
            raise exception 'FRACIONADO_TIPO_INVALIDO';
        end if;
        v_fracionado_qtd := p_fracionado_qtd;
    else
        v_fracionado_qtd := null;
        v_fracionado_tipo := null;
    end if;

    insert into app.controle_logistico_volume_movimentos (
        lote_id,
        cd,
        etapa,
        etiqueta,
        id_knapp,
        volume,
        volume_key,
        fracionado,
        fracionado_qtd,
        fracionado_tipo,
        user_id,
        mat_operador,
        nome_operador,
        data_hr
    )
    values (
        v_lote_id,
        v_cd,
        'recebimento_cd',
        v_parsed.etiqueta,
        v_parsed.id_knapp,
        v_parsed.volume,
        v_parsed.volume_key,
        v_fracionado,
        v_fracionado_qtd,
        v_fracionado_tipo,
        v_profile.user_id,
        v_profile.mat,
        v_profile.nome,
        coalesce(p_data_hr, now())
    );

    update app.controle_logistico_volume_lotes l
    set updated_at = now()
    where l.lote_id = v_lote_id;

    return query
    select * from app.clv_feed_rows(v_cd, v_parsed.pedido, false) r
    where r.lote_id = v_lote_id;
end;
$$;

create or replace function public.rpc_clv_stage_scan(
    p_etapa text,
    p_etiqueta text,
    p_id_knapp text default null,
    p_lote_id uuid default null,
    p_cd integer default null,
    p_data_hr timestamptz default null
)
returns table (
    lote_id uuid,
    cd integer,
    pedido bigint,
    data_pedido date,
    dv text,
    filial bigint,
    filial_nome text,
    rota text,
    volume_total_informado integer,
    recebido_count integer,
    entrada_count integer,
    saida_count integer,
    entrega_count integer,
    pendente_recebimento integer,
    pendente_entrada integer,
    pendente_saida integer,
    pendente_entrega integer,
    updated_at timestamptz,
    movimentos jsonb
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
    v_cd integer;
    v_etapa text;
    v_parsed record;
    v_lote app.controle_logistico_volume_lotes%rowtype;
begin
    select * into v_profile from app.clv_current_profile() limit 1;
    v_cd := app.clv_resolve_cd(p_cd);
    v_etapa := lower(trim(coalesce(p_etapa, '')));

    if v_etapa not in ('entrada_galpao', 'saida_galpao', 'entrega_filial') then
        raise exception 'ETAPA_INVALIDA';
    end if;

    select * into v_parsed from app.clv_parse_etiqueta(v_cd, p_etiqueta, p_id_knapp) limit 1;

    if p_lote_id is not null then
        select *
        into v_lote
        from app.controle_logistico_volume_lotes l
        where l.lote_id = p_lote_id
          and l.cd = v_cd
        limit 1;

        if v_lote.lote_id is null then
            raise exception 'LOTE_NAO_RECEBIDO';
        end if;

        if v_lote.pedido <> v_parsed.pedido or v_lote.filial <> v_parsed.filial then
            raise exception 'FILIAL_DIVERGENTE';
        end if;
    else
        select *
        into v_lote
        from app.controle_logistico_volume_lotes l
        where l.cd = v_cd
          and l.pedido = v_parsed.pedido
          and l.filial = v_parsed.filial
        limit 1;

        if v_lote.lote_id is null then
            raise exception 'LOTE_NAO_RECEBIDO';
        end if;
    end if;

    if not exists (
        select 1
        from app.controle_logistico_volume_movimentos m
        where m.lote_id = v_lote.lote_id
          and m.etapa = 'recebimento_cd'
          and m.volume_key = v_parsed.volume_key
    ) then
        raise exception 'VOLUME_NAO_RECEBIDO';
    end if;

    if exists (
        select 1
        from app.controle_logistico_volume_movimentos m
        where m.cd = v_cd
          and m.etapa = v_etapa
          and m.volume_key = v_parsed.volume_key
    ) then
        raise exception 'VOLUME_JA_CONFIRMADO';
    end if;

    insert into app.controle_logistico_volume_movimentos (
        lote_id,
        cd,
        etapa,
        etiqueta,
        id_knapp,
        volume,
        volume_key,
        user_id,
        mat_operador,
        nome_operador,
        data_hr
    )
    values (
        v_lote.lote_id,
        v_cd,
        v_etapa,
        v_parsed.etiqueta,
        v_parsed.id_knapp,
        v_parsed.volume,
        v_parsed.volume_key,
        v_profile.user_id,
        v_profile.mat,
        v_profile.nome,
        coalesce(p_data_hr, now())
    );

    update app.controle_logistico_volume_lotes l
    set updated_at = now()
    where l.lote_id = v_lote.lote_id;

    return query
    select * from app.clv_feed_rows(v_cd, v_parsed.pedido, false) r
    where r.lote_id = v_lote.lote_id;
end;
$$;

create or replace function public.rpc_clv_pedido_manifest(
    p_cd integer,
    p_pedido bigint,
    p_etapa text default null
)
returns table (
    lote_id uuid,
    cd integer,
    pedido bigint,
    data_pedido date,
    dv text,
    filial bigint,
    filial_nome text,
    rota text,
    volume_total_informado integer,
    recebido_count integer,
    entrada_count integer,
    saida_count integer,
    entrega_count integer,
    pendente_recebimento integer,
    pendente_entrada integer,
    pendente_saida integer,
    pendente_entrega integer,
    updated_at timestamptz,
    movimentos jsonb
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_etapa text;
begin
    perform 1 from app.clv_current_profile() limit 1;
    v_cd := app.clv_resolve_cd(p_cd);
    v_etapa := nullif(lower(trim(coalesce(p_etapa, ''))), '');
    if p_pedido is null then
        raise exception 'PEDIDO_OBRIGATORIO';
    end if;
    if v_etapa is not null and v_etapa not in ('entrada_galpao', 'saida_galpao', 'entrega_filial') then
        raise exception 'ETAPA_INVALIDA';
    end if;

    return query
    select * from app.clv_feed_rows(v_cd, p_pedido, false);
end;
$$;

create or replace function public.rpc_clv_today_feed(p_cd integer)
returns table (
    lote_id uuid,
    cd integer,
    pedido bigint,
    data_pedido date,
    dv text,
    filial bigint,
    filial_nome text,
    rota text,
    volume_total_informado integer,
    recebido_count integer,
    entrada_count integer,
    saida_count integer,
    entrega_count integer,
    pendente_recebimento integer,
    pendente_entrada integer,
    pendente_saida integer,
    pendente_entrega integer,
    updated_at timestamptz,
    movimentos jsonb
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
begin
    perform 1 from app.clv_current_profile() limit 1;
    v_cd := app.clv_resolve_cd(p_cd);
    return query
    select * from app.clv_feed_rows(v_cd, null, true);
end;
$$;

create or replace function public.rpc_clv_pending_summary(
    p_cd integer,
    p_pedido bigint default null
)
returns table (
    lotes_count integer,
    volume_total_informado integer,
    recebido_count integer,
    entrada_count integer,
    saida_count integer,
    entrega_count integer,
    pendente_recebimento integer,
    pendente_entrada integer,
    pendente_saida integer,
    pendente_entrega integer
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
begin
    perform 1 from app.clv_current_profile() limit 1;
    v_cd := app.clv_resolve_cd(p_cd);

    return query
    select
        count(*)::integer,
        coalesce(sum(r.volume_total_informado), 0)::integer,
        coalesce(sum(r.recebido_count), 0)::integer,
        coalesce(sum(r.entrada_count), 0)::integer,
        coalesce(sum(r.saida_count), 0)::integer,
        coalesce(sum(r.entrega_count), 0)::integer,
        coalesce(sum(r.pendente_recebimento), 0)::integer,
        coalesce(sum(r.pendente_entrada), 0)::integer,
        coalesce(sum(r.pendente_saida), 0)::integer,
        coalesce(sum(r.pendente_entrega), 0)::integer
    from app.clv_feed_rows(v_cd, p_pedido, false) r;
end;
$$;

alter table app.controle_logistico_volume_lotes enable row level security;
alter table app.controle_logistico_volume_movimentos enable row level security;

revoke all on app.controle_logistico_volume_lotes from anon;
revoke all on app.controle_logistico_volume_lotes from authenticated;
revoke all on app.controle_logistico_volume_movimentos from anon;
revoke all on app.controle_logistico_volume_movimentos from authenticated;

grant select, insert, update, delete on app.controle_logistico_volume_lotes to authenticated;
grant select, insert, update, delete on app.controle_logistico_volume_movimentos to authenticated;

drop policy if exists p_clv_lotes_select on app.controle_logistico_volume_lotes;
drop policy if exists p_clv_lotes_insert on app.controle_logistico_volume_lotes;
drop policy if exists p_clv_lotes_update on app.controle_logistico_volume_lotes;
drop policy if exists p_clv_lotes_delete on app.controle_logistico_volume_lotes;

create policy p_clv_lotes_select
on app.controle_logistico_volume_lotes
for select
using (
    authz.session_is_recent(6)
    and exists (
        select 1
        from authz.current_profile_context_v2() p
        where authz.normalize_mat(coalesce(p.mat, '')) = '88885'
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), controle_logistico_volume_lotes.cd))
    )
);

create policy p_clv_lotes_insert
on app.controle_logistico_volume_lotes
for insert
with check (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and exists (
        select 1
        from authz.current_profile_context_v2() p
        where authz.normalize_mat(coalesce(p.mat, '')) = '88885'
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), controle_logistico_volume_lotes.cd))
    )
);

create policy p_clv_lotes_update
on app.controle_logistico_volume_lotes
for update
using (
    authz.session_is_recent(6)
    and exists (
        select 1
        from authz.current_profile_context_v2() p
        where authz.normalize_mat(coalesce(p.mat, '')) = '88885'
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), controle_logistico_volume_lotes.cd))
    )
)
with check (
    authz.session_is_recent(6)
    and exists (
        select 1
        from authz.current_profile_context_v2() p
        where authz.normalize_mat(coalesce(p.mat, '')) = '88885'
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), controle_logistico_volume_lotes.cd))
    )
);

create policy p_clv_lotes_delete
on app.controle_logistico_volume_lotes
for delete
using (
    authz.session_is_recent(6)
    and exists (
        select 1
        from authz.current_profile_context_v2() p
        where authz.normalize_mat(coalesce(p.mat, '')) = '88885'
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), controle_logistico_volume_lotes.cd))
    )
);

drop policy if exists p_clv_mov_select on app.controle_logistico_volume_movimentos;
drop policy if exists p_clv_mov_insert on app.controle_logistico_volume_movimentos;
drop policy if exists p_clv_mov_update on app.controle_logistico_volume_movimentos;
drop policy if exists p_clv_mov_delete on app.controle_logistico_volume_movimentos;

create policy p_clv_mov_select
on app.controle_logistico_volume_movimentos
for select
using (
    authz.session_is_recent(6)
    and exists (
        select 1
        from authz.current_profile_context_v2() p
        where authz.normalize_mat(coalesce(p.mat, '')) = '88885'
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), controle_logistico_volume_movimentos.cd))
    )
);

create policy p_clv_mov_insert
on app.controle_logistico_volume_movimentos
for insert
with check (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and exists (
        select 1
        from authz.current_profile_context_v2() p
        where authz.normalize_mat(coalesce(p.mat, '')) = '88885'
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), controle_logistico_volume_movimentos.cd))
    )
);

create policy p_clv_mov_update
on app.controle_logistico_volume_movimentos
for update
using (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and exists (
        select 1
        from authz.current_profile_context_v2() p
        where authz.normalize_mat(coalesce(p.mat, '')) = '88885'
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), controle_logistico_volume_movimentos.cd))
    )
)
with check (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and exists (
        select 1
        from authz.current_profile_context_v2() p
        where authz.normalize_mat(coalesce(p.mat, '')) = '88885'
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), controle_logistico_volume_movimentos.cd))
    )
);

create policy p_clv_mov_delete
on app.controle_logistico_volume_movimentos
for delete
using (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and exists (
        select 1
        from authz.current_profile_context_v2() p
        where authz.normalize_mat(coalesce(p.mat, '')) = '88885'
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), controle_logistico_volume_movimentos.cd))
    )
);

grant execute on function app.clv_current_profile() to authenticated;
grant execute on function app.clv_resolve_cd(integer) to authenticated;
grant execute on function app.clv_parse_etiqueta(integer, text, text) to authenticated;
grant execute on function public.rpc_clv_recebimento_scan(integer, text, text, integer, boolean, integer, text, timestamptz) to authenticated;
grant execute on function public.rpc_clv_stage_scan(text, text, text, uuid, integer, timestamptz) to authenticated;
grant execute on function public.rpc_clv_pedido_manifest(integer, bigint, text) to authenticated;
grant execute on function public.rpc_clv_today_feed(integer) to authenticated;
grant execute on function public.rpc_clv_pending_summary(integer, bigint) to authenticated;
