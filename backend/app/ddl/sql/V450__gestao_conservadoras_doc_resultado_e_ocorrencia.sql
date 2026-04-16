alter table app.conservadora_documento_confirmacoes
    add column if not exists document_resultado text,
    add column if not exists document_ocorrencia text;

update app.conservadora_documento_confirmacoes
set document_resultado = coalesce(document_resultado, 'aprovada')
where document_resultado is null;

alter table app.conservadora_documento_confirmacoes
    alter column document_resultado set default 'aprovada',
    alter column document_resultado set not null;

alter table app.conservadora_documento_confirmacoes
    drop constraint if exists ck_conservadora_documento_confirmacoes_resultado;

alter table app.conservadora_documento_confirmacoes
    add constraint ck_conservadora_documento_confirmacoes_resultado
    check (document_resultado in ('aprovada', 'reprovada'));

drop function if exists public.rpc_conservadora_cards_list(integer, text, text);
drop function if exists public.rpc_conservadora_history(integer, text, text, date, date, integer, integer);
drop function if exists public.rpc_conservadora_confirmar_documento(integer, text);
drop function if exists public.rpc_conservadora_confirmar_documento(integer, text, text, text);
drop function if exists app.conservadora_embarques_base(integer);

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
    document_resultado text,
    document_ocorrencia text,
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
    enriched as (
        select
            a.*,
            coalesce(a.dt_lib, a.dt_ped, a.encerramento, a.source_updated_at) as event_at,
            case
                when trim(a.seq_ped) ~ '^[0-9]+$' then trim(a.seq_ped)::numeric
                else null
            end as seq_ped_num
        from aggregated a
    ),
    ordered as (
        select
            e.embarque_key,
            e.cd,
            e.rota,
            e.placa,
            e.seq_ped,
            e.dt_ped,
            e.dt_lib,
            e.encerramento,
            e.event_at,
            e.responsavel_mat,
            e.responsavel_nome,
            e.rota_norm,
            (
                select e2.event_at
                from enriched e2
                where e2.cd = e.cd
                  and e2.placa_norm = e.placa_norm
                  and (
                    (
                        e.seq_ped_num is not null
                        and e2.seq_ped_num is not null
                        and e2.seq_ped_num > e.seq_ped_num
                    )
                    or (
                        (e.seq_ped_num is null or e2.seq_ped_num is null)
                        and e2.seq_ped > e.seq_ped
                    )
                  )
                  and (
                    e2.event_at > e.event_at
                    or (e2.event_at = e.event_at and e2.embarque_key > e.embarque_key)
                  )
                order by
                    e2.event_at asc,
                    e2.seq_ped_num asc nulls last,
                    e2.seq_ped asc,
                    e2.embarque_key asc
                limit 1
            ) as next_embarque_at
        from enriched e
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
        dc.document_resultado,
        dc.document_ocorrencia,
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

create or replace function public.rpc_conservadora_cards_list(
    p_cd integer default null,
    p_status text default null,
    p_search text default null
)
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
    document_resultado text,
    document_ocorrencia text,
    next_embarque_at timestamptz,
    status text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_status text;
    v_search text;
begin
    v_cd := app.conservadora_resolve_cd(p_cd);
    v_status := lower(trim(coalesce(p_status, '')));
    v_search := upper(trim(coalesce(p_search, '')));

    if v_status not in ('em_transito', 'aguardando_documento', 'documentacao_em_atraso', 'documentacao_recebida') then
        v_status := '';
    end if;

    return query
    select
        b.embarque_key,
        b.cd,
        b.rota,
        b.placa,
        b.seq_ped,
        b.dt_ped,
        b.dt_lib,
        b.encerramento,
        b.event_at,
        b.responsavel_mat,
        b.responsavel_nome,
        b.transportadora_id,
        b.transportadora_nome,
        b.transportadora_ativa,
        b.document_confirmed_at,
        b.document_confirmed_mat,
        b.document_confirmed_nome,
        b.document_resultado,
        b.document_ocorrencia,
        b.next_embarque_at,
        b.status
    from app.conservadora_embarques_base(v_cd) b
    where (v_status = '' or b.status = v_status)
      and (
        v_search = ''
        or upper(coalesce(b.rota, '')) like '%' || v_search || '%'
        or upper(coalesce(b.placa, '')) like '%' || v_search || '%'
        or upper(coalesce(b.seq_ped, '')) like '%' || v_search || '%'
        or upper(coalesce(b.transportadora_nome, '')) like '%' || v_search || '%'
        or upper(coalesce(b.responsavel_nome, '')) like '%' || v_search || '%'
        or upper(coalesce(b.responsavel_mat, '')) like '%' || v_search || '%'
      )
    order by
        case b.status
            when 'documentacao_em_atraso' then 0
            when 'aguardando_documento' then 1
            when 'em_transito' then 2
            else 3
        end,
        b.event_at desc nulls last,
        b.rota asc,
        b.placa asc,
        b.seq_ped asc;
end;
$$;

create or replace function public.rpc_conservadora_history(
    p_cd integer default null,
    p_search text default null,
    p_status text default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_offset integer default 0,
    p_limit integer default 100
)
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
    document_resultado text,
    document_ocorrencia text,
    next_embarque_at timestamptz,
    status text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_status text;
    v_search text;
    v_offset integer;
    v_limit integer;
begin
    v_cd := app.conservadora_resolve_cd(p_cd);
    v_status := lower(trim(coalesce(p_status, '')));
    v_search := upper(trim(coalesce(p_search, '')));
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);

    if p_dt_ini is not null and p_dt_fim is not null and p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if v_status not in ('em_transito', 'aguardando_documento', 'documentacao_em_atraso', 'documentacao_recebida') then
        v_status := '';
    end if;

    return query
    select
        b.embarque_key,
        b.cd,
        b.rota,
        b.placa,
        b.seq_ped,
        b.dt_ped,
        b.dt_lib,
        b.encerramento,
        b.event_at,
        b.responsavel_mat,
        b.responsavel_nome,
        b.transportadora_id,
        b.transportadora_nome,
        b.transportadora_ativa,
        b.document_confirmed_at,
        b.document_confirmed_mat,
        b.document_confirmed_nome,
        b.document_resultado,
        b.document_ocorrencia,
        b.next_embarque_at,
        b.status
    from app.conservadora_embarques_base(v_cd) b
    where (v_status = '' or b.status = v_status)
      and (p_dt_ini is null or timezone('America/Sao_Paulo', b.event_at)::date >= p_dt_ini)
      and (p_dt_fim is null or timezone('America/Sao_Paulo', b.event_at)::date <= p_dt_fim)
      and (
        v_search = ''
        or upper(coalesce(b.rota, '')) like '%' || v_search || '%'
        or upper(coalesce(b.placa, '')) like '%' || v_search || '%'
        or upper(coalesce(b.seq_ped, '')) like '%' || v_search || '%'
        or upper(coalesce(b.transportadora_nome, '')) like '%' || v_search || '%'
        or upper(coalesce(b.responsavel_nome, '')) like '%' || v_search || '%'
        or upper(coalesce(b.responsavel_mat, '')) like '%' || v_search || '%'
      )
    order by
        b.event_at desc nulls last,
        b.rota asc,
        b.placa asc,
        b.seq_ped asc
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_conservadora_confirmar_documento(
    p_cd integer default null,
    p_embarque_key text default null,
    p_resultado text default null,
    p_ocorrencia text default null
)
returns table (
    embarque_key text,
    confirmed_at timestamptz,
    confirmed_mat text,
    confirmed_nome text,
    document_resultado text,
    document_ocorrencia text
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_embarque record;
    v_now timestamptz := now();
    v_result_embarque_key text;
    v_result_confirmed_at timestamptz;
    v_result_confirmed_mat text;
    v_result_confirmed_nome text;
    v_document_resultado text;
    v_document_ocorrencia text;
begin
    v_uid := auth.uid();
    v_cd := app.conservadora_resolve_cd(p_cd);
    v_document_resultado := lower(trim(coalesce(p_resultado, '')));
    v_document_ocorrencia := nullif(trim(coalesce(p_ocorrencia, '')), '');

    if nullif(trim(coalesce(p_embarque_key, '')), '') is null then
        raise exception 'EMBARQUE_OBRIGATORIO';
    end if;
    if v_document_resultado = '' then
        raise exception 'RESULTADO_DOCUMENTO_OBRIGATORIO';
    end if;
    if v_document_resultado not in ('aprovada', 'reprovada') then
        raise exception 'RESULTADO_DOCUMENTO_INVALIDO';
    end if;
    if v_document_resultado = 'reprovada' and v_document_ocorrencia is null then
        raise exception 'OCORRENCIA_OBRIGATORIA_REPROVACAO';
    end if;

    select *
    into v_embarque
    from app.conservadora_embarques_base(v_cd) b
    where b.embarque_key = trim(p_embarque_key)
    limit 1;

    if v_embarque.embarque_key is null then
        raise exception 'EMBARQUE_NAO_ENCONTRADO';
    end if;

    insert into app.conservadora_documento_confirmacoes (
        cd,
        embarque_key,
        rota_descricao,
        placa,
        seq_ped,
        confirmed_at,
        confirmed_by,
        confirmed_mat,
        confirmed_nome,
        document_resultado,
        document_ocorrencia
    )
    values (
        v_cd,
        v_embarque.embarque_key,
        coalesce(v_embarque.rota, '-'),
        coalesce(v_embarque.placa, '-'),
        coalesce(v_embarque.seq_ped, '-'),
        v_now,
        v_uid,
        coalesce(nullif(trim((select p.mat from authz.profiles p where p.user_id = v_uid limit 1)), ''), '-'),
        coalesce(nullif(trim((select p.nome from authz.profiles p where p.user_id = v_uid limit 1)), ''), 'Usuário'),
        v_document_resultado,
        v_document_ocorrencia
    )
    on conflict on constraint uq_conservadora_documento_confirmacoes_cd_key do update
    set confirmed_at = excluded.confirmed_at,
        confirmed_by = excluded.confirmed_by,
        confirmed_mat = excluded.confirmed_mat,
        confirmed_nome = excluded.confirmed_nome,
        document_resultado = excluded.document_resultado,
        document_ocorrencia = excluded.document_ocorrencia
    returning
        app.conservadora_documento_confirmacoes.embarque_key,
        app.conservadora_documento_confirmacoes.confirmed_at,
        app.conservadora_documento_confirmacoes.confirmed_mat,
        app.conservadora_documento_confirmacoes.confirmed_nome,
        app.conservadora_documento_confirmacoes.document_resultado,
        app.conservadora_documento_confirmacoes.document_ocorrencia
    into
        v_result_embarque_key,
        v_result_confirmed_at,
        v_result_confirmed_mat,
        v_result_confirmed_nome,
        v_document_resultado,
        v_document_ocorrencia;

    return query
    select
        v_result_embarque_key,
        v_result_confirmed_at,
        v_result_confirmed_mat,
        v_result_confirmed_nome,
        v_document_resultado,
        v_document_ocorrencia;
end;
$$;

grant execute on function public.rpc_conservadora_cards_list(integer, text, text) to authenticated;
grant execute on function public.rpc_conservadora_history(integer, text, text, date, date, integer, integer) to authenticated;
grant execute on function public.rpc_conservadora_confirmar_documento(integer, text, text, text) to authenticated;
