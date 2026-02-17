drop function if exists public.rpc_conf_volume_avulso_manifest_volumes(integer);

create or replace function public.rpc_conf_volume_avulso_manifest_volumes(
    p_cd integer default null
)
returns table (
    nr_volume text,
    itens_total integer,
    qtd_esperada_total integer
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);

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
    )
    select
        i.nr_volume,
        count(*)::integer as itens_total,
        coalesce(sum(i.qtd_esperada_item), 0)::integer as qtd_esperada_total
    from itens i
    group by i.nr_volume
    order by i.nr_volume;
end;
$$;

grant execute on function public.rpc_conf_volume_avulso_manifest_volumes(integer) to authenticated;
