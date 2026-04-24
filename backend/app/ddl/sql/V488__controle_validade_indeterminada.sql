do $$
declare
    v_table_name text;
    v_constraint_name text;
begin
    foreach v_table_name in array array[
        'ctrl_validade_linha_coletas',
        'ctrl_validade_linha_retiradas',
        'ctrl_validade_pul_retiradas'
    ]
    loop
        for v_constraint_name in
            select c.conname
            from pg_constraint c
            join pg_class t on t.oid = c.conrelid
            join pg_namespace n on n.oid = t.relnamespace
            where n.nspname = 'app'
              and t.relname = v_table_name
              and c.contype = 'c'
              and pg_get_constraintdef(c.oid) ilike '%val_mmaa%'
        loop
            execute format('alter table app.%I drop constraint %I', v_table_name, v_constraint_name);
        end loop;
    end loop;
end;
$$;

alter table if exists app.ctrl_validade_linha_coletas
    add constraint ck_ctrl_validade_linha_coletas_val_mmaa
    check (val_mmaa = 'INDETERMINADA' or val_mmaa ~ '^(0[1-9]|1[0-2])/[0-9]{2}$');

alter table if exists app.ctrl_validade_linha_retiradas
    add constraint ck_ctrl_validade_linha_retiradas_val_mmaa
    check (val_mmaa = 'INDETERMINADA' or val_mmaa ~ '^(0[1-9]|1[0-2])/[0-9]{2}$');

alter table if exists app.ctrl_validade_pul_retiradas
    add constraint ck_ctrl_validade_pul_retiradas_val_mmaa
    check (val_mmaa = 'INDETERMINADA' or val_mmaa ~ '^(0[1-9]|1[0-2])/[0-9]{2}$');

create or replace function app.ctrl_validade_normalize_val_mmaa(p_val_mmaa text)
returns text
language sql
immutable
as $$
    select case
        when upper(trim(coalesce(p_val_mmaa, ''))) in ('INDETERMINADA', 'INDETERMINADO') then 'INDETERMINADA'
        else app.pvps_alocacao_normalize_validade(p_val_mmaa)
    end;
$$;

create or replace function app.ctrl_validade_month_index(p_val_mmaa text)
returns integer
language sql
immutable
as $$
    select case
        when app.ctrl_validade_normalize_val_mmaa(p_val_mmaa) = 'INDETERMINADA' then null::integer
        else
            ((split_part(app.ctrl_validade_normalize_val_mmaa(p_val_mmaa), '/', 2)::integer + 2000) * 12)
            + split_part(app.ctrl_validade_normalize_val_mmaa(p_val_mmaa), '/', 1)::integer
    end;
$$;

