alter table if exists app.controle_avarias
    add column if not exists situacao text;

create or replace function app.controle_avarias_enrich_and_validate()
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
    v_coddv integer;
    v_descricao text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if tg_op = 'INSERT' then
        new.user_id := v_uid;
    else
        new.user_id := old.user_id;
    end if;

    new.barras := regexp_replace(coalesce(new.barras, ''), '\s+', '', 'g');
    if new.barras = '' then
        raise exception 'BARRAS_OBRIGATORIA';
    end if;

    new.etiqueta := nullif(trim(coalesce(new.etiqueta, '')), '');
    new.lote := nullif(trim(coalesce(new.lote, '')), '');
    new.motivo := nullif(trim(coalesce(new.motivo, '')), '');
    new.situacao := nullif(trim(coalesce(new.situacao, '')), '');
    new.origem := nullif(trim(coalesce(new.origem, '')), '');

    if new.motivo is null then
        raise exception 'MOTIVO_OBRIGATORIO';
    end if;

    if new.situacao is null then
        raise exception 'SITUACAO_OBRIGATORIA';
    end if;

    if new.origem is null or new.origem not in ('Entrada', 'Expedição', 'Pulmão', 'Separação') then
        raise exception 'ORIGEM_INVALIDA';
    end if;

    if new.val_mmaa is not null then
        new.val_mmaa := regexp_replace(new.val_mmaa, '[^0-9]', '', 'g');
        new.val_mmaa := nullif(new.val_mmaa, '');
    end if;

    if new.val_mmaa is not null and new.val_mmaa !~ '^(0[1-9]|1[0-2])[0-9]{2}$' then
        raise exception 'VALIDADE_INVALIDA_MMAA';
    end if;

    if coalesce(new.qtd, 0) <= 0 then
        raise exception 'QTD_INVALIDA';
    end if;

    select b.coddv, b.descricao
    into v_coddv, v_descricao
    from app.db_barras b
    where b.barras = new.barras
    order by b.updated_at desc nulls last, b.coddv
    limit 1;

    if v_coddv is null then
        raise exception 'BARRAS_NAO_ENCONTRADA';
    end if;

    new.coddv := v_coddv;
    new.descricao := coalesce(v_descricao, 'SEM DESCRICAO');

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    v_is_global_admin := authz.is_admin(v_uid);

    if tg_op = 'UPDATE' then
        new.cd := old.cd;
        new.mat_aud := old.mat_aud;
        new.nome_aud := old.nome_aud;
        new.data_hr := old.data_hr;
    elsif v_is_global_admin then
        if new.cd is null then
            raise exception 'CD_OBRIGATORIO_ADMIN_GLOBAL';
        end if;
        new.mat_aud := coalesce(nullif(trim(v_profile.mat), ''), new.mat_aud);
        new.nome_aud := coalesce(nullif(trim(v_profile.nome), ''), new.nome_aud);
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
        new.mat_aud := coalesce(nullif(trim(v_profile.mat), ''), new.mat_aud);
        new.nome_aud := coalesce(nullif(trim(v_profile.nome), ''), new.nome_aud);
    end if;

    if coalesce(nullif(trim(new.mat_aud), ''), '') = '' then
        raise exception 'MATRICULA_AUDITOR_OBRIGATORIA';
    end if;

    if coalesce(nullif(trim(new.nome_aud), ''), '') = '' then
        raise exception 'NOME_AUDITOR_OBRIGATORIO';
    end if;

    new.data_hr := coalesce(new.data_hr, now());
    new.updated_at := now();

    return new;
end;
$$;

drop function if exists public.rpc_controle_avarias_insert(integer, text, integer, text, text, text, text, text, timestamptz);

