create table if not exists app.db_inventario_erro_end (
    erro_id bigserial primary key,
    cycle_date date not null,
    cd integer not null,
    contexto text not null,
    zona_auditada text,
    endereco_auditado text not null,
    coddv_esperado integer not null,
    descricao_esperada text,
    estoque_esperado integer,
    qtd_informada integer,
    barras_bipado text not null,
    coddv_bipado integer not null,
    descricao_bipada text,
    enderecos_base_end text[] not null default '{}'::text[],
    enderecos_sep_corretos text[] not null default '{}'::text[],
    zonas_sep_corretas text[] not null default '{}'::text[],
    tipos_base_end text[] not null default '{}'::text[],
    usuario_id uuid not null,
    usuario_mat text,
    usuario_nome text,
    snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint ck_db_inventario_erro_end_estoque_non_negative check (estoque_esperado is null or estoque_esperado >= 0),
    constraint ck_db_inventario_erro_end_qtd_non_negative check (qtd_informada is null or qtd_informada >= 0)
);

create index if not exists idx_db_inventario_erro_end_cycle_cd_created
    on app.db_inventario_erro_end(cycle_date, cd, created_at desc);

create index if not exists idx_db_inventario_erro_end_cd_barras
    on app.db_inventario_erro_end(cd, barras_bipado, created_at desc);

create index if not exists idx_db_inventario_erro_end_cd_expected_item
    on app.db_inventario_erro_end(cd, endereco_auditado, coddv_esperado, created_at desc);

