create or replace function public.rpc_conf_entrada_notas_cancel_batch(
    p_conf_ids jsonb
)
returns table (
    conf_id uuid,
    cancelled boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_entrada_notas%rowtype;
    v_conf_text text;
    v_conf_id uuid;
    v_seen_ids uuid[] := '{}';
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if p_conf_ids is null
       or jsonb_typeof(p_conf_ids) <> 'array'
       or jsonb_array_length(p_conf_ids) = 0 then
        raise exception 'CONF_ID_OBRIGATORIO';
    end if;

    for v_conf_text in
        select trim(t.value)
        from jsonb_array_elements_text(p_conf_ids) as t(value)
    loop
        if v_conf_text = '' then
            raise exception 'CONF_ID_INVALIDO';
        end if;

        begin
            v_conf_id := v_conf_text::uuid;
        exception when others then
            raise exception 'CONF_ID_INVALIDO';
        end;

        if v_conf_id = any(v_seen_ids) then
            continue;
        end if;
        v_seen_ids := array_append(v_seen_ids, v_conf_id);

        select *
        into v_conf
        from app.conf_entrada_notas c
        where c.conf_id = v_conf_id
          and c.started_by = v_uid
          and c.status = 'em_conferencia'
          and (
              authz.is_admin(v_uid)
              or authz.can_access_cd(v_uid, c.cd)
          )
        for update
        limit 1;

        if v_conf.conf_id is null then
            raise exception 'CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA';
        end if;

        delete from app.conf_entrada_notas c
        where c.conf_id = v_conf.conf_id;

        return query
        select
            v_conf.conf_id,
            true;
    end loop;
end;
$$;

grant execute on function public.rpc_conf_entrada_notas_cancel_batch(jsonb) to authenticated;
