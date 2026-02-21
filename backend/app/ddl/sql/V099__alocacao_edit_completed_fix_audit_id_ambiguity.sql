create or replace function public.rpc_alocacao_edit_completed(
    p_cd integer default null,
    p_audit_id uuid default null,
    p_end_sit text default null,
    p_val_conf text default null
)
returns table (
    audit_id uuid,
    aud_sit text,
    val_sist text,
    val_conf text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_row app.aud_alocacao%rowtype;
    v_end_sit text;
    v_val_conf text;
    v_val_sist text;
    v_aud_sit text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    if p_audit_id is null then raise exception 'AUDIT_ID_OBRIGATORIO'; end if;
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);

    select aa.*
    into v_row
    from app.aud_alocacao aa
    where aa.audit_id = p_audit_id
    for update;

    if v_row.audit_id is null then raise exception 'AUDITORIA_ALOCACAO_NAO_ENCONTRADA'; end if;
    if v_row.cd <> v_cd then raise exception 'CD_SEM_ACESSO'; end if;
    if not (authz.is_admin(v_uid) or v_row.auditor_id = v_uid) then
        raise exception 'SEM_PERMISSAO_EDICAO';
    end if;

    v_end_sit := lower(trim(coalesce(p_end_sit, '')));
    if v_end_sit = '' then
        v_end_sit := null;
    elsif v_end_sit not in ('vazio', 'obstruido') then
        raise exception 'END_SIT_INVALIDO';
    end if;

    v_val_sist := app.pvps_alocacao_normalize_validade(v_row.val_sist);
    if v_end_sit is not null then
        v_val_conf := null;
        v_aud_sit := 'ocorrencia';
    else
        v_val_conf := app.pvps_alocacao_normalize_validade(p_val_conf);
        v_aud_sit := case when v_val_conf = v_val_sist then 'conforme' else 'nao_conforme' end;
    end if;

    update app.aud_alocacao aa
    set
        end_sit = v_end_sit,
        val_conf = v_val_conf,
        aud_sit = v_aud_sit,
        dt_hr = now()
    where aa.audit_id = v_row.audit_id;

    return query
    select v_row.audit_id, v_aud_sit, v_val_sist, v_val_conf;
end;
$$;

grant execute on function public.rpc_alocacao_edit_completed(integer, uuid, text, text) to authenticated;
