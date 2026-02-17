drop function if exists public.rpc_conf_volume_avulso_manifest_volumes(integer);

create or replace function public.rpc_conf_volume_avulso_manifest_volumes(
    p_cd integer default null
)
returns table (
    nr_volume text,
    itens_total integer,
    qtd_esperada_total integer,
    status text,
    colaborador_nome text,
    colaborador_mat text,
    status_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_today date;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    return query
    with itens as (
        select
            nullif(trim(coalesce(t.nr_volume, '')), '') as nr_volume,
            t.coddv,
            greatest(sum(greatest(coalesce(t.qtd_mov, 0)::integer, 0))::integer, 1) as qtd_esperada_item
        from app.db_avulso t
        where t.cd = v_cd
          and nullif(trim(coalesce(t.nr_volume, '')), '') is not null
          and t.coddv is not null
        group by
            nullif(trim(coalesce(t.nr_volume, '')), ''),
            t.coddv
    ),
    status_conf as (
        select
            c.nr_volume,
            case
                when c.status in ('finalizado_ok', 'finalizado_falta') then 'concluido'
                when c.status = 'em_conferencia' then 'em_andamento'
                else 'pendente'
            end as status,
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat,
            case
                when c.status = 'em_conferencia' then c.started_at
                else c.finalized_at
            end as status_at
        from app.conf_volume_avulso c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')
    )
    select
        i.nr_volume,
        count(*)::integer as itens_total,
        coalesce(sum(i.qtd_esperada_item), 0)::integer as qtd_esperada_total,
        coalesce(s.status, 'pendente')::text as status,
        s.colaborador_nome,
        s.colaborador_mat,
        s.status_at
    from itens i
    left join status_conf s
      on s.nr_volume = i.nr_volume
    group by
        i.nr_volume,
        s.status,
        s.colaborador_nome,
        s.colaborador_mat,
        s.status_at
    order by i.nr_volume;
end;
$$;

grant execute on function public.rpc_conf_volume_avulso_manifest_volumes(integer) to authenticated;