create or replace function public.rpc_conf_inventario_log_erro_end(
    p_cycle_date date,
    p_cd integer,
    p_contexto text,
    p_zona_auditada text,
    p_endereco_auditado text,
    p_coddv_esperado integer,
    p_descricao_esperada text default null,
    p_estoque_esperado integer default null,
    p_qtd_informada integer default null,
    p_barras_bipado text default null
)
returns table (
    logged boolean,
    info text,
    erro_id bigint
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_cycle_date date;
    v_contexto text;
    v_zona_auditada text;
    v_endereco_auditado text;
    v_coddv_esperado integer;
    v_descricao_esperada text;
    v_estoque_esperado integer;
    v_qtd_informada integer;
    v_barras text;
    v_profile record;
    v_mat text;
    v_nome text;
    v_bipado record;
    v_base record;
    v_enderecos_base_end text[] := '{}'::text[];
    v_enderecos_sep_corretos text[] := '{}'::text[];
    v_zonas_sep_corretas text[] := '{}'::text[];
    v_tipos_base_end text[] := '{}'::text[];
    v_inserted_id bigint;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    if not authz.can_access_cd(v_uid, v_cd) and not authz.is_admin(v_uid) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_cycle_date := coalesce(p_cycle_date, app.conf_inventario_today());
    v_contexto := lower(nullif(trim(coalesce(p_contexto, '')), ''));
    v_zona_auditada := upper(nullif(trim(coalesce(p_zona_auditada, '')), ''));
    v_endereco_auditado := upper(nullif(trim(coalesce(p_endereco_auditado, '')), ''));
    v_coddv_esperado := p_coddv_esperado;
    v_descricao_esperada := nullif(trim(coalesce(p_descricao_esperada, '')), '');
    v_estoque_esperado := case
        when p_estoque_esperado is null then null
        else greatest(p_estoque_esperado, 0)
    end;
    v_qtd_informada := case
        when p_qtd_informada is null then null
        else greatest(p_qtd_informada, 0)
    end;
    v_barras := regexp_replace(trim(coalesce(p_barras_bipado, '')), '\D', '', 'g');

    if v_contexto is null or v_endereco_auditado is null or v_coddv_esperado is null or v_barras = '' then
        return query select false, 'PARAMETROS_INVALIDOS', null::bigint;
        return;
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    select
        b.coddv,
        nullif(trim(coalesce(b.descricao, '')), '') as descricao
    into v_bipado
    from app.db_barras b
    where b.barras = v_barras
    order by b.updated_at desc
    limit 1;

    if v_bipado.coddv is null then
        return query select false, 'BARRAS_NAO_ENCONTRADA', null::bigint;
        return;
    end if;

    if v_bipado.coddv = v_coddv_esperado then
        return query select false, 'SEM_DIVERGENCIA', null::bigint;
        return;
    end if;

    if v_descricao_esperada is null or v_estoque_esperado is null then
        select
            b.descricao,
            b.estoque
        into v_base
        from app.db_inventario b
        where b.cd = v_cd
          and upper(trim(b.endereco)) = v_endereco_auditado
          and b.coddv = v_coddv_esperado
        limit 1;

        v_descricao_esperada := coalesce(v_descricao_esperada, nullif(trim(coalesce(v_base.descricao, '')), ''));
        v_estoque_esperado := coalesce(v_estoque_esperado, v_base.estoque);
    end if;

    select
        coalesce(
            array_agg(distinct upper(trim(e.endereco)) order by upper(trim(e.endereco)))
                filter (where nullif(trim(coalesce(e.endereco, '')), '') is not null),
            '{}'::text[]
        ),
        coalesce(
            array_agg(distinct upper(trim(e.endereco)) order by upper(trim(e.endereco)))
                filter (
                    where upper(trim(coalesce(e.tipo, ''))) = 'SEP'
                      and nullif(trim(coalesce(e.endereco, '')), '') is not null
                ),
            '{}'::text[]
        ),
        coalesce(
            array_agg(distinct app.conf_inventario_zone_from_sep_endereco(e.endereco) order by app.conf_inventario_zone_from_sep_endereco(e.endereco))
                filter (
                    where upper(trim(coalesce(e.tipo, ''))) = 'SEP'
                      and nullif(trim(coalesce(e.endereco, '')), '') is not null
                ),
            '{}'::text[]
        ),
        coalesce(
            array_agg(distinct upper(trim(coalesce(e.tipo, ''))) order by upper(trim(coalesce(e.tipo, ''))))
                filter (where nullif(trim(coalesce(e.tipo, '')), '') is not null),
            '{}'::text[]
        )
    into
        v_enderecos_base_end,
        v_enderecos_sep_corretos,
        v_zonas_sep_corretas,
        v_tipos_base_end
    from app.db_end e
    where e.cd = v_cd
      and e.coddv = v_bipado.coddv;

    insert into app.db_inventario_erro_end (
        cycle_date,
        cd,
        contexto,
        zona_auditada,
        endereco_auditado,
        coddv_esperado,
        descricao_esperada,
        estoque_esperado,
        qtd_informada,
        barras_bipado,
        coddv_bipado,
        descricao_bipada,
        enderecos_base_end,
        enderecos_sep_corretos,
        zonas_sep_corretas,
        tipos_base_end,
        usuario_id,
        usuario_mat,
        usuario_nome,
        snapshot
    )
    values (
        v_cycle_date,
        v_cd,
        v_contexto,
        v_zona_auditada,
        v_endereco_auditado,
        v_coddv_esperado,
        v_descricao_esperada,
        v_estoque_esperado,
        v_qtd_informada,
        v_barras,
        v_bipado.coddv,
        v_bipado.descricao,
        v_enderecos_base_end,
        v_enderecos_sep_corretos,
        v_zonas_sep_corretas,
        v_tipos_base_end,
        v_uid,
        v_mat,
        v_nome,
        jsonb_build_object(
            'cycle_date', v_cycle_date,
            'contexto', v_contexto,
            'auditado', jsonb_build_object(
                'zona', v_zona_auditada,
                'endereco', v_endereco_auditado,
                'coddv', v_coddv_esperado,
                'descricao', v_descricao_esperada,
                'estoque', v_estoque_esperado,
                'qtd', v_qtd_informada
            ),
            'bipado', jsonb_build_object(
                'barras', v_barras,
                'coddv', v_bipado.coddv,
                'descricao', v_bipado.descricao
            ),
            'base_end', jsonb_build_object(
                'enderecos', v_enderecos_base_end,
                'enderecos_sep', v_enderecos_sep_corretos,
                'zonas_sep', v_zonas_sep_corretas,
                'tipos', v_tipos_base_end
            )
        )
    )
    returning app.db_inventario_erro_end.erro_id into v_inserted_id;

    return query select true, 'ERRO_END_LOGADO', v_inserted_id;
end;
$$;

create or replace function public.rpc_conf_inventario_erro_end_count(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer
)
returns bigint
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_count bigint;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
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

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    if not authz.can_access_cd(v_uid, p_cd) and not authz.is_admin(v_uid) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    select count(*)
    into v_count
    from app.db_inventario_erro_end e
    where e.cd = p_cd
      and e.cycle_date >= p_dt_ini
      and e.cycle_date <= p_dt_fim;

    return coalesce(v_count, 0);
end;
$$;

create or replace function public.rpc_conf_inventario_erro_end_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_offset integer default 0,
    p_limit integer default 5000
)
returns table (
    erro_id bigint,
    cycle_date date,
    created_at timestamptz,
    cd integer,
    contexto text,
    usuario_mat text,
    usuario_nome text,
    zona_auditada text,
    endereco_auditado text,
    coddv_esperado integer,
    descricao_esperada text,
    estoque_esperado integer,
    qtd_informada integer,
    barras_bipado text,
    coddv_bipado integer,
    descricao_bipada text,
    zonas_sep_corretas text,
    enderecos_sep_corretos text,
    enderecos_base_end text,
    tipos_base_end text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_offset integer;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
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

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    if not authz.can_access_cd(v_uid, p_cd) and not authz.is_admin(v_uid) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 5000), 1), 50000);

    return query
    select
        e.erro_id,
        e.cycle_date,
        e.created_at,
        e.cd,
        e.contexto,
        e.usuario_mat,
        e.usuario_nome,
        e.zona_auditada,
        e.endereco_auditado,
        e.coddv_esperado,
        e.descricao_esperada,
        e.estoque_esperado,
        e.qtd_informada,
        e.barras_bipado,
        e.coddv_bipado,
        e.descricao_bipada,
        nullif(array_to_string(e.zonas_sep_corretas, ', '), '') as zonas_sep_corretas,
        nullif(array_to_string(e.enderecos_sep_corretos, ', '), '') as enderecos_sep_corretos,
        nullif(array_to_string(e.enderecos_base_end, ', '), '') as enderecos_base_end,
        nullif(array_to_string(e.tipos_base_end, ', '), '') as tipos_base_end
    from app.db_inventario_erro_end e
    where e.cd = p_cd
      and e.cycle_date >= p_dt_ini
      and e.cycle_date <= p_dt_fim
    order by e.created_at desc, e.erro_id desc
    offset v_offset
    limit v_limit;
end;
$$;

grant execute on function public.rpc_conf_inventario_log_erro_end(date, integer, text, text, text, integer, text, integer, integer, text) to authenticated;
grant execute on function public.rpc_conf_inventario_erro_end_count(date, date, integer) to authenticated;
grant execute on function public.rpc_conf_inventario_erro_end_rows(date, date, integer, integer, integer) to authenticated;
