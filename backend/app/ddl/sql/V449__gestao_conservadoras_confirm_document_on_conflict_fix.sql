create or replace function public.rpc_conservadora_confirmar_documento(
    p_cd integer default null,
    p_embarque_key text default null
)
returns table (
    embarque_key text,
    confirmed_at timestamptz,
    confirmed_mat text,
    confirmed_nome text
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
begin
    v_uid := auth.uid();
    v_cd := app.conservadora_resolve_cd(p_cd);

    if nullif(trim(coalesce(p_embarque_key, '')), '') is null then
        raise exception 'EMBARQUE_OBRIGATORIO';
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
        confirmed_nome
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
        coalesce(nullif(trim((select p.nome from authz.profiles p where p.user_id = v_uid limit 1)), ''), 'Usuário')
    )
    on conflict on constraint uq_conservadora_documento_confirmacoes_cd_key do update
    set confirmed_at = excluded.confirmed_at,
        confirmed_by = excluded.confirmed_by,
        confirmed_mat = excluded.confirmed_mat,
        confirmed_nome = excluded.confirmed_nome
    returning
        app.conservadora_documento_confirmacoes.embarque_key,
        app.conservadora_documento_confirmacoes.confirmed_at,
        app.conservadora_documento_confirmacoes.confirmed_mat,
        app.conservadora_documento_confirmacoes.confirmed_nome
    into
        v_result_embarque_key,
        v_result_confirmed_at,
        v_result_confirmed_mat,
        v_result_confirmed_nome;

    return query
    select
        v_result_embarque_key,
        v_result_confirmed_at,
        v_result_confirmed_mat,
        v_result_confirmed_nome;
end;
$$;
