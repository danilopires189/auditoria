delete from app.conf_inventario_reviews r
where r.status = 'pendente'
  and r.reason_code = 'conflito_lock'
  and not exists (
      select 1
      from app.conf_inventario_counts c2
      where c2.cycle_date = r.cycle_date
        and c2.cd = r.cd
        and c2.endereco = r.endereco
        and c2.coddv = r.coddv
        and c2.etapa = 2
  )
  and not exists (
      select 1
      from app.conf_inventario_counts c1
      where c1.cycle_date = r.cycle_date
        and c1.cd = r.cd
        and c1.endereco = r.endereco
        and c1.coddv = r.coddv
        and c1.etapa = 1
        and c1.resultado = 'sobra'
  );

delete from app.conf_inventario_reviews r
where r.status = 'pendente'
  and r.reason_code = 'sem_consenso'
  and not exists (
      select 1
      from app.conf_inventario_counts c1
      join app.conf_inventario_counts c2
        on c2.cycle_date = c1.cycle_date
       and c2.cd = c1.cd
       and c2.endereco = c1.endereco
       and c2.coddv = c1.coddv
       and c2.etapa = 2
      where c1.cycle_date = r.cycle_date
        and c1.cd = r.cd
        and c1.endereco = r.endereco
        and c1.coddv = r.coddv
        and c1.etapa = 1
        and c1.resultado <> 'descartado'
        and c2.resultado <> 'descartado'
        and c1.qtd_contada <> c2.qtd_contada
  );

