create or replace function app.aud_caixa_normalize_ocorrencia(p_value text)
returns text
language sql
immutable
as $$
    with allowed(ord, label) as (
        values
            (1, 'Altura não conforme'),
            (2, 'Avaria'),
            (3, 'Basqueta quebrada'),
            (4, 'Caixa papelão não conforme'),
            (5, 'Duplicidade'),
            (6, 'Falta'),
            (7, 'Lacramento não conforme'),
            (8, 'Sem etiqueta'),
            (9, 'Sem lacre'),
            (10, 'Sobra'),
            (11, 'Termo embagalem (N/OK)'),
            (12, 'Volume misturado')
    ),
    raw as (
        select nullif(btrim(coalesce(p_value, '')), '') as input
    ),
    tokens as (
        select nullif(btrim(token), '') as token
        from raw
        cross join lateral regexp_split_to_table(coalesce(input, ''), '\s*(?:,|;|\|)\s*') as token
    ),
    invalid as (
        select 1
        from tokens t
        left join allowed a on a.label = t.token
        where t.token is not null
          and a.label is null
        limit 1
    ),
    valid as (
        select distinct a.ord, a.label
        from tokens t
        join allowed a on a.label = t.token
    )
    select case
        when (select input from raw) is null then null
        when exists(select 1 from invalid) then null
        when exists(select 1 from valid) then (
            select string_agg(v.label, ', ' order by v.ord)
            from valid v
        )
        else null
    end;
$$;

create or replace function app.aud_caixa_ocorrencia_is_valid(p_value text)
returns boolean
language sql
immutable
as $$
    select case
        when nullif(btrim(coalesce(p_value, '')), '') is null then true
        else app.aud_caixa_normalize_ocorrencia(p_value) is not null
    end;
$$;

do $$
declare
    v_constraint record;
begin
    for v_constraint in
        select c.conname
        from pg_constraint c
        where c.conrelid = 'app.aud_caixa'::regclass
          and c.contype = 'c'
          and pg_get_constraintdef(c.oid) ilike '%ocorrencia%'
    loop
        execute format('alter table app.aud_caixa drop constraint %I', v_constraint.conname);
    end loop;
end;
$$;

alter table app.aud_caixa
add constraint chk_aud_caixa_ocorrencia_valid
check (app.aud_caixa_ocorrencia_is_valid(ocorrencia));

