create or replace function public.rpc_caixa_termica_feed_diario(
    p_cd   integer default null,
    p_data date    default null
)
returns table (
    rota             text,
    filial           integer,
    filial_nome      text,
    expedicoes       bigint,
    recebimentos     bigint,
    ultimo_mov       timestamptz,
    caixas           jsonb
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid  uuid;
    v_cd   integer;
    v_data date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    v_cd := coalesce(p_cd, (
        select cd_default from authz.profiles where user_id = v_uid limit 1
    ));
    if v_cd is null then raise exception 'CD_NAO_DEFINIDO_USUARIO'; end if;
    v_data := coalesce(p_data, timezone('America/Sao_Paulo', now())::date);

    return query
    select
        m.rota,
        m.filial,
        m.filial_nome,
        count(*) filter (where m.tipo = 'expedicao') as expedicoes,
        count(*) filter (where m.tipo = 'recebimento') as recebimentos,
        max(m.data_hr) as ultimo_mov,
        jsonb_agg(
            jsonb_build_object(
                'codigo', c.codigo,
                'tipo', m.tipo,
                'data_hr', m.data_hr,
                'pedido', m.pedido,
                'data_pedido', m.data_pedido,
                'mat_resp', nullif(trim(m.mat_resp), ''),
                'nome_resp', nullif(trim(m.nome_resp), '')
            ) order by m.data_hr desc
        ) as caixas
    from app.controle_caixa_termica_movs m
    join app.controle_caixa_termica c on c.id = m.caixa_id
    where m.cd = v_cd
      and timezone('America/Sao_Paulo', m.data_hr)::date = v_data
    group by m.rota, m.filial, m.filial_nome
    order by max(m.data_hr) desc;
end;
$$;
