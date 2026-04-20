do $$
begin
    if to_regprocedure('app.produtividade_events_base_legacy_v463(integer,date,date)') is null then
        alter function app.produtividade_events_base(integer, date, date)
        rename to produtividade_events_base_legacy_v463;
    end if;
end;
$$;

create or replace function app.produtividade_events_base(
    p_cd integer,
    p_dt_ini date default null,
    p_dt_fim date default null
)
returns table (
    activity_key text,
    activity_label text,
    unit_label text,
    user_id uuid,
    mat text,
    nome text,
    event_date date,
    metric_value numeric(18,3),
    detail text,
    source_ref text,
    event_at timestamptz
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $function$
    with profiles_cd as (
        select
            p.user_id,
            coalesce(nullif(trim(p.mat), ''), '-') as mat,
            coalesce(nullif(trim(p.nome), ''), 'Usuário') as nome,
            app.produtividade_norm_digits(p.mat) as mat_norm,
            app.produtividade_norm_text(p.nome) as nome_norm
        from authz.profiles p
        join authz.user_deposits ud
          on ud.user_id = p.user_id
         and ud.cd = p_cd
    ),
    conf_blitz_src as (
        select
            b.cd,
            b.filial,
            b.pedido,
            b.seq,
            coalesce(b.conferente, '') as conferente,
            coalesce(b.tt_un, 0) as tt_un,
            app.produtividade_norm_digits(b.conferente) as conf_digits,
            app.produtividade_norm_text(b.conferente) as conf_norm,
            b.dt_conf as event_date,
            coalesce(b.updated_at, b.dt_conf::timestamp at time zone 'America/Sao_Paulo') as event_at
        from app.db_conf_blitz b
        where b.cd = p_cd
          and coalesce(b.tt_un, 0) > 0
          and b.dt_conf is not null
    )
    select
        b.activity_key,
        b.activity_label,
        b.unit_label,
        b.user_id,
        b.mat,
        b.nome,
        b.event_date,
        b.metric_value,
        b.detail,
        b.source_ref,
        b.event_at
    from app.produtividade_events_base_legacy_v463(p_cd, p_dt_ini, p_dt_fim) b
    where b.activity_key <> 'prod_blitz_un'

    union all

    select
        'prod_blitz_un'::text as activity_key,
        'Produtividade Blitz (base externa)'::text as activity_label,
        'unidades'::text as unit_label,
        pr.user_id,
        pr.mat,
        pr.nome,
        b.event_date,
        b.tt_un::numeric(18,3) as metric_value,
        format(
            'Filial %s | Pedido %s | Seq %s',
            b.filial::text,
            b.pedido::text,
            b.seq::text
        ) as detail,
        format('prod_blitz:%s:%s:%s', b.filial::text, b.pedido::text, b.seq::text) as source_ref,
        b.event_at
    from conf_blitz_src b
    join lateral (
        select
            p.user_id,
            p.mat,
            p.nome
        from profiles_cd p
        where (
            b.conf_digits <> ''
            and p.mat_norm = b.conf_digits
        ) or (
            b.conf_norm <> ''
            and p.nome_norm = b.conf_norm
        )
        order by
            case when b.conf_digits <> '' and p.mat_norm = b.conf_digits then 0 else 1 end,
            p.user_id
        limit 1
    ) pr on true
    where (p_dt_ini is null or b.event_date >= p_dt_ini)
      and (p_dt_fim is null or b.event_date <= p_dt_fim);
$function$;

notify pgrst, 'reload schema';
