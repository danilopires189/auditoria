drop function if exists public.rpc_pvps_pul_items(integer, integer, text);

create or replace function public.rpc_pvps_pul_items(
    p_cd integer default null,
    p_coddv integer default null,
    p_end_sep text default null
)
returns table (
    end_pul text,
    nivel text,
    val_pul text,
    end_sit text,
    auditado boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_end_sep text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_coddv is null or p_coddv <= 0 then raise exception 'CODDV_OBRIGATORIO'; end if;
    v_end_sep := upper(nullif(trim(coalesce(p_end_sep, '')), ''));
    if v_end_sep is null then raise exception 'END_SEP_OBRIGATORIO'; end if;

    return query
    with base as (
        select distinct upper(trim(coalesce(d.end_pul, ''))) as end_pul
        from app.db_pvps d
        where d.cd = v_cd
          and d.coddv = p_coddv
          and upper(trim(coalesce(d.end_sep, ''))) = v_end_sep
          and nullif(trim(coalesce(d.end_pul, '')), '') is not null
    ),
    aud as (
        select ap.audit_id
        from app.aud_pvps ap
        where ap.cd = v_cd
          and ap.coddv = p_coddv
          and upper(trim(coalesce(ap.end_sep, ''))) = v_end_sep
        order by ap.dt_hr desc nulls last, ap.audit_id desc
        limit 1
    )
    select
        b.end_pul,
        pul.nivel,
        apu.val_pul,
        apu.end_sit,
        (apu.audit_pul_id is not null) as auditado
    from base b
    left join lateral (
        select
            nullif(trim(coalesce(e.andar, '')), '') as nivel
        from app.db_end e
        where e.cd = v_cd
          and e.coddv = p_coddv
          and upper(trim(coalesce(e.tipo, ''))) = 'PUL'
          and upper(trim(coalesce(e.endereco, ''))) = b.end_pul
        order by
            case when nullif(trim(coalesce(e.andar, '')), '') is null then 1 else 0 end,
            nullif(trim(coalesce(e.andar, '')), '')
        limit 1
    ) pul on true
    left join aud a on true
    left join app.aud_pvps_pul apu
      on apu.audit_id = a.audit_id
     and upper(trim(coalesce(apu.end_pul, ''))) = b.end_pul
    order by b.end_pul;
end;
$$;

grant execute on function public.rpc_pvps_pul_items(integer, integer, text) to authenticated;
