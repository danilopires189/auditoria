create or replace function public.rpc_conf_entrada_notas_open_conference_batch(
    p_targets jsonb,
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
    v_today date;
    v_profile record;
    v_seq_text text;
    v_nf_text text;
    v_seq bigint;
    v_nf bigint;
    v_label text;
    v_seen_labels text[] := '{}';
    v_conf app.conf_entrada_notas%rowtype;
    v_transportadora text;
    v_fornecedor text;
    v_mat text;
    v_nome text;
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
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if p_targets is null
       or jsonb_typeof(p_targets) <> 'array'
       or jsonb_array_length(p_targets) = 0 then
        raise exception 'SEQ_OU_NF_OBRIGATORIO';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    for v_seq_text, v_nf_text in
        select
            trim(coalesce(t.value->>'seq_entrada', '')),
            trim(coalesce(t.value->>'nf', ''))
        from jsonb_array_elements(p_targets) as t(value)
    loop
        if v_seq_text !~ '^\d+$' or v_nf_text !~ '^\d+$' then
            raise exception 'SEQ_NF_INVALIDO';
        end if;

        v_seq := v_seq_text::bigint;
        v_nf := v_nf_text::bigint;
        if v_seq <= 0 or v_nf <= 0 then
            raise exception 'SEQ_NF_INVALIDO';
        end if;

        v_label := format('%s/%s', v_seq, v_nf);
        if v_label = any(v_seen_labels) then
            continue;
        end if;
        v_seen_labels := array_append(v_seen_labels, v_label);

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
        for update
        limit 1;

        if found then
            if v_conf.status = 'em_conferencia' and v_conf.started_by <> v_uid then
                raise exception 'CONFERENCIA_EM_USO';
            end if;
            if v_conf.status <> 'em_conferencia' then
                raise exception 'CONFERENCIA_FINALIZADA_SEM_PENDENCIA';
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
                v_mat,
                v_nome,
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
        end if;

        perform app.conf_entrada_notas_touch_colaborador_from_session(v_conf.conf_id);

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
            false as is_read_only
        from app.conf_entrada_notas c
        where c.conf_id = v_conf.conf_id
        limit 1;
    end loop;
end;
$$;

grant execute on function public.rpc_conf_entrada_notas_open_conference_batch(jsonb, integer) to authenticated;
