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
    v_qtd integer := 1;
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

    v_val_mmaa := app.pvps_alocacao_normalize_validade(p_val_mmaa);

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
            c.qtd,
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
        qtd,
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
        v_qtd,
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
        ctrl_validade_linha_coletas.qtd,
        ctrl_validade_linha_coletas.data_coleta,
        ctrl_validade_linha_coletas.auditor_id,
        ctrl_validade_linha_coletas.auditor_mat,
        ctrl_validade_linha_coletas.auditor_nome,
        ctrl_validade_linha_coletas.created_at,
        ctrl_validade_linha_coletas.updated_at;
end;
$$;

drop function if exists public.rpc_ctrl_validade_pul_retirada_list(integer, text, integer, integer);

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
    endereco_pul text,
    andar text,
    val_mmaa text,
    qtd_alvo integer,
    qtd_retirada integer,
    qtd_pendente integer,
    status text,
    qtd_est_disp integer
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
        where e.months_to_expire <= 5
    ),
    retirada as (
        select
            r.cd,
            r.coddv,
            r.endereco_pul,
            r.val_mmaa,
            sum(r.qtd_retirada)::integer as qtd_retirada
        from app.ctrl_validade_pul_retiradas r
        where r.cd = v_cd
        group by r.cd, r.coddv, r.endereco_pul, r.val_mmaa
    ),
    merged as (
        select
            f.cd,
            f.coddv,
            f.descricao,
            f.endereco_pul,
            f.andar,
            f.val_mmaa,
            1::integer as qtd_alvo,
            coalesce(r.qtd_retirada, 0)::integer as qtd_retirada,
            greatest(1 - coalesce(r.qtd_retirada, 0), 0)::integer as qtd_pendente,
            case
                when greatest(1 - coalesce(r.qtd_retirada, 0), 0) > 0 then 'pendente'
                else 'concluido'
            end as status,
            f.qtd_est_disp
        from filtered f
        left join retirada r
          on r.cd = f.cd
         and r.coddv = f.coddv
         and r.endereco_pul = f.endereco_pul
         and r.val_mmaa = f.val_mmaa
    )
    select
        m.cd,
        m.coddv,
        m.descricao,
        m.endereco_pul,
        m.andar,
        m.val_mmaa,
        m.qtd_alvo,
        m.qtd_retirada,
        m.qtd_pendente,
        m.status,
        m.qtd_est_disp
    from merged m
    where v_status = 'todos'
       or (v_status = 'pendente' and m.status = 'pendente')
       or (v_status = 'concluido' and m.status = 'concluido')
    order by m.status, m.val_mmaa, m.endereco_pul, m.coddv
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 400), 1), 4000);
end;
$$;

grant execute on function public.rpc_ctrl_validade_pul_retirada_list(integer, text, integer, integer) to authenticated;
