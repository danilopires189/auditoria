drop function if exists public.rpc_ctrl_validade_pul_retirada_list(integer, text, integer, integer);
drop function if exists public.rpc_ctrl_validade_pul_retirada_insert(integer, integer, text, text, integer, timestamptz, text);
drop function if exists public.rpc_ctrl_validade_pul_retirada_update_qtd(uuid, integer);

create or replace function public.rpc_ctrl_validade_pul_retirada_list(
    p_cd integer default null,
    p_status text default 'pendente',
    p_limit integer default 400,
    p_offset integer default 0
)
returns table (
    cd integer,
    coddv integer,
    descricao text,
    zona text,
    endereco_pul text,
    andar text,
    val_mmaa text,
    qtd_retirada integer,
    status text,
    qtd_est_disp integer,
    dt_ultima_retirada timestamptz,
    auditor_nome_ultima_retirada text,
    editable_retirada_id uuid,
    editable_retirada_qtd integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_status text;
    v_current_month_idx integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_status := lower(trim(coalesce(p_status, 'pendente')));
    if v_status not in ('pendente', 'concluido', 'todos') then
        raise exception 'STATUS_INVALIDO';
    end if;

    v_current_month_idx := (
        extract(year from timezone('America/Sao_Paulo', now()))::integer * 12
        + extract(month from timezone('America/Sao_Paulo', now()))::integer
    );

    return query
    with base as (
        select
            d.cd,
            d.coddv,
            coalesce(nullif(trim(coalesce(d.descricao, '')), ''), format('CODDV %s', d.coddv)) as descricao,
            app.pvps_alocacao_normalize_zone(d.endereco) as zona,
            upper(trim(d.endereco)) as endereco_pul,
            max(nullif(trim(coalesce(d.andar, '')), '')) as andar,
            app.pvps_alocacao_normalize_validade(d.validade) as val_mmaa,
            max(coalesce(e.qtd_est_disp, 0))::integer as qtd_est_disp
        from app.db_end d
        join app.db_estq_entr e
          on e.cd = d.cd
         and e.coddv = d.coddv
         and coalesce(e.qtd_est_disp, 0) > 0
        where d.cd = v_cd
          and upper(trim(coalesce(d.tipo, ''))) = 'PUL'
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
          and nullif(trim(coalesce(d.validade, '')), '') is not null
        group by
            d.cd,
            d.coddv,
            coalesce(nullif(trim(coalesce(d.descricao, '')), ''), format('CODDV %s', d.coddv)),
            app.pvps_alocacao_normalize_zone(d.endereco),
            upper(trim(d.endereco)),
            app.pvps_alocacao_normalize_validade(d.validade)
    ),
    eligible as (
        select
            b.*,
            (
                ((split_part(b.val_mmaa, '/', 2)::integer + 2000) * 12 + split_part(b.val_mmaa, '/', 1)::integer)
                - v_current_month_idx
            ) as months_to_expire
        from base b
    ),
    filtered as (
        select *
        from eligible e
        where e.months_to_expire <= 4
    ),
    retirada as (
        select
            r.cd,
            r.coddv,
            upper(trim(r.endereco_pul)) as endereco_pul,
            r.val_mmaa,
            coalesce(sum(r.qtd_retirada), 0)::integer as qtd_retirada
        from app.ctrl_validade_pul_retiradas r
        where r.cd = v_cd
        group by r.cd, r.coddv, upper(trim(r.endereco_pul)), r.val_mmaa
    ),
    ultima_retirada as (
        select
            x.cd,
            x.coddv,
            x.endereco_pul,
            x.val_mmaa,
            x.data_retirada as dt_ultima_retirada,
            nullif(trim(coalesce(x.auditor_nome, '')), '') as auditor_nome_ultima_retirada
        from (
            select
                r.cd,
                r.coddv,
                upper(trim(r.endereco_pul)) as endereco_pul,
                r.val_mmaa,
                r.data_retirada,
                r.auditor_nome,
                r.created_at,
                r.id,
                row_number() over (
                    partition by r.cd, r.coddv, upper(trim(r.endereco_pul)), r.val_mmaa
                    order by r.data_retirada desc, r.created_at desc, r.id desc
                ) as rn
            from app.ctrl_validade_pul_retiradas r
            where r.cd = v_cd
        ) x
        where x.rn = 1
    ),
    editable_retirada as (
        select
            x.cd,
            x.coddv,
            x.endereco_pul,
            x.val_mmaa,
            x.id as editable_retirada_id,
            x.qtd_retirada as editable_retirada_qtd
        from (
            select
                r.cd,
                r.coddv,
                upper(trim(r.endereco_pul)) as endereco_pul,
                r.val_mmaa,
                r.id,
                r.qtd_retirada,
                r.data_retirada,
                r.created_at,
                row_number() over (
                    partition by r.cd, r.coddv, upper(trim(r.endereco_pul)), r.val_mmaa
                    order by r.data_retirada desc, r.created_at desc, r.id desc
                ) as rn
            from app.ctrl_validade_pul_retiradas r
            where r.cd = v_cd
              and r.auditor_id = v_uid
        ) x
        where x.rn = 1
    ),
    merged as (
        select
            f.cd,
            f.coddv,
            f.descricao,
            f.zona,
            f.endereco_pul,
            f.andar,
            f.val_mmaa,
            coalesce(r.qtd_retirada, 0)::integer as qtd_retirada,
            case
                when coalesce(r.qtd_retirada, 0) > 0 then 'concluido'
                else 'pendente'
            end as status,
            f.qtd_est_disp,
            u.dt_ultima_retirada,
            u.auditor_nome_ultima_retirada,
            er.editable_retirada_id,
            er.editable_retirada_qtd
        from filtered f
        left join retirada r
          on r.cd = f.cd
         and r.coddv = f.coddv
         and r.endereco_pul = f.endereco_pul
         and r.val_mmaa = f.val_mmaa
        left join ultima_retirada u
          on u.cd = f.cd
         and u.coddv = f.coddv
         and u.endereco_pul = f.endereco_pul
         and u.val_mmaa = f.val_mmaa
        left join editable_retirada er
          on er.cd = f.cd
         and er.coddv = f.coddv
         and er.endereco_pul = f.endereco_pul
         and er.val_mmaa = f.val_mmaa
    )
    select
        m.cd,
        m.coddv,
        m.descricao,
        m.zona,
        m.endereco_pul,
        m.andar,
        m.val_mmaa,
        m.qtd_retirada,
        m.status,
        m.qtd_est_disp,
        m.dt_ultima_retirada,
        m.auditor_nome_ultima_retirada,
        m.editable_retirada_id,
        m.editable_retirada_qtd
    from merged m
    where v_status = 'todos'
       or (v_status = 'pendente' and m.status = 'pendente')
       or (v_status = 'concluido' and m.status = 'concluido')
    order by m.status, m.zona, m.val_mmaa, m.endereco_pul, m.coddv
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 400), 1), 4000);
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
    v_qtd_retirada := coalesce(p_qtd_retirada, 0);
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
                upper(trim(r.endereco_pul)) as endereco_pul,
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
             and upper(trim(rr.endereco_pul)) = d.endereco_pul
             and rr.val_mmaa = d.val_mmaa
        ),
        estoque as (
            select coalesce(max(e.qtd_est_disp), 0)::integer as qtd_est_disp
            from row_data d
            left join app.db_end de
              on de.cd = d.cd
             and de.coddv = d.coddv
             and upper(trim(coalesce(de.tipo, ''))) = 'PUL'
             and upper(trim(de.endereco)) = d.endereco_pul
             and app.pvps_alocacao_normalize_validade(de.validade) = d.val_mmaa
            left join app.db_estq_entr e
              on e.cd = de.cd
             and e.coddv = de.coddv
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
                when t.qtd_retirada_atual > 0 then 'concluido'
                else 'pendente'
            end as status,
            case
                when t.qtd_retirada_atual > 0 then 0
                else 1
            end as qtd_pendente,
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
    if v_qtd_retirada > v_qtd_est_disp then
        raise exception 'QTD_RETIRADA_EXCEDE_ESTOQUE';
    end if;

    select
        coalesce(sum(r.qtd_retirada), 0)::integer
    into v_qtd_retirada_atual
    from app.ctrl_validade_pul_retiradas r
    where r.cd = v_cd
      and r.coddv = p_coddv
      and upper(trim(r.endereco_pul)) = v_endereco_pul
      and r.val_mmaa = v_val_mmaa;

    if coalesce(v_qtd_retirada_atual, 0) > 0 then
        raise exception 'ITEM_JA_CONCLUIDO';
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
            upper(trim(ctrl_validade_pul_retiradas.endereco_pul)) as endereco_pul,
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
         and upper(trim(r.endereco_pul)) = i.endereco_pul
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
            when t.qtd_retirada_atual > 0 then 'concluido'
            else 'pendente'
        end as status,
        case
            when t.qtd_retirada_atual > 0 then 0
            else 1
        end as qtd_pendente,
        v_qtd_est_disp
    from inserted i
    join total_retirado t
      on t.id = i.id;
end;
$$;

create or replace function public.rpc_ctrl_validade_pul_retirada_update_qtd(
    p_id uuid default null,
    p_qtd_retirada integer default null
)
returns table (
    id uuid,
    qtd_retirada integer,
    status text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_row app.ctrl_validade_pul_retiradas%rowtype;
    v_qtd_retirada integer;
    v_qtd_outras_retiradas integer;
    v_qtd_est_disp integer;
    v_total_retirado integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_id is null then raise exception 'REGISTRO_NAO_ENCONTRADO'; end if;

    select *
    into v_row
    from app.ctrl_validade_pul_retiradas r
    where r.id = p_id
    limit 1;

    if v_row.id is null then
        raise exception 'REGISTRO_NAO_ENCONTRADO';
    end if;
    if v_row.auditor_id <> v_uid then
        raise exception 'APENAS_AUTOR_PODE_EDITAR';
    end if;

    v_qtd_retirada := coalesce(p_qtd_retirada, -1);
    if v_qtd_retirada < 0 then
        raise exception 'QTD_INVALIDA';
    end if;

    select coalesce(sum(r.qtd_retirada), 0)::integer
    into v_qtd_outras_retiradas
    from app.ctrl_validade_pul_retiradas r
    where r.cd = v_row.cd
      and r.coddv = v_row.coddv
      and upper(trim(r.endereco_pul)) = upper(trim(v_row.endereco_pul))
      and r.val_mmaa = v_row.val_mmaa
      and r.id <> v_row.id;

    select coalesce(max(e.qtd_est_disp), 0)::integer
    into v_qtd_est_disp
    from app.db_end d
    join app.db_estq_entr e
      on e.cd = d.cd
     and e.coddv = d.coddv
    where d.cd = v_row.cd
      and d.coddv = v_row.coddv
      and upper(trim(coalesce(d.tipo, ''))) = 'PUL'
      and upper(trim(d.endereco)) = upper(trim(v_row.endereco_pul))
      and app.pvps_alocacao_normalize_validade(d.validade) = v_row.val_mmaa;

    v_qtd_est_disp := greatest(coalesce(v_qtd_est_disp, 0), coalesce(v_qtd_outras_retiradas, 0) + coalesce(v_row.qtd_retirada, 0));
    if v_qtd_outras_retiradas + v_qtd_retirada > v_qtd_est_disp then
        raise exception 'QTD_RETIRADA_EXCEDE_ESTOQUE';
    end if;

    if v_qtd_retirada = 0 then
        delete from app.ctrl_validade_pul_retiradas r
        where r.id = v_row.id;
    else
        update app.ctrl_validade_pul_retiradas r
        set qtd_retirada = v_qtd_retirada
        where r.id = v_row.id;
    end if;

    v_total_retirado := coalesce(v_qtd_outras_retiradas, 0) + v_qtd_retirada;

    return query
    select
        v_row.id,
        v_qtd_retirada,
        case when v_total_retirado > 0 then 'concluido' else 'pendente' end;
end;
$$;

grant execute on function public.rpc_ctrl_validade_pul_retirada_list(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_ctrl_validade_pul_retirada_insert(integer, integer, text, text, integer, timestamptz, text) to authenticated;
grant execute on function public.rpc_ctrl_validade_pul_retirada_update_qtd(uuid, integer) to authenticated;
