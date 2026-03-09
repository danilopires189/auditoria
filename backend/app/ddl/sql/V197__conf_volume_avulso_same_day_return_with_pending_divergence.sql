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
    v_pending_items integer := 0;
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

    if not exists (
        select 1
        from app.db_avulso t
        where t.cd = v_cd
          and t.nr_volume = v_tag
    ) then
        raise exception 'VOLUME_NAO_ENCONTRADO';
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

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.cd = v_cd
      and c.nr_volume = v_tag
      and c.status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')
    order by c.updated_at desc nulls last, c.conf_date desc, c.started_at desc nulls last
    limit 1
    for update;

    if v_conf.conf_id is not null then
        v_read_only := true;

        if v_conf.status = 'em_conferencia'
           and v_conf.started_by = v_uid
           and v_conf.conf_date = v_today then
            v_read_only := false;
        elsif v_conf.status = 'finalizado_falta'
              and v_conf.started_by = v_uid
              and v_conf.conf_date = v_today then
            select count(*)::integer
            into v_pending_items
            from app.conf_volume_avulso_itens i
            where i.conf_id = v_conf.conf_id
              and i.qtd_conferida < i.qtd_esperada;

            if coalesce(v_pending_items, 0) > 0 then
                select *
                into v_profile
                from authz.current_profile_context_v2()
                limit 1;

                if v_profile.user_id is null then
                    raise exception 'PROFILE_NAO_ENCONTRADO';
                end if;

                update app.conf_volume_avulso c
                set
                    status = 'em_conferencia',
                    started_by = v_uid,
                    started_mat = coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
                    started_nome = coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
                    started_at = now(),
                    falta_motivo = null,
                    finalized_at = null,
                    updated_at = now()
                where c.conf_id = v_conf.conf_id
                returning * into v_conf;

                v_read_only := false;
            end if;
        end if;
    else
        select *
        into v_profile
        from authz.current_profile_context_v2()
        limit 1;

        if v_profile.user_id is null then
            raise exception 'PROFILE_NAO_ENCONTRADO';
        end if;

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

grant execute on function public.rpc_conf_volume_avulso_open_volume(text, integer) to authenticated;