create function public.rpc_controle_avarias_insert(
    p_cd integer,
    p_barras text,
    p_qtd integer,
    p_etiqueta text default null,
    p_motivo text default null,
    p_situacao text default null,
    p_origem text default null,
    p_lote text default null,
    p_val_mmaa text default null,
    p_data_hr timestamptz default null
)
returns table (
    id uuid,
    etiqueta text,
    cd integer,
    barras text,
    coddv integer,
    descricao text,
    qtd integer,
    origem text,
    motivo text,
    situacao text,
    lote text,
    val_mmaa char(4),
    mat_aud text,
    nome_aud text,
    user_id uuid,
    data_hr timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security invoker
set search_path = app, authz, public
as $$
begin
    return query
    insert into app.controle_avarias (
        etiqueta,
        cd,
        barras,
        qtd,
        origem,
        motivo,
        situacao,
        lote,
        val_mmaa,
        data_hr
    )
    values (
        p_etiqueta,
        p_cd,
        p_barras,
        p_qtd,
        p_origem,
        p_motivo,
        p_situacao,
        p_lote,
        p_val_mmaa,
        p_data_hr
    )
    returning
        controle_avarias.id,
        controle_avarias.etiqueta,
        controle_avarias.cd,
        controle_avarias.barras,
        controle_avarias.coddv,
        controle_avarias.descricao,
        controle_avarias.qtd,
        controle_avarias.origem,
        controle_avarias.motivo,
        controle_avarias.situacao,
        controle_avarias.lote,
        controle_avarias.val_mmaa,
        controle_avarias.mat_aud,
        controle_avarias.nome_aud,
        controle_avarias.user_id,
        controle_avarias.data_hr,
        controle_avarias.created_at,
        controle_avarias.updated_at;
end;
$$;

drop function if exists public.rpc_controle_avarias_update(uuid, integer, text, text, text, text, text);

create function public.rpc_controle_avarias_update(
    p_id uuid,
    p_qtd integer,
    p_etiqueta text default null,
    p_motivo text default null,
    p_situacao text default null,
    p_origem text default null,
    p_lote text default null,
    p_val_mmaa text default null
)
returns table (
    id uuid,
    etiqueta text,
    cd integer,
    barras text,
    coddv integer,
    descricao text,
    qtd integer,
    origem text,
    motivo text,
    situacao text,
    lote text,
    val_mmaa char(4),
    mat_aud text,
    nome_aud text,
    user_id uuid,
    data_hr timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security invoker
set search_path = app, authz, public
as $$
begin
    return query
    update app.controle_avarias
    set
        qtd = p_qtd,
        etiqueta = p_etiqueta,
        origem = p_origem,
        motivo = p_motivo,
        situacao = p_situacao,
        lote = p_lote,
        val_mmaa = p_val_mmaa
    where controle_avarias.id = p_id
    returning
        controle_avarias.id,
        controle_avarias.etiqueta,
        controle_avarias.cd,
        controle_avarias.barras,
        controle_avarias.coddv,
        controle_avarias.descricao,
        controle_avarias.qtd,
        controle_avarias.origem,
        controle_avarias.motivo,
        controle_avarias.situacao,
        controle_avarias.lote,
        controle_avarias.val_mmaa,
        controle_avarias.mat_aud,
        controle_avarias.nome_aud,
        controle_avarias.user_id,
        controle_avarias.data_hr,
        controle_avarias.created_at,
        controle_avarias.updated_at;

    if not found then
        raise exception 'AVARIA_NAO_ENCONTRADA_OU_SEM_ACESSO';
    end if;
end;
$$;

drop function if exists public.rpc_controle_avarias_today(integer, integer);

create function public.rpc_controle_avarias_today(
    p_cd integer,
    p_limit integer default 1000
)
returns table (
    id uuid,
    etiqueta text,
    cd integer,
    barras text,
    coddv integer,
    descricao text,
    qtd integer,
    origem text,
    motivo text,
    situacao text,
    lote text,
    val_mmaa char(4),
    mat_aud text,
    nome_aud text,
    user_id uuid,
    data_hr timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language sql
stable
security invoker
set search_path = app, authz, public
as $$
    with bounds as (
        select
            (timezone('America/Sao_Paulo', now()))::date as today_br
    )
    select
        c.id,
        c.etiqueta,
        c.cd,
        c.barras,
        c.coddv,
        c.descricao,
        c.qtd,
        c.origem,
        c.motivo,
        c.situacao,
        c.lote,
        c.val_mmaa,
        c.mat_aud,
        c.nome_aud,
        c.user_id,
        c.data_hr,
        c.created_at,
        c.updated_at
    from app.controle_avarias c
    cross join bounds b
    where authz.session_is_recent(6)
      and p_cd is not null
      and c.cd = p_cd
      and c.data_hr >= (b.today_br::timestamp at time zone 'America/Sao_Paulo')
      and c.data_hr < ((b.today_br + 1)::timestamp at time zone 'America/Sao_Paulo')
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      )
    order by c.data_hr desc, c.id desc
    limit least(greatest(coalesce(p_limit, 1000), 1), 3000);
$$;

drop function if exists public.rpc_controle_avarias_report_rows(date, date, integer, integer);

create function public.rpc_controle_avarias_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null,
    p_limit integer default 20000
)
returns table (
    id uuid,
    etiqueta text,
    cd integer,
    barras text,
    coddv integer,
    descricao text,
    qtd integer,
    origem text,
    motivo text,
    situacao text,
    lote text,
    val_mmaa char(4),
    mat_aud text,
    nome_aud text,
    user_id uuid,
    data_hr timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = app, authz, public
as $$
declare
    v_role text;
    v_start_ts timestamptz;
    v_end_ts timestamptz;
    v_limit integer;
    v_count bigint;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_role := authz.user_role(auth.uid());
    if v_role <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if p_dt_fim - p_dt_ini > 31 then
        raise exception 'JANELA_MAX_31_DIAS';
    end if;

    if p_cd is not null and not authz.can_access_cd(auth.uid(), p_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 20000), 1), 50000);
    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    select count(*)
    into v_count
    from app.controle_avarias c
    where c.data_hr >= v_start_ts
      and c.data_hr < v_end_ts
      and (p_cd is null or c.cd = p_cd)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      );

    if v_count > v_limit then
        raise exception 'RELATORIO_MUITO_GRANDE_%', v_count;
    end if;

    return query
    select
        c.id,
        c.etiqueta,
        c.cd,
        c.barras,
        c.coddv,
        c.descricao,
        c.qtd,
        c.origem,
        c.motivo,
        c.situacao,
        c.lote,
        c.val_mmaa,
        c.mat_aud,
        c.nome_aud,
        c.user_id,
        c.data_hr,
        c.created_at,
        c.updated_at
    from app.controle_avarias c
    where c.data_hr >= v_start_ts
      and c.data_hr < v_end_ts
      and (p_cd is null or c.cd = p_cd)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      )
    order by c.data_hr desc, c.id desc
    limit v_limit;
end;
$$;

grant execute on function public.rpc_controle_avarias_insert(integer, text, integer, text, text, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.rpc_controle_avarias_update(uuid, integer, text, text, text, text, text, text) to authenticated;
grant execute on function public.rpc_controle_avarias_today(integer, integer) to authenticated;
grant execute on function public.rpc_controle_avarias_report_rows(date, date, integer, integer) to authenticated;