create or replace function public.rpc_ctrl_validade_linha_coleta_insert(
    p_cd integer default null,
    p_barras text default null,
    p_endereco_sep text default null,
    p_val_mmaa text default null,
    p_qtd integer default 1,
    p_data_hr timestamptz default null,
    p_client_event_id text default null
)
returns table (
    id uuid,
    client_event_id text,
    cd integer,
    barras text,
    coddv integer,
    descricao text,
    endereco_sep text,
    val_mmaa text,
    qtd integer,
    data_coleta timestamptz,
    auditor_id uuid,
    auditor_mat text,
    auditor_nome text,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
    v_barras text;
    v_coddv integer;
    v_descricao text;
    v_endereco_sep text;
    v_val_mmaa text;
    v_client_event_id text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_barras := regexp_replace(coalesce(p_barras, ''), '\s+', '', 'g');
    if v_barras = '' then raise exception 'BARRAS_OBRIGATORIA'; end if;

    v_endereco_sep := upper(nullif(trim(coalesce(p_endereco_sep, '')), ''));
    if v_endereco_sep is null then raise exception 'ENDERECO_SEP_OBRIGATORIO'; end if;

    v_val_mmaa := app.ctrl_validade_normalize_val_mmaa(p_val_mmaa);

    v_client_event_id := nullif(trim(coalesce(p_client_event_id, '')), '');
    if v_client_event_id is null then
        v_client_event_id := format('linha-coleta:%s', gen_random_uuid()::text);
    end if;

    if exists (
        select 1
        from app.ctrl_validade_linha_coletas c
        where c.client_event_id = v_client_event_id
    ) then
        return query
        select
            c.id,
            c.client_event_id,
            c.cd,
            c.barras,
            c.coddv,
            c.descricao,
            c.endereco_sep,
            c.val_mmaa,
            1::integer as qtd,
            c.data_coleta,
            c.auditor_id,
            c.auditor_mat,
            c.auditor_nome,
            c.created_at,
            c.updated_at
        from app.ctrl_validade_linha_coletas c
        where c.client_event_id = v_client_event_id
        limit 1;
        return;
    end if;

    select
        b.coddv,
        coalesce(nullif(trim(coalesce(b.descricao, '')), ''), format('CODDV %s', b.coddv))
    into
        v_coddv,
        v_descricao
    from app.db_barras b
    where b.barras = v_barras
    order by b.updated_at desc nulls last, b.coddv
    limit 1;

    if coalesce(v_coddv, 0) <= 0 then
        raise exception 'PRODUTO_NAO_ENCONTRADO';
    end if;

    if not exists (
        select 1
        from app.db_end d
        where d.cd = v_cd
          and d.coddv = v_coddv
          and upper(trim(coalesce(d.tipo, ''))) = 'SEP'
          and upper(trim(coalesce(d.endereco, ''))) = v_endereco_sep
    ) then
        raise exception 'ENDERECO_SEP_INVALIDO';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    return query
    insert into app.ctrl_validade_linha_coletas (
        client_event_id,
        cd,
        barras,
        coddv,
        descricao,
        endereco_sep,
        val_mmaa,
        data_coleta,
        auditor_id,
        auditor_mat,
        auditor_nome
    )
    values (
        v_client_event_id,
        v_cd,
        v_barras,
        v_coddv,
        v_descricao,
        v_endereco_sep,
        v_val_mmaa,
        coalesce(p_data_hr, timezone('utc', now())),
        v_uid,
        coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
    )
    returning
        ctrl_validade_linha_coletas.id,
        ctrl_validade_linha_coletas.client_event_id,
        ctrl_validade_linha_coletas.cd,
        ctrl_validade_linha_coletas.barras,
        ctrl_validade_linha_coletas.coddv,
        ctrl_validade_linha_coletas.descricao,
        ctrl_validade_linha_coletas.endereco_sep,
        ctrl_validade_linha_coletas.val_mmaa,
        1::integer as qtd,
        ctrl_validade_linha_coletas.data_coleta,
        ctrl_validade_linha_coletas.auditor_id,
        ctrl_validade_linha_coletas.auditor_mat,
        ctrl_validade_linha_coletas.auditor_nome,
        ctrl_validade_linha_coletas.created_at,
        ctrl_validade_linha_coletas.updated_at;
end;
$$;

create or replace function public.rpc_ctrl_validade_linha_coleta_update_val_mmaa(
    p_id uuid default null,
    p_val_mmaa text default null
)
returns table (
    id uuid,
    cd integer,
    coddv integer,
    descricao text,
    barras text,
    zona text,
    endereco_sep text,
    val_mmaa text,
    data_coleta timestamptz,
    auditor_id uuid,
    auditor_mat text,
    auditor_nome text,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_row app.ctrl_validade_linha_coletas%rowtype;
    v_new_val_mmaa text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_id is null then raise exception 'REGISTRO_NAO_ENCONTRADO'; end if;

    select *
    into v_row
    from app.ctrl_validade_linha_coletas c
    where c.id = p_id
    limit 1;

    if v_row.id is null then
        raise exception 'REGISTRO_NAO_ENCONTRADO';
    end if;
    if v_row.auditor_id <> v_uid then
        raise exception 'APENAS_AUTOR_PODE_EDITAR';
    end if;

    if exists (
        select 1
        from app.ctrl_validade_linha_retiradas r
        where r.cd = v_row.cd
          and r.coddv = v_row.coddv
          and upper(trim(r.endereco_sep)) = upper(trim(v_row.endereco_sep))
          and r.val_mmaa = v_row.val_mmaa
          and r.ref_coleta_mes = app.ctrl_validade_month_ref(v_row.data_coleta)
        limit 1
    ) then
        raise exception 'COLETA_COM_RETIRADA_NAO_EDITAVEL';
    end if;

    v_new_val_mmaa := app.ctrl_validade_normalize_val_mmaa(p_val_mmaa);

    return query
    update app.ctrl_validade_linha_coletas c
    set val_mmaa = v_new_val_mmaa
    where c.id = v_row.id
    returning
        c.id,
        c.cd,
        c.coddv,
        c.descricao,
        c.barras,
        app.pvps_alocacao_normalize_zone(c.endereco_sep) as zona,
        upper(trim(c.endereco_sep)) as endereco_sep,
        c.val_mmaa,
        c.data_coleta,
        c.auditor_id,
        c.auditor_mat,
        c.auditor_nome,
        c.updated_at;
end;
$$;

grant execute on function public.rpc_ctrl_validade_linha_coleta_insert(integer, text, text, text, integer, timestamptz, text) to authenticated;
grant execute on function public.rpc_ctrl_validade_linha_coleta_update_val_mmaa(uuid, text) to authenticated;
