drop function if exists public.rpc_ctrl_validade_linha_retirada_insert(integer, integer, text, text, date, integer, timestamptz, text);
drop function if exists public.rpc_ctrl_validade_pul_retirada_insert(integer, integer, text, text, integer, timestamptz, text);

create or replace function public.rpc_ctrl_validade_linha_retirada_insert(
    p_cd integer default null,
    p_coddv integer default null,
    p_endereco_sep text default null,
    p_val_mmaa text default null,
    p_ref_coleta_mes date default null,
    p_qtd_retirada integer default 1,
    p_data_hr timestamptz default null,
    p_client_event_id text default null
)
returns table (
    id uuid,
    client_event_id text,
    cd integer,
    coddv integer,
    descricao text,
    endereco_sep text,
    val_mmaa text,
    ref_coleta_mes date,
    qtd_retirada integer,
    data_retirada timestamptz,
    status text,
    qtd_pendente integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
    v_endereco_sep text;
    v_val_mmaa text;
    v_qtd_retirada integer;
    v_client_event_id text;
    v_descricao text;
    v_qtd_coletada integer;
    v_qtd_retirada_atual integer;
    v_qtd_pendente integer;
    v_regra text;
    v_ref_coleta_mes date;
    v_requested_ref_coleta_mes date;
    v_current_month_ref date;
    v_prev_month_ref date;
    v_current_month_idx integer;
    v_target_month_idx integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    if coalesce(p_coddv, 0) <= 0 then raise exception 'CODDV_INVALIDO'; end if;

    v_endereco_sep := upper(nullif(trim(coalesce(p_endereco_sep, '')), ''));
    if v_endereco_sep is null then raise exception 'ENDERECO_SEP_OBRIGATORIO'; end if;

    v_val_mmaa := app.pvps_alocacao_normalize_validade(p_val_mmaa);
    v_qtd_retirada := coalesce(p_qtd_retirada, 1);
    if v_qtd_retirada <= 0 then raise exception 'QTD_INVALIDA'; end if;

    v_client_event_id := nullif(trim(coalesce(p_client_event_id, '')), '');
    if v_client_event_id is null then
        v_client_event_id := format('linha-retirada:%s', gen_random_uuid()::text);
    end if;

    if exists (
        select 1
        from app.ctrl_validade_linha_retiradas r
        where r.client_event_id = v_client_event_id
    ) then
        return query
        with row_data as (
            select
                r.id,
                r.client_event_id,
                r.cd,
                r.coddv,
                r.descricao,
                r.endereco_sep,
                r.val_mmaa,
                r.ref_coleta_mes,
                r.qtd_retirada,
                r.data_retirada
            from app.ctrl_validade_linha_retiradas r
            where r.client_event_id = v_client_event_id
            limit 1
        ),
        totals as (
            select
                coalesce(sum(rr.qtd_retirada), 0)::integer as qtd_retirada_atual
            from row_data d
            left join app.ctrl_validade_linha_retiradas rr
              on rr.cd = d.cd
             and rr.coddv = d.coddv
             and upper(trim(rr.endereco_sep)) = upper(trim(d.endereco_sep))
             and rr.val_mmaa = d.val_mmaa
             and rr.ref_coleta_mes = d.ref_coleta_mes
        ),
        coletas as (
            select
                coalesce(sum(c.qtd), 0)::integer as qtd_coletada
            from row_data d
            left join app.ctrl_validade_linha_coletas c
              on c.cd = d.cd
             and c.coddv = d.coddv
             and upper(trim(c.endereco_sep)) = upper(trim(d.endereco_sep))
             and c.val_mmaa = d.val_mmaa
             and app.ctrl_validade_month_ref(c.data_coleta) = d.ref_coleta_mes
        )
        select
            d.id,
            d.client_event_id,
            d.cd,
            d.coddv,
            d.descricao,
            d.endereco_sep,
            d.val_mmaa,
            d.ref_coleta_mes,
            d.qtd_retirada,
            d.data_retirada,
            case
                when greatest(co.qtd_coletada - t.qtd_retirada_atual, 0) > 0 then 'pendente'
                else 'concluido'
            end as status,
            greatest(co.qtd_coletada - t.qtd_retirada_atual, 0)::integer as qtd_pendente
        from row_data d
        cross join totals t
        cross join coletas co;
        return;
    end if;

    v_current_month_ref := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
    v_prev_month_ref := (v_current_month_ref - interval '1 month')::date;
    v_current_month_idx := extract(year from v_current_month_ref)::integer * 12
        + extract(month from v_current_month_ref)::integer;
    v_target_month_idx := app.ctrl_validade_month_index(v_val_mmaa) - app.ctrl_validade_linha_lead_months(v_endereco_sep);
    v_requested_ref_coleta_mes := case
        when p_ref_coleta_mes is null then null
        else date_trunc('month', p_ref_coleta_mes::timestamp)::date
    end;

    select
        max(x.descricao),
        sum(x.qtd)::integer,
        x.coleta_mes,
        app.ctrl_validade_linha_rule(v_endereco_sep)
    into
        v_descricao,
        v_qtd_coletada,
        v_ref_coleta_mes,
        v_regra
    from (
        select
            c.descricao,
            c.qtd,
            app.ctrl_validade_month_ref(c.data_coleta) as coleta_mes
        from app.ctrl_validade_linha_coletas c
        where c.cd = v_cd
          and c.coddv = p_coddv
          and upper(trim(c.endereco_sep)) = v_endereco_sep
          and c.val_mmaa = v_val_mmaa
    ) x
    where (
        x.coleta_mes = v_prev_month_ref
        and v_target_month_idx = v_current_month_idx
    ) or (
        x.coleta_mes = v_current_month_ref
        and v_target_month_idx <= v_current_month_idx
    )
      and (v_requested_ref_coleta_mes is null or x.coleta_mes = v_requested_ref_coleta_mes)
    group by x.coleta_mes
    order by x.coleta_mes desc
    limit 1;

    if coalesce(v_qtd_coletada, 0) <= 0 or v_ref_coleta_mes is null then
        raise exception 'ITEM_NAO_ELEGIVEL_RETIRADA';
    end if;

    select
        coalesce(sum(r.qtd_retirada), 0)::integer
    into v_qtd_retirada_atual
    from app.ctrl_validade_linha_retiradas r
    where r.cd = v_cd
      and r.coddv = p_coddv
      and upper(trim(r.endereco_sep)) = v_endereco_sep
      and r.val_mmaa = v_val_mmaa
      and r.ref_coleta_mes = v_ref_coleta_mes;

    v_qtd_pendente := greatest(v_qtd_coletada - coalesce(v_qtd_retirada_atual, 0), 0);
    if v_qtd_pendente <= 0 then
        raise exception 'ITEM_JA_CONCLUIDO';
    end if;
    if v_qtd_retirada > v_qtd_pendente then
        raise exception 'QTD_RETIRADA_EXCEDE_PENDENTE';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    return query
    with inserted as (
        insert into app.ctrl_validade_linha_retiradas (
            client_event_id,
            cd,
            coddv,
            descricao,
            endereco_sep,
            val_mmaa,
            ref_coleta_mes,
            qtd_retirada,
            data_retirada,
            auditor_id,
            auditor_mat,
            auditor_nome
        )
        values (
            v_client_event_id,
            v_cd,
            p_coddv,
            coalesce(v_descricao, format('CODDV %s', p_coddv)),
            v_endereco_sep,
            v_val_mmaa,
            v_ref_coleta_mes,
            v_qtd_retirada,
            coalesce(p_data_hr, timezone('utc', now())),
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
        )
        returning
            ctrl_validade_linha_retiradas.id,
            ctrl_validade_linha_retiradas.client_event_id,
            ctrl_validade_linha_retiradas.cd,
            ctrl_validade_linha_retiradas.coddv,
            ctrl_validade_linha_retiradas.descricao,
            ctrl_validade_linha_retiradas.endereco_sep,
            ctrl_validade_linha_retiradas.val_mmaa,
            ctrl_validade_linha_retiradas.ref_coleta_mes,
            ctrl_validade_linha_retiradas.qtd_retirada,
            ctrl_validade_linha_retiradas.data_retirada
    ),
    total_retirado as (
        select
            i.id,
            (coalesce(sum(r.qtd_retirada), 0)::integer + max(i.qtd_retirada))::integer as qtd_retirada_atual
        from inserted i
        left join app.ctrl_validade_linha_retiradas r
          on r.cd = i.cd
         and r.coddv = i.coddv
         and upper(trim(r.endereco_sep)) = upper(trim(i.endereco_sep))
         and r.val_mmaa = i.val_mmaa
         and r.ref_coleta_mes = i.ref_coleta_mes
         and r.client_event_id <> i.client_event_id
        group by i.id
    )
    select
        i.id,
        i.client_event_id,
        i.cd,
        i.coddv,
        i.descricao,
        i.endereco_sep,
        i.val_mmaa,
        i.ref_coleta_mes,
        i.qtd_retirada,
        i.data_retirada,
        case
            when greatest(v_qtd_coletada - t.qtd_retirada_atual, 0) > 0 then 'pendente'
            else 'concluido'
        end as status,
        greatest(v_qtd_coletada - t.qtd_retirada_atual, 0)::integer as qtd_pendente
    from inserted i
    join total_retirado t
      on t.id = i.id;
end;
$$;

create or replace function public.rpc_ctrl_validade_pul_retirada_insert(
    p_cd integer default null,
    p_coddv integer default null,
    p_endereco_pul text default null,
    p_val_mmaa text default null,
    p_qtd_retirada integer default 1,
    p_data_hr timestamptz default null,
    p_client_event_id text default null
)
returns table (
    id uuid,
    client_event_id text,
    cd integer,
    coddv integer,
    descricao text,
    endereco_pul text,
    val_mmaa text,
    qtd_retirada integer,
    data_retirada timestamptz,
    status text,
    qtd_pendente integer,
    qtd_est_disp integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
    v_endereco_pul text;
    v_val_mmaa text;
    v_qtd_retirada integer;
    v_client_event_id text;
    v_descricao text;
    v_qtd_retirada_atual integer;
    v_qtd_pendente integer;
    v_qtd_est_disp integer;
    v_current_month_idx integer;
    v_months_to_expire integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    if coalesce(p_coddv, 0) <= 0 then raise exception 'CODDV_INVALIDO'; end if;

    v_endereco_pul := upper(nullif(trim(coalesce(p_endereco_pul, '')), ''));
    if v_endereco_pul is null then raise exception 'ENDERECO_PUL_OBRIGATORIO'; end if;

    v_val_mmaa := app.pvps_alocacao_normalize_validade(p_val_mmaa);
    v_qtd_retirada := coalesce(p_qtd_retirada, 1);
    if v_qtd_retirada <= 0 then raise exception 'QTD_INVALIDA'; end if;

    v_client_event_id := nullif(trim(coalesce(p_client_event_id, '')), '');
    if v_client_event_id is null then
        v_client_event_id := format('pul-retirada:%s', gen_random_uuid()::text);
    end if;

    if exists (
        select 1
        from app.ctrl_validade_pul_retiradas r
        where r.client_event_id = v_client_event_id
    ) then
        return query
        with row_data as (
            select
                r.id,
                r.client_event_id,
                r.cd,
                r.coddv,
                r.descricao,
                r.endereco_pul,
                r.val_mmaa,
                r.qtd_retirada,
                r.data_retirada
            from app.ctrl_validade_pul_retiradas r
            where r.client_event_id = v_client_event_id
            limit 1
        ),
        totals as (
            select
                coalesce(sum(rr.qtd_retirada), 0)::integer as qtd_retirada_atual
            from row_data d
            left join app.ctrl_validade_pul_retiradas rr
              on rr.cd = d.cd
             and rr.coddv = d.coddv
             and upper(trim(rr.endereco_pul)) = upper(trim(d.endereco_pul))
             and rr.val_mmaa = d.val_mmaa
        ),
        estoque as (
            select coalesce(max(e.qtd_est_disp), 0)::integer as qtd_est_disp
            from row_data d
            left join app.db_estq_entr e
              on e.cd = d.cd
             and e.coddv = d.coddv
        )
        select
            d.id,
            d.client_event_id,
            d.cd,
            d.coddv,
            d.descricao,
            d.endereco_pul,
            d.val_mmaa,
            d.qtd_retirada,
            d.data_retirada,
            case
                when greatest(1 - t.qtd_retirada_atual, 0) > 0 then 'pendente'
                else 'concluido'
            end as status,
            greatest(1 - t.qtd_retirada_atual, 0)::integer as qtd_pendente,
            es.qtd_est_disp
        from row_data d
        cross join totals t
        cross join estoque es;
        return;
    end if;

    v_current_month_idx := (
        extract(year from timezone('America/Sao_Paulo', now()))::integer * 12
        + extract(month from timezone('America/Sao_Paulo', now()))::integer
    );
    v_months_to_expire := (
        ((split_part(v_val_mmaa, '/', 2)::integer + 2000) * 12 + split_part(v_val_mmaa, '/', 1)::integer)
        - v_current_month_idx
    );
    if v_months_to_expire > 4 then
        raise exception 'ITEM_NAO_ELEGIVEL_RETIRADA';
    end if;

    select
        coalesce(nullif(trim(coalesce(d.descricao, '')), ''), format('CODDV %s', p_coddv)),
        coalesce(max(e.qtd_est_disp), 0)::integer
    into
        v_descricao,
        v_qtd_est_disp
    from app.db_end d
    join app.db_estq_entr e
      on e.cd = d.cd
     and e.coddv = d.coddv
    where d.cd = v_cd
      and d.coddv = p_coddv
      and upper(trim(coalesce(d.tipo, ''))) = 'PUL'
      and upper(trim(d.endereco)) = v_endereco_pul
      and app.pvps_alocacao_normalize_validade(d.validade) = v_val_mmaa
    group by coalesce(nullif(trim(coalesce(d.descricao, '')), ''), format('CODDV %s', p_coddv));

    if v_descricao is null then
        raise exception 'ITEM_NAO_ELEGIVEL_RETIRADA';
    end if;
    if coalesce(v_qtd_est_disp, 0) <= 0 then
        raise exception 'ITEM_PUL_SEM_ESTOQUE';
    end if;

    select
        coalesce(sum(r.qtd_retirada), 0)::integer
    into v_qtd_retirada_atual
    from app.ctrl_validade_pul_retiradas r
    where r.cd = v_cd
      and r.coddv = p_coddv
      and upper(trim(r.endereco_pul)) = v_endereco_pul
      and r.val_mmaa = v_val_mmaa;

    v_qtd_pendente := greatest(1 - coalesce(v_qtd_retirada_atual, 0), 0);
    if v_qtd_pendente <= 0 then
        raise exception 'ITEM_JA_CONCLUIDO';
    end if;
    if v_qtd_retirada > v_qtd_pendente then
        raise exception 'QTD_RETIRADA_EXCEDE_PENDENTE';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    return query
    with inserted as (
        insert into app.ctrl_validade_pul_retiradas (
            client_event_id,
            cd,
            coddv,
            descricao,
            endereco_pul,
            val_mmaa,
            qtd_retirada,
            data_retirada,
            auditor_id,
            auditor_mat,
            auditor_nome
        )
        values (
            v_client_event_id,
            v_cd,
            p_coddv,
            v_descricao,
            v_endereco_pul,
            v_val_mmaa,
            v_qtd_retirada,
            coalesce(p_data_hr, timezone('utc', now())),
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
        )
        returning
            ctrl_validade_pul_retiradas.id,
            ctrl_validade_pul_retiradas.client_event_id,
            ctrl_validade_pul_retiradas.cd,
            ctrl_validade_pul_retiradas.coddv,
            ctrl_validade_pul_retiradas.descricao,
            ctrl_validade_pul_retiradas.endereco_pul,
            ctrl_validade_pul_retiradas.val_mmaa,
            ctrl_validade_pul_retiradas.qtd_retirada,
            ctrl_validade_pul_retiradas.data_retirada
    ),
    total_retirado as (
        select
            i.id,
            (coalesce(sum(r.qtd_retirada), 0)::integer + max(i.qtd_retirada))::integer as qtd_retirada_atual
        from inserted i
        left join app.ctrl_validade_pul_retiradas r
          on r.cd = i.cd
         and r.coddv = i.coddv
         and upper(trim(r.endereco_pul)) = upper(trim(i.endereco_pul))
         and r.val_mmaa = i.val_mmaa
         and r.client_event_id <> i.client_event_id
        group by i.id
    )
    select
        i.id,
        i.client_event_id,
        i.cd,
        i.coddv,
        i.descricao,
        i.endereco_pul,
        i.val_mmaa,
        i.qtd_retirada,
        i.data_retirada,
        case
            when greatest(1 - t.qtd_retirada_atual, 0) > 0 then 'pendente'
            else 'concluido'
        end as status,
        greatest(1 - t.qtd_retirada_atual, 0)::integer as qtd_pendente,
        v_qtd_est_disp
    from inserted i
    join total_retirado t
      on t.id = i.id;
end;
$$;

grant execute on function public.rpc_ctrl_validade_linha_retirada_insert(integer, integer, text, text, date, integer, timestamptz, text) to authenticated;
grant execute on function public.rpc_ctrl_validade_pul_retirada_insert(integer, integer, text, text, integer, timestamptz, text) to authenticated;
