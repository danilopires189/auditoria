-- Allow scoped admin (linked CD) read-only open in conference modules



create or replace function public.rpc_conf_termo_open_volume(
    p_id_etiqueta text,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    id_etiqueta text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    status text,
    falta_motivo text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_tag text;
    v_today date;
    v_profile record;
    v_conf app.conf_termo%rowtype;
    v_user_active app.conf_termo%rowtype;
    v_read_only boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_termo_autoclose_stale();

    v_cd := app.conf_termo_resolve_cd(p_cd);
    v_tag := nullif(trim(coalesce(p_id_etiqueta, '')), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'ETIQUETA_OBRIGATORIA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    select *
    into v_user_active
    from app.conf_termo c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and (v_user_active.cd <> v_cd or v_user_active.id_etiqueta <> v_tag) then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_ETIQUETA';
    end if;

    if not exists (
        select 1
        from app.db_termo t
        where t.cd = v_cd
          and t.id_etiqueta = v_tag
    ) then
        raise exception 'ETIQUETA_NAO_ENCONTRADA';
    end if;

    select *
    into v_conf
    from app.conf_termo c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.id_etiqueta = v_tag
    limit 1;

    if found then
        if v_conf.started_by <> v_uid then
            if coalesce(v_profile.role, '') = 'admin' then
                v_read_only := true;
            else
                if v_conf.status = 'em_conferencia' then
                    raise exception 'VOLUME_EM_USO';
                end if;
                raise exception 'VOLUME_JA_CONFERIDO_OUTRO_USUARIO';
            end if;
        else
            v_read_only := v_conf.status <> 'em_conferencia';
        end if;
    else
        with src as (
            select
                min(nullif(trim(t.caixa::text), '')) as caixa,
                min(t.pedido) as pedido,
                min(t.filial) as filial,
                coalesce(
                    min(nullif(trim(r.nome), '')),
                    format('FILIAL %s', min(t.filial))
                ) as filial_nome,
                coalesce(
                    min(nullif(trim(r.rota), '')),
                    min(nullif(trim(t.num_rota), '')),
                    'SEM ROTA'
                ) as rota
            from app.db_termo t
            left join app.db_rotas r
              on r.cd = t.cd
             and r.filial = t.filial
            where t.cd = v_cd
              and t.id_etiqueta = v_tag
        )
        insert into app.conf_termo (
            conf_date,
            cd,
            id_etiqueta,
            caixa,
            pedido,
            filial,
            filial_nome,
            rota,
            started_by,
            started_mat,
            started_nome,
            status,
            falta_motivo,
            started_at,
            finalized_at,
            updated_at
        )
        select
            v_today,
            v_cd,
            v_tag,
            src.caixa,
            src.pedido,
            src.filial,
            src.filial_nome,
            src.rota,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            null,
            now(),
            null,
            now()
        from src
        returning * into v_conf;

        insert into app.conf_termo_itens (
            conf_id,
            coddv,
            descricao,
            qtd_esperada,
            qtd_conferida,
            updated_at
        )
        select
            v_conf.conf_id,
            t.coddv,
            coalesce(
                min(nullif(trim(t.descricao), '')),
                format('CODDV %s', t.coddv)
            ),
            sum(greatest(coalesce(t.qtd_separada, 0)::integer, 0))::integer,
            0,
            now()
        from app.db_termo t
        where t.cd = v_cd
          and t.id_etiqueta = v_tag
        group by t.coddv
        on conflict on constraint uq_conf_termo_itens
        do update set
            descricao = excluded.descricao,
            qtd_esperada = excluded.qtd_esperada,
            updated_at = now();

        v_read_only := false;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.id_etiqueta,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_termo c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_open_volume(
    p_id_vol text,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    id_vol text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    status text,
    falta_motivo text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_tag text;
    v_today date;
    v_profile record;
    v_conf app.conf_pedido_direto%rowtype;
    v_user_active app.conf_pedido_direto%rowtype;
    v_read_only boolean;
    v_source_count integer := 0;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_pedido_direto_autoclose_stale();

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);
    v_tag := nullif(regexp_replace(coalesce(p_id_vol, ''), '\s+', '', 'g'), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'ID_VOL_OBRIGATORIO';
    end if;

    if v_tag ~ '^[0-9]+&[0-9]+$' then
        begin
            v_tag := (split_part(v_tag, '&', 1)::bigint)::text || (split_part(v_tag, '&', 2)::bigint)::text;
        exception
            when numeric_value_out_of_range then
                raise exception 'ID_VOL_INVALIDO';
        end;
    elsif v_tag ~ '^[0-9]+$' then
        v_tag := ltrim(v_tag, '0');
        if v_tag = '' then
            v_tag := '0';
        end if;
    else
        raise exception 'ID_VOL_INVALIDO';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    select *
    into v_user_active
    from app.conf_pedido_direto c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and (v_user_active.cd <> v_cd or v_user_active.id_vol <> v_tag) then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRO_ID_VOL';
    end if;

    with source as (
        select
            app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq) as id_vol,
            t.pedido,
            t.sq
        from app.db_pedido_direto t
        where t.cd = v_cd
    )
    select count(*)
    into v_source_count
    from (
        select distinct s.pedido, s.sq
        from source s
        where s.id_vol = v_tag
    ) src;

    if coalesce(v_source_count, 0) = 0 then
        raise exception 'ID_VOL_NAO_ENCONTRADO';
    end if;

    if v_source_count > 1 then
        raise exception 'ID_VOL_AMBIGUO';
    end if;

    select *
    into v_conf
    from app.conf_pedido_direto c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.id_vol = v_tag
    limit 1;

    if found then
        if v_conf.started_by <> v_uid then
            if coalesce(v_profile.role, '') = 'admin' then
                v_read_only := true;
            else
                if v_conf.status = 'em_conferencia' then
                    raise exception 'VOLUME_EM_USO';
                end if;
                raise exception 'VOLUME_JA_CONFERIDO_OUTRO_USUARIO';
            end if;
        else
            v_read_only := v_conf.status <> 'em_conferencia';
        end if;
    else
        with source as (
            select
                app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq) as id_vol,
                null::text as caixa,
                t.pedido,
                t.sq,
                t.filial,
                t.coddv,
                t.descricao,
                t.qtd_fat as qtd_separada,
                null::text as num_rota
            from app.db_pedido_direto t
            where t.cd = v_cd
        ),
        src as (
            select
                min(nullif(trim(s.caixa), '')) as caixa,
                min(s.pedido) as pedido,
                min(s.sq) as sq,
                min(s.filial) as filial,
                coalesce(
                    min(nullif(trim(r.nome), '')),
                    format('FILIAL %s', min(s.filial))
                ) as filial_nome,
                coalesce(
                    min(nullif(trim(r.rota), '')),
                    min(nullif(trim(s.num_rota), '')),
                    'SEM ROTA'
                ) as rota
            from source s
            left join app.db_rotas r
              on r.cd = v_cd
             and r.filial = s.filial
            where s.id_vol = v_tag
        )
        insert into app.conf_pedido_direto (
            conf_date,
            cd,
            id_vol,
            caixa,
            pedido,
            sq,
            filial,
            filial_nome,
            rota,
            started_by,
            started_mat,
            started_nome,
            status,
            falta_motivo,
            started_at,
            finalized_at,
            updated_at
        )
        select
            v_today,
            v_cd,
            v_tag,
            src.caixa,
            src.pedido,
            src.sq,
            src.filial,
            src.filial_nome,
            src.rota,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            null,
            now(),
            null,
            now()
        from src
        returning * into v_conf;

        with source as (
            select
                app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq) as id_vol,
                t.coddv,
                t.descricao,
                t.qtd_fat as qtd_separada
            from app.db_pedido_direto t
            where t.cd = v_cd
        )
        insert into app.conf_pedido_direto_itens (
            conf_id,
            coddv,
            descricao,
            qtd_esperada,
            qtd_conferida,
            updated_at
        )
        select
            v_conf.conf_id,
            s.coddv,
            coalesce(
                min(nullif(trim(s.descricao), '')),
                format('CODDV %s', s.coddv)
            ),
            sum(greatest(coalesce(s.qtd_separada, 0)::integer, 0))::integer,
            0,
            now()
        from source s
        where s.id_vol = v_tag
        group by s.coddv
        on conflict on constraint uq_conf_pedido_direto_itens
        do update set
            descricao = excluded.descricao,
            qtd_esperada = excluded.qtd_esperada,
            updated_at = now();

        v_read_only := false;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.id_vol,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_pedido_direto c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_open_volume(
    p_nr_volume text,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    nr_volume text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    status text,
    falta_motivo text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_tag text;
    v_today date;
    v_profile record;
    v_conf app.conf_volume_avulso%rowtype;
    v_user_active app.conf_volume_avulso%rowtype;
    v_read_only boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_volume_avulso_autoclose_stale();

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);
    v_tag := nullif(trim(coalesce(p_nr_volume, '')), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'VOLUME_OBRIGATORIO';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    select *
    into v_user_active
    from app.conf_volume_avulso c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and (v_user_active.cd <> v_cd or v_user_active.nr_volume <> v_tag) then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRO_VOLUME';
    end if;

    if not exists (
        select 1
        from app.db_avulso t
        where t.cd = v_cd
          and t.nr_volume = v_tag
    ) then
        raise exception 'VOLUME_NAO_ENCONTRADO';
    end if;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.nr_volume = v_tag
    limit 1;

    if found then
        if v_conf.started_by <> v_uid then
            if coalesce(v_profile.role, '') = 'admin' then
                v_read_only := true;
            else
                if v_conf.status = 'em_conferencia' then
                    raise exception 'VOLUME_EM_USO';
                end if;
                raise exception 'VOLUME_JA_CONFERIDO_OUTRO_USUARIO';
            end if;
        else
            v_read_only := v_conf.status <> 'em_conferencia';
        end if;
    else
        insert into app.conf_volume_avulso (
            conf_date,
            cd,
            nr_volume,
            caixa,
            pedido,
            filial,
            filial_nome,
            rota,
            started_by,
            started_mat,
            started_nome,
            status,
            falta_motivo,
            started_at,
            finalized_at,
            updated_at
        )
        values (
            v_today,
            v_cd,
            v_tag,
            null,
            null,
            null,
            null,
            null,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            null,
            now(),
            null,
            now()
        )
        returning * into v_conf;

        insert into app.conf_volume_avulso_itens (
            conf_id,
            nr_volume,
            coddv,
            barras,
            descricao,
            qtd_esperada,
            qtd_conferida,
            updated_at
        )
        select
            v_conf.conf_id,
            v_tag,
            t.coddv,
            null,
            coalesce(
                min(nullif(trim(t.descricao), '')),
                format('CODDV %s', t.coddv)
            ),
            greatest(sum(greatest(coalesce(t.qtd_mov, 0)::integer, 0))::integer, 1),
            0,
            now()
        from app.db_avulso t
        where t.cd = v_cd
          and t.nr_volume = v_tag
          and t.coddv is not null
        group by t.coddv
        on conflict on constraint uq_conf_volume_avulso_itens
        do update set
            nr_volume = excluded.nr_volume,
            descricao = excluded.descricao,
            qtd_esperada = excluded.qtd_esperada,
            updated_at = now();

        v_read_only := false;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.nr_volume,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_volume_avulso c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_open_conference(
    p_seq_entrada bigint,
    p_nf bigint,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    seq_entrada bigint,
    nf bigint,
    transportadora text,
    fornecedor text,
    status text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_seq bigint;
    v_nf bigint;
    v_today date;
    v_profile record;
    v_conf app.conf_entrada_notas%rowtype;
    v_user_active app.conf_entrada_notas%rowtype;
    v_read_only boolean;
    v_transportadora text;
    v_fornecedor text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_entrada_notas_autoclose_stale();

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);
    v_seq := p_seq_entrada;
    v_nf := p_nf;
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_seq is null or v_nf is null then
        raise exception 'SEQ_OU_NF_OBRIGATORIO';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    select *
    into v_user_active
    from app.conf_entrada_notas c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and (
          v_user_active.cd <> v_cd
          or v_user_active.seq_entrada <> v_seq
          or v_user_active.nf <> v_nf
       ) then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_ENTRADA';
    end if;

    if not exists (
        select 1
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada = v_seq
          and t.nf = v_nf
    ) then
        raise exception 'ENTRADA_NAO_ENCONTRADA';
    end if;

    select *
    into v_conf
    from app.conf_entrada_notas c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.seq_entrada = v_seq
      and c.nf = v_nf
    limit 1;

    if found then
        if v_conf.started_by <> v_uid and v_conf.status = 'em_conferencia' then
            if coalesce(v_profile.role, '') = 'admin' then
                v_read_only := true;
            else
                raise exception 'CONFERENCIA_EM_USO';
            end if;
        else
            v_read_only := v_conf.status <> 'em_conferencia';
        end if;
    else
        select
            coalesce(min(nullif(trim(t.transportadora), '')), 'SEM TRANSPORTADORA'),
            coalesce(min(nullif(trim(t.forn), '')), 'SEM FORNECEDOR')
        into
            v_transportadora,
            v_fornecedor
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada = v_seq
          and t.nf = v_nf;

        insert into app.conf_entrada_notas (
            conf_date,
            cd,
            seq_entrada,
            nf,
            transportadora,
            fornecedor,
            started_by,
            started_mat,
            started_nome,
            status,
            started_at,
            finalized_at,
            updated_at
        )
        values (
            v_today,
            v_cd,
            v_seq,
            v_nf,
            v_transportadora,
            v_fornecedor,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            now(),
            null,
            now()
        )
        returning * into v_conf;

        insert into app.conf_entrada_notas_itens (
            conf_id,
            seq_entrada,
            nf,
            coddv,
            barras,
            descricao,
            qtd_esperada,
            qtd_conferida,
            updated_at
        )
        select
            v_conf.conf_id,
            v_seq,
            v_nf,
            t.coddv,
            null,
            coalesce(
                min(nullif(trim(t.descricao), '')),
                format('CODDV %s', t.coddv)
            ),
            greatest(sum(greatest(coalesce(t.qtd_total, 0)::integer, 0))::integer, 1),
            0,
            now()
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada = v_seq
          and t.nf = v_nf
          and t.coddv is not null
        group by t.coddv
        on conflict on constraint uq_conf_entrada_notas_itens
        do update set
            seq_entrada = excluded.seq_entrada,
            nf = excluded.nf,
            descricao = excluded.descricao,
            qtd_esperada = excluded.qtd_esperada,
            updated_at = now();

        v_read_only := false;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.seq_entrada,
        c.nf,
        c.transportadora,
        c.fornecedor,
        c.status,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_entrada_notas c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_termo_get_items_v2(p_conf_id uuid)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    barras text,
    descricao text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_profile record;
    v_conf app.conf_termo%rowtype;
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

    select *
    into v_conf
    from app.conf_termo c
    where c.conf_id = p_conf_id
      and (
          c.started_by = v_uid
          or (
              coalesce(v_profile.role, '') = 'admin'
              and authz.can_access_cd(v_uid, c.cd)
          )
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    return query
    select
        i.item_id,
        i.conf_id,
        i.coddv,
        i.barras,
        i.descricao,
        i.qtd_esperada,
        i.qtd_conferida,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at
    from app.conf_termo_itens i
    where i.conf_id = v_conf.conf_id
    order by
        case
            when i.qtd_conferida < i.qtd_esperada then 1
            when i.qtd_conferida > i.qtd_esperada then 2
            else 3
        end,
        i.coddv;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_get_items_v2(p_conf_id uuid)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    barras text,
    descricao text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_profile record;
    v_conf app.conf_pedido_direto%rowtype;
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

    select *
    into v_conf
    from app.conf_pedido_direto c
    where c.conf_id = p_conf_id
      and (
          c.started_by = v_uid
          or (
              coalesce(v_profile.role, '') = 'admin'
              and authz.can_access_cd(v_uid, c.cd)
          )
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    return query
    select
        i.item_id,
        i.conf_id,
        i.coddv,
        i.barras,
        i.descricao,
        i.qtd_esperada,
        i.qtd_conferida,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at
    from app.conf_pedido_direto_itens i
    where i.conf_id = v_conf.conf_id
    order by
        case
            when i.qtd_conferida < i.qtd_esperada then 1
            when i.qtd_conferida > i.qtd_esperada then 2
            else 3
        end,
        i.coddv;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_get_items_v2(p_conf_id uuid)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    barras text,
    descricao text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    lotes text,
    validades text,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_profile record;
    v_conf app.conf_volume_avulso%rowtype;
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

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_id = p_conf_id
      and (
          c.started_by = v_uid
          or (
              coalesce(v_profile.role, '') = 'admin'
              and authz.can_access_cd(v_uid, c.cd)
          )
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    return query
    select
        i.item_id,
        i.conf_id,
        i.coddv,
        i.barras,
        i.descricao,
        i.qtd_esperada,
        i.qtd_conferida,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        lv.lotes,
        lv.validades,
        i.updated_at
    from app.conf_volume_avulso_itens i
    left join lateral (
        select
            nullif(
                string_agg(
                    distinct nullif(trim(t.lote), ''),
                    ', ' order by nullif(trim(t.lote), '')
                ),
                ''
            ) as lotes,
            nullif(
                string_agg(
                    distinct nullif(trim(t.val), ''),
                    ', ' order by nullif(trim(t.val), '')
                ),
                ''
            ) as validades
        from app.db_avulso t
        where t.cd = v_conf.cd
          and t.nr_volume = v_conf.nr_volume
          and t.coddv = i.coddv
    ) lv on true
    where i.conf_id = v_conf.conf_id
    order by
        case
            when i.qtd_conferida < i.qtd_esperada then 1
            when i.qtd_conferida > i.qtd_esperada then 2
            else 3
        end,
        i.coddv;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_get_items_v2(p_conf_id uuid)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    barras text,
    descricao text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    updated_at timestamptz,
    is_locked boolean,
    locked_by uuid,
    locked_mat text,
    locked_nome text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_profile record;
    v_conf app.conf_entrada_notas%rowtype;
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

    select *
    into v_conf
    from app.conf_entrada_notas c
    where c.conf_id = p_conf_id
      and (
          c.started_by = v_uid
          or (
              coalesce(v_profile.role, '') = 'admin'
              and authz.can_access_cd(v_uid, c.cd)
          )
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    return query
    select
        i.item_id,
        i.conf_id,
        i.coddv,
        i.barras,
        i.descricao,
        i.qtd_esperada,
        i.qtd_conferida,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at,
        (
            i.qtd_conferida > 0
            and i.locked_by is not null
            and i.locked_by <> v_uid
        ) as is_locked,
        i.locked_by,
        i.locked_mat,
        i.locked_nome
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_conf.conf_id
    order by
        case
            when i.qtd_conferida < i.qtd_esperada then 1
            when i.qtd_conferida > i.qtd_esperada then 2
            else 3
        end,
        i.coddv;
end;
$$;
