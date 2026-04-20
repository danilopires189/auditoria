create or replace function public.rpc_produtividade_entries(
    p_cd integer default null,
    p_target_user_id uuid default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_activity_key text default null,
    p_limit integer default 400
)
returns table (
    entry_id text,
    event_at timestamptz,
    event_date date,
    activity_key text,
    activity_label text,
    unit_label text,
    metric_value numeric(18,3),
    detail text,
    source_ref text,
    mat text,
    nome text
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
    v_mode text;
    v_is_admin boolean;
    v_activity_key text;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.produtividade_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';
    v_mode := app.produtividade_visibility_mode(v_cd);
    v_activity_key := nullif(lower(trim(coalesce(p_activity_key, ''))), '');
    v_limit := greatest(1, least(coalesce(p_limit, 400), 2000));

    if p_target_user_id is not null
       and p_target_user_id <> v_uid
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    if p_target_user_id is null
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    if v_activity_key is not null and v_activity_key not in (
        'coleta_sku',
        'pvps_endereco',
        'atividade_extra_pontos',
        'alocacao_endereco',
        'entrada_notas_sku',
        'termo_sku',
        'pedido_direto_sku',
        'zerados_endereco',
        'devolucao_nfd',
        'prod_blitz_un',
        'prod_vol_mes',
        'registro_embarque_loja'
    ) then
        raise exception 'ATIVIDADE_INVALIDA';
    end if;

    return query
    select
        concat_ws(
            ':',
            e.activity_key,
            to_char(e.event_date, 'YYYYMMDD'),
            e.user_id::text,
            coalesce(e.source_ref, left(md5(coalesce(e.detail, '')), 12))
        ) as entry_id,
        e.event_at,
        e.event_date,
        e.activity_key,
        e.activity_label,
        e.unit_label,
        e.metric_value,
        e.detail,
        e.source_ref,
        e.mat,
        e.nome
    from app.produtividade_events_base(v_cd, p_dt_ini, p_dt_fim) e
    where (p_target_user_id is null or e.user_id = p_target_user_id)
      and (
          v_is_admin
          or v_mode = 'public_cd'
          or e.user_id = v_uid
      )
      and (v_activity_key is null or e.activity_key = v_activity_key)
    order by
        e.event_date desc,
        e.event_at desc nulls last,
        e.activity_label,
        e.source_ref
    limit v_limit;
end;
$$;
