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
    zona text,
    endereco_pul text,
    andar text,
    val_mmaa text,
    qtd_alvo integer,
    qtd_retirada integer,
    qtd_pendente integer,
    status text,
    qtd_est_disp integer,
    dt_ultima_retirada timestamptz,
    auditor_nome_ultima_retirada text
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
                r.endereco_pul,
                r.val_mmaa,
                r.data_retirada,
                r.auditor_nome,
                r.created_at,
                r.id,
                row_number() over (
                    partition by r.cd, r.coddv, r.endereco_pul, r.val_mmaa
                    order by r.data_retirada desc, r.created_at desc, r.id desc
                ) as rn
            from app.ctrl_validade_pul_retiradas r
            where r.cd = v_cd
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
            1::integer as qtd_alvo,
            coalesce(r.qtd_retirada, 0)::integer as qtd_retirada,
            greatest(1 - coalesce(r.qtd_retirada, 0), 0)::integer as qtd_pendente,
            case
                when greatest(1 - coalesce(r.qtd_retirada, 0), 0) > 0 then 'pendente'
                else 'concluido'
            end as status,
            f.qtd_est_disp,
            u.dt_ultima_retirada,
            u.auditor_nome_ultima_retirada
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
    )
    select
        m.cd,
        m.coddv,
        m.descricao,
        m.zona,
        m.endereco_pul,
        m.andar,
        m.val_mmaa,
        m.qtd_alvo,
        m.qtd_retirada,
        m.qtd_pendente,
        m.status,
        m.qtd_est_disp,
        m.dt_ultima_retirada,
        m.auditor_nome_ultima_retirada
    from merged m
    where v_status = 'todos'
       or (v_status = 'pendente' and m.status = 'pendente')
       or (v_status = 'concluido' and m.status = 'concluido')
    order by m.status, m.zona, m.val_mmaa, m.endereco_pul, m.coddv
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 400), 1), 4000);
end;
$$;

grant execute on function public.rpc_ctrl_validade_pul_retirada_list(integer, text, integer, integer) to authenticated;