create or replace function app.aud_caixa_enrich_and_validate()
returns trigger
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_profile record;
    v_is_global_admin boolean;
    v_cd integer;
    v_len integer;
    v_current_year integer;
    v_year_text text;
    v_year_num integer;
    v_pedido_text text;
    v_day_num integer;
    v_max_day_num integer;
    v_dv_text text;
    v_filial_text text;
    v_filial_num bigint;
    v_volume_text text;
    v_existing_same_pair_count integer;
    v_existing_same_etiqueta_count integer;
    v_route_rota text;
    v_route_nome text;
    v_route_uf text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if tg_op = 'INSERT' then
        new.user_id := v_uid;
        new.created_at := coalesce(new.created_at, now());
    else
        new.user_id := old.user_id;
        new.cd := old.cd;
        new.mat_aud := old.mat_aud;
        new.nome_aud := old.nome_aud;
        new.data_hr := old.data_hr;
        new.created_at := old.created_at;
    end if;

    new.etiqueta := regexp_replace(coalesce(new.etiqueta, ''), '\s+', '', 'g');
    if new.etiqueta = '' then
        raise exception 'ETIQUETA_OBRIGATORIA';
    end if;

    new.id_knapp := regexp_replace(coalesce(new.id_knapp, ''), '\D+', '', 'g');
    new.id_knapp := nullif(new.id_knapp, '');

    if not app.aud_caixa_ocorrencia_is_valid(new.ocorrencia) then
        raise exception 'OCORRENCIA_INVALIDA';
    end if;
    new.ocorrencia := app.aud_caixa_normalize_ocorrencia(new.ocorrencia);

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    v_is_global_admin := authz.is_admin(v_uid);

    if tg_op = 'INSERT' then
        if v_is_global_admin then
            if new.cd is null then
                raise exception 'CD_OBRIGATORIO_ADMIN_GLOBAL';
            end if;
        else
            v_cd := v_profile.cd_default;
            if v_cd is null then
                select min(ud.cd)
                into v_cd
                from authz.user_deposits ud
                where ud.user_id = v_uid;
            end if;

            if v_cd is null then
                raise exception 'CD_NAO_DEFINIDO_USUARIO';
            end if;

            if not authz.can_access_cd(v_uid, v_cd) then
                raise exception 'CD_SEM_ACESSO';
            end if;

            new.cd := v_cd;
        end if;

        if not authz.can_access_cd(v_uid, new.cd) then
            raise exception 'CD_SEM_ACESSO';
        end if;

        new.mat_aud := coalesce(nullif(trim(v_profile.mat), ''), new.mat_aud);
        new.nome_aud := coalesce(nullif(trim(v_profile.nome), ''), new.nome_aud);
    end if;

    if new.cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    v_len := char_length(new.etiqueta);
    if v_len not in (17, 18, 23, 25, 26, 27) then
        raise exception 'ETIQUETA_TAMANHO_INVALIDO';
    end if;

    v_current_year := extract(year from timezone('America/Sao_Paulo', now()))::integer;

    if v_len in (23, 25, 26, 27) then
        if left(new.etiqueta, 1) not between '1' and '9' then
            raise exception 'ETIQUETA_INVALIDA_PREFIXO';
        end if;

        v_year_text := substring(new.etiqueta from 2 for 4);
        if v_year_text !~ '^\d{4}$' then
            raise exception 'ETIQUETA_INVALIDA_ANO';
        end if;

        v_year_num := v_year_text::integer;
        if v_year_num < 2024 or v_year_num > v_current_year then
            raise exception 'ETIQUETA_INVALIDA_ANO';
        end if;
    end if;

    if v_len in (17, 18) then
        if new.cd <> 2 then
            raise exception 'ETIQUETA_17_18_CD_INVALIDO';
        end if;
        if new.id_knapp is null or new.id_knapp !~ '^\d{8}$' then
            raise exception 'ID_KNAPP_INVALIDO';
        end if;
    else
        new.id_knapp := null;
    end if;

    if v_len = 17 then
        v_pedido_text := left(new.etiqueta, 7);
        v_dv_text := substring(new.etiqueta from 8 for 1);
        v_filial_text := right(new.etiqueta, 3);
        v_volume_text := app.aud_caixa_strip_leading_zeros(new.id_knapp);
    elsif v_len = 18 then
        v_pedido_text := left(new.etiqueta, 7);
        v_dv_text := substring(new.etiqueta from 8 for 1);
        v_filial_text := right(new.etiqueta, 4);
        v_volume_text := app.aud_caixa_strip_leading_zeros(new.id_knapp);
    else
        v_pedido_text := substring(new.etiqueta from 2 for 7);
        v_dv_text := substring(new.etiqueta from 9 for 3);
        v_filial_text := substring(new.etiqueta from 12 for 4);
        v_volume_text := case
            when v_len = 23 then app.aud_caixa_strip_leading_zeros(right(new.etiqueta, 3))
            when v_len = 25 then app.aud_caixa_strip_leading_zeros(right(new.etiqueta, 2))
            when v_len = 26 then app.aud_caixa_strip_leading_zeros(substring(new.etiqueta from 17 for 3))
            else app.aud_caixa_strip_leading_zeros(substring(new.etiqueta from 18 for 3))
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

    new.pedido := v_pedido_text::bigint;
    v_day_num := coalesce(nullif(substring(v_pedido_text from 5 for 3), ''), '0')::integer;
    v_max_day_num := extract(doy from make_date(v_year_num, 12, 31))::integer;
    if v_day_num < 1 or v_day_num > v_max_day_num then
        raise exception 'PEDIDO_INVALIDO';
    end if;

    new.data_pedido := make_date(v_year_num, 1, 1) + (v_day_num - 1);
    new.dv := app.aud_caixa_strip_leading_zeros(v_dv_text);
    v_filial_num := app.aud_caixa_strip_leading_zeros(v_filial_text)::bigint;
    new.filial := v_filial_num;
    new.volume := nullif(v_volume_text, '');

    if v_len in (17, 18) then
        select count(*)
        into v_existing_same_pair_count
        from app.aud_caixa c
        where coalesce(nullif(trim(c.id_knapp), ''), '') = new.id_knapp
          and char_length(c.etiqueta) in (17, 18)
          and (tg_op <> 'UPDATE' or c.id <> old.id);

        if v_existing_same_pair_count > 0 then
            raise exception 'ETIQUETA_ID_KNAPP_DUPLICADO';
        end if;
    else
        select count(*)
        into v_existing_same_etiqueta_count
        from app.aud_caixa c
        where upper(trim(c.etiqueta)) = upper(trim(new.etiqueta))
          and (tg_op <> 'UPDATE' or c.id <> old.id);

        if v_existing_same_etiqueta_count > 0 then
            raise exception 'ETIQUETA_DUPLICADA';
        end if;
    end if;

    if coalesce(nullif(trim(new.mat_aud), ''), '') = '' then
        raise exception 'MATRICULA_AUDITOR_OBRIGATORIA';
    end if;

    if coalesce(nullif(trim(new.nome_aud), ''), '') = '' then
        raise exception 'NOME_AUDITOR_OBRIGATORIO';
    end if;

    select
        nullif(trim(r.rota), '') as rota,
        nullif(trim(r.nome), '') as nome,
        nullif(trim(r.uf), '') as uf
    into v_route_rota, v_route_nome, v_route_uf
    from app.db_rotas r
    where r.cd = new.cd
      and r.filial = new.filial
    order by r.updated_at desc nulls last
    limit 1;

    new.rota := coalesce(v_route_rota, 'Sem rota');
    new.filial_nome := v_route_nome;
    new.uf := v_route_uf;
    new.data_hr := coalesce(new.data_hr, now());
    new.updated_at := now();

    return new;
end;
$$;

alter table app.aud_caixa disable trigger trg_aud_caixa_enrich_and_validate;

update app.aud_caixa
set ocorrencia = app.aud_caixa_normalize_ocorrencia(ocorrencia)
where nullif(btrim(coalesce(ocorrencia, '')), '') is not null;

alter table app.aud_caixa enable trigger trg_aud_caixa_enrich_and_validate;
