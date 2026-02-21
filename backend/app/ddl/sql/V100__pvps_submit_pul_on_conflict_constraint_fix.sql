create or replace function public.rpc_pvps_submit_pul(
    p_audit_id uuid,
    p_end_pul text,
    p_val_pul text,
    p_end_sit text default null
)
returns table (
    audit_id uuid,
    status text,
    pul_total integer,
    pul_auditados integer,
    conforme boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_aud app.aud_pvps%rowtype;
    v_end_pul text;
    v_end_sit text;
    v_val_pul text;
    v_pul_total integer;
    v_pul_auditados integer;
    v_has_invalid boolean;
    v_conforme boolean;
    v_status text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    select ap.*
    into v_aud
    from app.aud_pvps ap
    where ap.audit_id = p_audit_id
    for update;

    if v_aud.audit_id is null then raise exception 'AUDITORIA_PVPS_NAO_ENCONTRADA'; end if;
    if v_aud.status = 'pendente_sep' then raise exception 'SEP_NAO_AUDITADA'; end if;
    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_aud.cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_end_pul := upper(nullif(trim(coalesce(p_end_pul, '')), ''));
    if v_end_pul is null then raise exception 'END_PUL_OBRIGATORIO'; end if;

    if not exists (
        select 1
        from app.db_pvps d
        where d.cd = v_aud.cd
          and d.coddv = v_aud.coddv
          and d.end_sep = v_aud.end_sep
          and d.end_pul = v_end_pul
    ) then
        raise exception 'END_PUL_FORA_DA_AUDITORIA';
    end if;

    v_end_sit := lower(trim(coalesce(p_end_sit, '')));
    if v_end_sit = '' then
        v_end_sit := null;
    elsif v_end_sit not in ('vazio', 'obstruido') then
        raise exception 'END_SIT_INVALIDO';
    end if;

    if v_end_sit is not null then
        v_val_pul := null;
    else
        v_val_pul := app.pvps_alocacao_normalize_validade(p_val_pul);
    end if;

    insert into app.aud_pvps_pul (audit_id, end_pul, val_pul, end_sit, dt_hr)
    values (v_aud.audit_id, v_end_pul, v_val_pul, v_end_sit, now())
    on conflict on constraint uq_aud_pvps_pul_item
    do update set
        val_pul = excluded.val_pul,
        end_sit = excluded.end_sit,
        dt_hr = now();

    select count(*)::integer
    into v_pul_total
    from app.db_pvps d
    where d.cd = v_aud.cd and d.coddv = v_aud.coddv and d.end_sep = v_aud.end_sep;

    select count(*)::integer
    into v_pul_auditados
    from app.aud_pvps_pul apu
    where apu.audit_id = v_aud.audit_id;

    v_conforme := false;
    v_status := 'pendente_pul';

    if coalesce(v_pul_total, 0) > 0 and coalesce(v_pul_auditados, 0) >= coalesce(v_pul_total, 0) then
        select exists (
            select 1
            from app.aud_pvps_pul apu
            where apu.audit_id = v_aud.audit_id
              and apu.val_pul is not null
              and v_aud.val_sep is not null
              and app.pvps_alocacao_validade_rank(apu.val_pul) < app.pvps_alocacao_validade_rank(v_aud.val_sep)
        ) into v_has_invalid;

        v_conforme := not coalesce(v_has_invalid, false);
        v_status := case when v_conforme then 'concluido' else 'nao_conforme' end;

        update app.aud_pvps ap
        set status = v_status,
            dt_hr = now()
        where ap.audit_id = v_aud.audit_id;

        update app.db_pvps
        set is_pending = false
        where cd = v_aud.cd and coddv = v_aud.coddv and end_sep = v_aud.end_sep;

        perform app.pvps_alocacao_replenish(v_aud.cd, 'pvps');
    end if;

    return query
    select v_aud.audit_id, v_status, coalesce(v_pul_total, 0), coalesce(v_pul_auditados, 0), v_conforme;
end;
$$;

grant execute on function public.rpc_pvps_submit_pul(uuid, text, text, text) to authenticated;
