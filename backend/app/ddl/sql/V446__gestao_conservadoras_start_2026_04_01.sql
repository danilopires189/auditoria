create or replace function app.conservadora_embarques_base(p_cd integer)
returns table (
    embarque_key text,
    cd integer,
    rota text,
    placa text,
    seq_ped text,
    dt_ped timestamptz,
    dt_lib timestamptz,
    encerramento timestamptz,
    event_at timestamptz,
    responsavel_mat text,
    responsavel_nome text,
    transportadora_id uuid,
    transportadora_nome text,
    transportadora_ativa boolean,
    document_confirmed_at timestamptz,
    document_confirmed_mat text,
    document_confirmed_nome text,
    next_embarque_at timestamptz,
    status text
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
    with src as materialized (
        select
            v.cd,
            nullif(trim(coalesce(v.descricao, '')), '') as rota_raw,
            app.conservadora_norm_text(v.descricao) as rota_norm,
            nullif(trim(coalesce(v.seq_ped, '')), '') as seq_ped,
            app.conservadora_norm_plate(v.placa) as placa_norm,
            nullif(trim(upper(coalesce(v.placa, ''))), '') as placa_display,
            v.dt_ped,
            v.dt_lib,
            v.encerramento,
            v.updated_at,
            nullif(trim(coalesce(v.usuario, v.aud, '')), '') as usuario_raw,
            authz.normalize_mat(coalesce(v.usuario, v.aud, '')) as usuario_norm
        from app.db_prod_vol v
        where v.cd = p_cd
          and nullif(trim(coalesce(v.descricao, '')), '') is not null
          and nullif(trim(coalesce(v.seq_ped, '')), '') is not null
          and app.conservadora_norm_plate(v.placa) <> ''
          and v.dt_ped is not null
          and timezone('America/Sao_Paulo', v.dt_ped)::date >= date '2026-04-01'
    ),
    user_lookup as materialized (
        select
            authz.normalize_mat(u.mat) as mat_norm,
            max(nullif(trim(u.mat), '')) as mat,
            max(nullif(trim(u.nome), '')) as nome
        from app.db_usuario u
        where u.cd = p_cd
          and authz.normalize_mat(u.mat) <> ''
        group by authz.normalize_mat(u.mat)
    ),
    aggregated as (
        select
            s.cd,
            max(s.rota_raw) as rota,
            s.rota_norm,
            max(s.placa_display) as placa,
            s.placa_norm,
            s.seq_ped,
            min(s.dt_ped) as dt_ped,
            min(s.dt_lib) as dt_lib,
            max(s.encerramento) as encerramento,
            max(s.updated_at) as source_updated_at,
            max(coalesce(ul.mat, s.usuario_raw, '-')) as responsavel_mat,
            max(coalesce(ul.nome, s.usuario_raw, 'Não informado')) as responsavel_nome,
            app.conservadora_embarque_key(max(s.rota_raw), max(s.placa_display), s.seq_ped) as embarque_key
        from src s
        left join user_lookup ul
          on ul.mat_norm = s.usuario_norm
        group by
            s.cd,
            s.rota_norm,
            s.placa_norm,
            s.seq_ped
    ),
    ordered as (
        select
            a.*,
            coalesce(a.dt_lib, a.dt_ped, a.encerramento, a.source_updated_at) as event_at,
            lead(coalesce(a.dt_lib, a.dt_ped, a.encerramento, a.source_updated_at)) over (
                partition by a.cd, a.placa_norm
                order by
                    coalesce(a.dt_lib, a.dt_ped, a.encerramento, a.source_updated_at),
                    a.rota_norm,
                    a.seq_ped,
                    a.embarque_key
            ) as next_embarque_at
        from aggregated a
    )
    select
        o.embarque_key,
        o.cd,
        o.rota,
        o.placa,
        o.seq_ped,
        o.dt_ped,
        o.dt_lib,
        o.encerramento,
        o.event_at,
        o.responsavel_mat,
        o.responsavel_nome,
        rt.transportadora_id,
        tp.nome as transportadora_nome,
        tp.ativo as transportadora_ativa,
        dc.confirmed_at as document_confirmed_at,
        dc.confirmed_mat as document_confirmed_mat,
        dc.confirmed_nome as document_confirmed_nome,
        o.next_embarque_at,
        case
            when dc.embarque_key is not null then 'documentacao_recebida'
            when o.next_embarque_at is null then 'em_transito'
            when now() > (o.next_embarque_at + interval '5 days') then 'documentacao_em_atraso'
            else 'aguardando_documento'
        end as status
    from ordered o
    left join app.conservadora_rotas_transportadoras rt
      on rt.cd = o.cd
     and rt.rota_norm = o.rota_norm
    left join app.conservadora_transportadoras tp
      on tp.id = rt.transportadora_id
    left join app.conservadora_documento_confirmacoes dc
      on dc.cd = o.cd
     and dc.embarque_key = o.embarque_key;
$$;
