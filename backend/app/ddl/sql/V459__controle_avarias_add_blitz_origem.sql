alter table if exists app.controle_avarias
    drop constraint if exists controle_avarias_origem_check;

alter table if exists app.controle_avarias
    add constraint controle_avarias_origem_check
    check (origem in ('Blitz', 'Entrada', 'Expedição', 'Pulmão', 'Separação'));

create or replace function app.controle_avarias_enrich_and_validate()
returns trigger
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_profile record;
    v_is_global_admin boolean;
    v_cd integer;
    v_coddv integer;
    v_descricao text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if tg_op = 'INSERT' then
        new.user_id := v_uid;
    else
        new.user_id := old.user_id;
    end if;

    new.barras := regexp_replace(coalesce(new.barras, ''), '\s+', '', 'g');
    if new.barras = '' then
        raise exception 'BARRAS_OBRIGATORIA';
    end if;

    new.etiqueta := nullif(trim(coalesce(new.etiqueta, '')), '');
    new.lote := nullif(trim(coalesce(new.lote, '')), '');
    new.motivo := nullif(trim(coalesce(new.motivo, '')), '');
    new.situacao := nullif(trim(coalesce(new.situacao, '')), '');
    new.origem := nullif(trim(coalesce(new.origem, '')), '');

    if new.motivo is null then
        raise exception 'MOTIVO_OBRIGATORIO';
    end if;

    if new.situacao is null then
        raise exception 'SITUACAO_OBRIGATORIA';
    end if;

    if new.origem is null or new.origem not in ('Blitz', 'Entrada', 'Expedição', 'Pulmão', 'Separação') then
        raise exception 'ORIGEM_INVALIDA';
    end if;

    if new.val_mmaa is not null then
        new.val_mmaa := regexp_replace(new.val_mmaa, '[^0-9]', '', 'g');
        new.val_mmaa := nullif(new.val_mmaa, '');
    end if;

    if new.val_mmaa is not null and new.val_mmaa !~ '^(0[1-9]|1[0-2])[0-9]{2}$' then
        raise exception 'VALIDADE_INVALIDA_MMAA';
    end if;

    if coalesce(new.qtd, 0) <= 0 then
        raise exception 'QTD_INVALIDA';
    end if;

    select b.coddv, b.descricao
    into v_coddv, v_descricao
    from app.db_barras b
    where b.barras = new.barras
    order by b.updated_at desc nulls last, b.coddv
    limit 1;

    if v_coddv is null then
        raise exception 'BARRAS_NAO_ENCONTRADA';
    end if;

    new.coddv := v_coddv;
    new.descricao := coalesce(v_descricao, 'SEM DESCRICAO');

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    v_is_global_admin := authz.is_admin(v_uid);

    if tg_op = 'UPDATE' then
        new.cd := old.cd;
        new.mat_aud := old.mat_aud;
        new.nome_aud := old.nome_aud;
        new.data_hr := old.data_hr;
    elsif v_is_global_admin then
        if new.cd is null then
            raise exception 'CD_OBRIGATORIO_ADMIN_GLOBAL';
        end if;
        new.mat_aud := coalesce(nullif(trim(v_profile.mat), ''), new.mat_aud);
        new.nome_aud := coalesce(nullif(trim(v_profile.nome), ''), new.nome_aud);
    else
        v_cd := v_profile.cd_default;
        if v_cd is null then
            select min(ud.cd)
            into v_cd
            from authz.user_deposits ud
            where ud.user_id = v_uid;
        end if;

        if v_cd is null then
            raise exception 'CD_NAO_DEFINIDO_USUARIO';
        end if;

        if not authz.can_access_cd(v_uid, v_cd) then
            raise exception 'CD_SEM_ACESSO';
        end if;

        new.cd := v_cd;
        new.mat_aud := coalesce(nullif(trim(v_profile.mat), ''), new.mat_aud);
        new.nome_aud := coalesce(nullif(trim(v_profile.nome), ''), new.nome_aud);
    end if;

    if coalesce(nullif(trim(new.mat_aud), ''), '') = '' then
        raise exception 'MATRICULA_AUDITOR_OBRIGATORIA';
    end if;

    if coalesce(nullif(trim(new.nome_aud), ''), '') = '' then
        raise exception 'NOME_AUDITOR_OBRIGATORIO';
    end if;

    new.data_hr := coalesce(new.data_hr, now());
    new.updated_at := now();

    return new;
end;
$$;