create or replace function public.rpc_conf_inventario_apply_event(
    p_event_type text,
    p_payload jsonb,
    p_client_event_id uuid default null
)
returns table (
    accepted boolean,
    info text,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_event_type text;
    v_payload jsonb;
    v_profile record;
    v_mat text;
    v_nome text;

    v_cycle_date date;
    v_cd integer;
    v_zona text;
    v_endereco text;
    v_coddv integer;
    v_descricao text;
    v_estoque integer;
    v_etapa integer;
    v_qtd integer;
    v_barras text;
    v_discarded boolean;
    v_resultado text;

    v_c1 app.conf_inventario_counts%rowtype;
    v_c2 app.conf_inventario_counts%rowtype;
    v_review app.conf_inventario_reviews%rowtype;
    v_lock app.conf_inventario_zone_locks%rowtype;
    v_snapshot jsonb;
    v_base app.db_inventario%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_event_type := lower(trim(coalesce(p_event_type, '')));
    v_payload := coalesce(p_payload, '{}'::jsonb);

    if p_client_event_id is not null and exists (
        select 1 from app.conf_inventario_event_log e where e.client_event_id = p_client_event_id
    ) then
        return query select true, 'DUPLICATE_IGNORED', now();
        return;
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    if v_event_type = 'count_upsert' then
        v_cycle_date := coalesce((v_payload ->> 'cycle_date')::date, app.conf_inventario_today());
        v_cd := app.conf_inventario_resolve_cd(nullif(v_payload ->> 'cd', '')::integer);
        v_zona := upper(nullif(trim(coalesce(v_payload ->> 'zona', '')), ''));
        v_endereco := upper(nullif(trim(coalesce(v_payload ->> 'endereco', '')), ''));
        v_coddv := nullif(v_payload ->> 'coddv', '')::integer;
        v_descricao := nullif(trim(coalesce(v_payload ->> 'descricao', '')), '');
        v_estoque := nullif(v_payload ->> 'estoque', '')::integer;
        v_etapa := case when coalesce(nullif(v_payload ->> 'etapa', '')::integer, 1) = 2 then 2 else 1 end;
        v_qtd := greatest(coalesce(nullif(v_payload ->> 'qtd_contada', '')::integer, 0), 0);
        v_discarded := coalesce((v_payload ->> 'discarded')::boolean, false);

        if v_zona is null or v_endereco is null or v_coddv is null then
            raise exception 'ITEM_INVALIDO';
        end if;

        select * into v_base
        from app.db_inventario b
        where b.cd = v_cd and upper(b.endereco) = v_endereco and b.coddv = v_coddv
        limit 1;

        if v_base.cd is null then
            raise exception 'ITEM_BASE_NAO_ENCONTRADO';
        end if;

        if v_descricao is null then
            v_descricao := coalesce(nullif(trim(coalesce(v_base.descricao, '')), ''), format('CODDV %s', v_coddv));
        end if;

        if v_estoque is null then
            v_estoque := greatest(coalesce(v_base.estoque, 0), 0);
        else
            v_estoque := greatest(v_estoque, 0);
        end if;

        select * into v_review
        from app.conf_inventario_reviews r
        where r.cycle_date = v_cycle_date and r.cd = v_cd and r.endereco = v_endereco and r.coddv = v_coddv and r.status = 'resolvido'
        limit 1;

        if v_review.review_id is not null then
            raise exception 'ITEM_JA_RESOLVIDO';
        end if;

        select * into v_c1
        from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date and c.cd = v_cd and c.endereco = v_endereco and c.coddv = v_coddv and c.etapa = 1
        limit 1;

        select * into v_c2
        from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date and c.cd = v_cd and c.endereco = v_endereco and c.coddv = v_coddv and c.etapa = 2
        limit 1;

        if v_etapa = 1 and v_c2.count_id is not null then
            raise exception 'ETAPA1_BLOQUEADA_SEGUNDA_EXISTE';
        end if;

        if v_etapa = 1 and v_c1.count_id is not null and v_c1.counted_by <> v_uid then
            raise exception 'ETAPA1_APENAS_AUTOR';
        end if;

        if v_etapa = 2 then
            if v_c1.count_id is null then raise exception 'ETAPA1_OBRIGATORIA'; end if;
            if v_c1.resultado <> 'sobra' then raise exception 'ETAPA2_APENAS_QUANDO_SOBRA'; end if;
            if v_c2.count_id is null and v_c1.counted_by = v_uid then raise exception 'SEGUNDA_CONTAGEM_EXIGE_USUARIO_DIFERENTE'; end if;
            if v_c2.count_id is not null and v_c2.counted_by <> v_uid then raise exception 'ETAPA2_APENAS_AUTOR'; end if;
        end if;

        select * into v_lock
        from app.conf_inventario_zone_locks l
        where l.cycle_date = v_cycle_date and l.cd = v_cd and l.zona = v_zona and l.etapa = v_etapa
          and l.expires_at > now() and l.locked_by <> v_uid
        limit 1;

        if v_lock.lock_id is not null then
            if v_etapa = 2 then
                v_snapshot := jsonb_build_object(
                    'event_type', v_event_type,
                    'event_payload', v_payload,
                    'locked_by', v_lock.locked_by,
                    'locked_mat', v_lock.locked_mat,
                    'locked_nome', v_lock.locked_nome,
                    'lock_expires_at', v_lock.expires_at
                );

                perform app.conf_inventario_upsert_review_lock_conflict(
                    v_cycle_date, v_cd, v_zona, v_endereco, v_coddv, v_descricao, v_estoque, v_snapshot
                );

                if p_client_event_id is not null then
                    insert into app.conf_inventario_event_log (client_event_id, user_id, event_type, payload, status, info)
                    values (p_client_event_id, v_uid, v_event_type, v_payload, 'accepted', 'CONFLITO_LOCK_REVIEW');
                end if;

                return query select true, 'CONFLITO_LOCK_REVIEW', now();
                return;
            end if;

            raise exception 'ZONA_TRAVADA_OUTRO_USUARIO';
        end if;

        v_barras := null;
        if v_discarded then
            v_resultado := 'descartado';
            v_qtd := 0;
        else
            if v_qtd > v_estoque then
                v_barras := app.conf_inventario_validate_barras_for_coddv(v_payload ->> 'barras', v_coddv);
            end if;
            v_resultado := app.conf_inventario_compute_result(v_estoque, v_qtd, false);
        end if;

        insert into app.conf_inventario_counts (
            cycle_date, cd, zona, endereco, coddv, descricao, estoque, etapa,
            qtd_contada, barras, resultado, counted_by, counted_mat, counted_nome, client_event_id
        )
        values (
            v_cycle_date, v_cd, v_zona, v_endereco, v_coddv, v_descricao, v_estoque, v_etapa,
            v_qtd, v_barras, v_resultado, v_uid, v_mat, v_nome, p_client_event_id
        )
        on conflict (cycle_date, cd, endereco, coddv, etapa)
        do update set
            zona = excluded.zona,
            descricao = excluded.descricao,
            estoque = excluded.estoque,
            qtd_contada = excluded.qtd_contada,
            barras = excluded.barras,
            resultado = excluded.resultado,
            counted_by = excluded.counted_by,
            counted_mat = excluded.counted_mat,
            counted_nome = excluded.counted_nome,
            client_event_id = excluded.client_event_id,
            updated_at = now();

        perform app.conf_inventario_refresh_review_state(v_cycle_date, v_cd, v_zona, v_endereco, v_coddv);

        if p_client_event_id is not null then
            insert into app.conf_inventario_event_log (client_event_id, user_id, event_type, payload, status, info)
            values (p_client_event_id, v_uid, v_event_type, v_payload, 'accepted', 'COUNT_SAVED');
        end if;

        return query select true, 'COUNT_SAVED', now();
        return;
    elsif v_event_type = 'review_resolve' then
        v_cycle_date := coalesce((v_payload ->> 'cycle_date')::date, app.conf_inventario_today());
        v_cd := app.conf_inventario_resolve_cd(nullif(v_payload ->> 'cd', '')::integer);
        v_zona := upper(nullif(trim(coalesce(v_payload ->> 'zona', '')), ''));
        v_endereco := upper(nullif(trim(coalesce(v_payload ->> 'endereco', '')), ''));
        v_coddv := nullif(v_payload ->> 'coddv', '')::integer;
        v_qtd := greatest(coalesce(nullif(v_payload ->> 'final_qtd', '')::integer, 0), 0);

        if v_zona is null or v_endereco is null or v_coddv is null then
            raise exception 'ITEM_INVALIDO';
        end if;

        select * into v_review
        from app.conf_inventario_reviews r
        where r.cycle_date = v_cycle_date and r.cd = v_cd and r.endereco = v_endereco and r.coddv = v_coddv
        for update;

        if v_review.review_id is null then raise exception 'REVISAO_NAO_ENCONTRADA'; end if;
        if v_review.status = 'resolvido' then
            return query select true, 'REVIEW_ALREADY_RESOLVED', now();
            return;
        end if;

        v_estoque := greatest(coalesce(v_review.estoque, 0), 0);
        if v_qtd > v_estoque then
            v_barras := app.conf_inventario_validate_barras_for_coddv(v_payload ->> 'final_barras', v_coddv);
        else
            v_barras := null;
        end if;

        v_resultado := app.conf_inventario_compute_result(v_estoque, v_qtd, false);

        update app.conf_inventario_reviews r
        set status = 'resolvido',
            final_qtd = v_qtd,
            final_barras = v_barras,
            final_resultado = v_resultado,
            resolved_by = v_uid,
            resolved_mat = v_mat,
            resolved_nome = v_nome,
            resolved_at = now(),
            updated_at = now()
        where r.review_id = v_review.review_id;

        if p_client_event_id is not null then
            insert into app.conf_inventario_event_log (client_event_id, user_id, event_type, payload, status, info)
            values (p_client_event_id, v_uid, v_event_type, v_payload, 'accepted', 'REVIEW_RESOLVED');
        end if;

        return query select true, 'REVIEW_RESOLVED', now();
        return;
    end if;

    raise exception 'EVENTO_NAO_SUPORTADO';
exception
    when others then
        if p_client_event_id is not null and not exists (
            select 1 from app.conf_inventario_event_log e where e.client_event_id = p_client_event_id
        ) then
            insert into app.conf_inventario_event_log (client_event_id, user_id, event_type, payload, status, info)
            values (
                p_client_event_id,
                coalesce(v_uid, auth.uid()),
                coalesce(v_event_type, lower(trim(coalesce(p_event_type, '')))),
                coalesce(v_payload, coalesce(p_payload, '{}'::jsonb)),
                'error',
                sqlerrm
            );
        end if;
        raise;
end;
$$;

grant execute on function public.rpc_conf_inventario_apply_event(text, jsonb, uuid) to authenticated;
