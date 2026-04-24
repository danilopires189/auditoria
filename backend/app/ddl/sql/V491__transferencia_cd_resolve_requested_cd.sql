create or replace function app.conf_transferencia_cd_resolve_cd(p_cd integer)
returns integer
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if authz.is_admin(v_uid) then
        v_cd := coalesce(p_cd, v_profile.cd_default);
    else
        v_cd := coalesce(
            p_cd,
            v_profile.cd_default,
            (
                select min(ud.cd)
                from authz.user_deposits ud
                where ud.user_id = v_uid
            )
        );
    end if;

    if v_cd is null then
        raise exception 'CD_NAO_DEFINIDO_USUARIO';
    end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return v_cd;
end;
$$;

drop function if exists public.rpc_conf_transferencia_cd_get_active_conference(text);

create or replace function public.rpc_conf_transferencia_cd_get_active_conference(
    p_cd integer default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    conf_id uuid,
    conf_date date,
    origem_link text,
    dt_nf date,
    nf_trf bigint,
    sq_nf bigint,
    cd_ori integer,
    cd_des integer,
    cd_ori_nome text,
    cd_des_nome text,
    etapa text,
    status text,
    falta_motivo text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean,
    origem_status text,
    origem_started_mat text,
    origem_started_nome text,
    origem_started_at timestamptz,
    origem_finalized_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_origem text;
    v_conf app.conf_transferencia_cd%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_origem := app.conf_transferencia_cd_resolve_origem_link(p_origem_link);

    select *
    into v_conf
    from app.conf_transferencia_cd c
    where c.started_by = v_uid
      and c.status = 'em_conferencia'
      and c.origem_link = v_origem
      and ((c.etapa = 'saida' and c.cd_ori = v_cd) or (c.etapa = 'entrada' and c.cd_des = v_cd))
      and (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, c.cd_ori) or authz.can_access_cd(v_uid, c.cd_des))
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_conf.conf_id is null then return; end if;

    return query
    select
        c.conf_id, c.conf_date, c.origem_link, c.dt_nf, c.nf_trf, c.sq_nf, c.cd_ori, c.cd_des,
        coalesce(c.cd_ori_nome, app.conf_transferencia_cd_nome_cd(c.cd_ori)),
        coalesce(c.cd_des_nome, app.conf_transferencia_cd_nome_cd(c.cd_des)),
        c.etapa, c.status, c.falta_motivo, c.started_by, c.started_mat, c.started_nome,
        c.started_at, c.finalized_at, c.updated_at, false,
        s.status, nullif(trim(s.started_mat), ''), nullif(trim(s.started_nome), ''), s.started_at, s.finalized_at
    from app.conf_transferencia_cd c
    left join app.conf_transferencia_cd s
      on s.dt_nf = c.dt_nf
     and s.nf_trf = c.nf_trf
     and s.sq_nf = c.sq_nf
     and s.cd_ori = c.cd_ori
     and s.cd_des = c.cd_des
     and s.etapa = 'saida'
     and s.origem_link = c.origem_link
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

grant execute on function public.rpc_conf_transferencia_cd_get_active_conference(integer, text) to authenticated;
