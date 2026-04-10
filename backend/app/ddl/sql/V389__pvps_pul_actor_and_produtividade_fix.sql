alter table app.aud_pvps_pul
    add column if not exists auditor_id uuid references auth.users(id) on delete restrict;

alter table app.aud_pvps_pul
    add column if not exists auditor_mat text;

alter table app.aud_pvps_pul
    add column if not exists auditor_nome text;

update app.aud_pvps_pul apu
set
    auditor_id = ap.auditor_id,
    auditor_mat = ap.auditor_mat,
    auditor_nome = ap.auditor_nome
from app.aud_pvps ap
where ap.audit_id = apu.audit_id
  and (
      apu.auditor_id is null
      or nullif(trim(coalesce(apu.auditor_mat, '')), '') is null
      or nullif(trim(coalesce(apu.auditor_nome, '')), '') is null
  );

alter table app.aud_pvps_pul
    alter column auditor_id set not null;

alter table app.aud_pvps_pul
    alter column auditor_mat set not null;

alter table app.aud_pvps_pul
    alter column auditor_nome set not null;

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
    v_profile record;
    v_mat text;
    v_nome text;
    v_aud app.aud_pvps%rowtype;
    v_end_pul text;
    v_end_sit text;
    v_val_pul text;
    v_pul_total integer;
    v_pul_auditados integer;
    v_has_invalid boolean;
    v_conforme boolean;
    v_status text;
    v_item_pending boolean;
    v_existing_auditor_id uuid;
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

    if app.pvps_admin_is_item_blacklisted(v_aud.cd, 'pvps', v_aud.zona, v_aud.coddv, v_aud.coddv::text || '|' || v_aud.end_sep) then
        raise exception 'ITEM_BLOQUEADO_BLACKLIST';
    end if;

    select exists (
        select 1
        from app.db_pvps d
        where d.cd = v_aud.cd
          and d.coddv = v_aud.coddv
          and d.end_sep = v_aud.end_sep
          and d.is_pending
    ) into v_item_pending;

    if not coalesce(v_item_pending, false) then
        select ap.auditor_id
        into v_existing_auditor_id
        from app.aud_pvps ap
        where ap.cd = v_aud.cd
          and ap.coddv = v_aud.coddv
          and ap.end_sep = v_aud.end_sep
        order by ap.dt_hr desc
        limit 1;

        if v_existing_auditor_id = v_uid then
            raise exception 'ITEM_PVPS_AUDITADO_PELO_USUARIO';
        end if;
        raise exception 'ITEM_PVPS_AUDITADO_POR_OUTRO_USUARIO';
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

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    insert into app.aud_pvps_pul (audit_id, end_pul, val_pul, end_sit, dt_hr, auditor_id, auditor_mat, auditor_nome)
    values (v_aud.audit_id, v_end_pul, v_val_pul, v_end_sit, now(), v_uid, v_mat, v_nome)
    on conflict on constraint uq_aud_pvps_pul_item
    do update set
        val_pul = excluded.val_pul,
        end_sit = excluded.end_sit,
        dt_hr = now(),
        auditor_id = excluded.auditor_id,
        auditor_mat = excluded.auditor_mat,
        auditor_nome = excluded.auditor_nome;

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

create or replace function public.rpc_pvps_submit_pul(
    p_audit_id uuid,
    p_end_pul text,
    p_val_pul text
)
returns table (
    audit_id uuid,
    status text,
    pul_total integer,
    pul_auditados integer,
    conforme boolean
)
language sql
security definer
set search_path = app, authz, public
as $$
    select *
    from public.rpc_pvps_submit_pul(
        p_audit_id,
        p_end_pul,
        p_val_pul,
        null::text
    );
$$;

create or replace function public.rpc_pvps_submit_pul(
    p_cd integer default null,
    p_audit_id uuid default null,
    p_end_pul text default null,
    p_val_pul text default null
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
    v_cd integer;
    v_aud_cd integer;
begin
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_audit_id is null then raise exception 'AUDIT_ID_OBRIGATORIO'; end if;

    select ap.cd
    into v_aud_cd
    from app.aud_pvps ap
    where ap.audit_id = p_audit_id;

    if v_aud_cd is null then
        raise exception 'AUDITORIA_PVPS_NAO_ENCONTRADA';
    end if;
    if v_aud_cd <> v_cd then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    select *
    from public.rpc_pvps_submit_pul(p_audit_id, p_end_pul, p_val_pul, null::text);
end;
$$;

create or replace function public.rpc_pvps_submit_pul(
    p_cd integer default null,
    p_audit_id uuid default null,
    p_end_pul text default null,
    p_val_pul text default null,
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
    v_cd integer;
    v_aud_cd integer;
begin
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_audit_id is null then raise exception 'AUDIT_ID_OBRIGATORIO'; end if;

    select ap.cd
    into v_aud_cd
    from app.aud_pvps ap
    where ap.audit_id = p_audit_id;

    if v_aud_cd is null then
        raise exception 'AUDITORIA_PVPS_NAO_ENCONTRADA';
    end if;
    if v_aud_cd <> v_cd then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    select *
    from public.rpc_pvps_submit_pul(p_audit_id, p_end_pul, p_val_pul, p_end_sit);
end;
$$;

drop function if exists public.rpc_pvps_completed_pul_items(integer, uuid);

create or replace function public.rpc_pvps_completed_pul_items(
    p_cd integer default null,
    p_audit_id uuid default null
)
returns table (
    end_pul text,
    nivel text,
    val_pul text,
    end_sit text,
    auditado boolean,
    dt_hr timestamptz,
    auditor_nome text,
    auditor_mat text,
    is_lower boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_row app.aud_pvps%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_audit_id is null then raise exception 'AUDIT_ID_OBRIGATORIO'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);

    select *
    into v_row
    from app.aud_pvps ap
    where ap.audit_id = p_audit_id;

    if v_row.audit_id is null then
        raise exception 'AUDITORIA_PVPS_NAO_ENCONTRADA';
    end if;
    if v_row.cd <> v_cd then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    select
        upper(trim(coalesce(apu.end_pul, ''))) as end_pul,
        pul.nivel,
        apu.val_pul,
        apu.end_sit,
        true as auditado,
        apu.dt_hr,
        coalesce(nullif(trim(coalesce(apu.auditor_nome, '')), ''), nullif(trim(coalesce(v_row.auditor_nome, '')), ''), 'USUARIO') as auditor_nome,
        coalesce(nullif(trim(coalesce(apu.auditor_mat, '')), ''), nullif(trim(coalesce(v_row.auditor_mat, '')), ''), 'SEM_MATRICULA') as auditor_mat,
        (
            v_row.val_sep is not null
            and apu.val_pul is not null
            and app.pvps_alocacao_validade_rank(apu.val_pul) < app.pvps_alocacao_validade_rank(v_row.val_sep)
        ) as is_lower
    from app.aud_pvps_pul apu
    left join lateral (
        select
            nullif(trim(coalesce(e.andar, '')), '') as nivel
        from app.db_end e
        where e.cd = v_row.cd
          and e.coddv = v_row.coddv
          and upper(trim(coalesce(e.tipo, ''))) = 'PUL'
          and upper(trim(coalesce(e.endereco, ''))) = upper(trim(coalesce(apu.end_pul, '')))
        order by
            case when nullif(trim(coalesce(e.andar, '')), '') is null then 1 else 0 end,
            nullif(trim(coalesce(e.andar, '')), '')
        limit 1
    ) pul on true
    where apu.audit_id = v_row.audit_id
    order by upper(trim(coalesce(apu.end_pul, '')));
end;
$$;

drop function if exists public.rpc_pvps_report_pul_items(uuid[]);

create function public.rpc_pvps_report_pul_items(
    p_audit_ids uuid[]
)
returns table (
    audit_id uuid,
    end_pul text,
    val_pul text,
    end_sit text,
    is_lower boolean,
    dt_hr timestamptz,
    auditor_nome text,
    auditor_mat text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if authz.user_role(v_uid) <> 'admin' then raise exception 'APENAS_ADMIN'; end if;

    return query
    select
        apu.audit_id,
        upper(trim(coalesce(apu.end_pul, ''))) as end_pul,
        apu.val_pul,
        apu.end_sit,
        (
            ap.val_sep is not null
            and apu.val_pul is not null
            and app.pvps_alocacao_validade_rank(apu.val_pul) < app.pvps_alocacao_validade_rank(ap.val_sep)
        ) as is_lower,
        apu.dt_hr,
        coalesce(nullif(trim(coalesce(apu.auditor_nome, '')), ''), nullif(trim(coalesce(ap.auditor_nome, '')), ''), 'USUARIO') as auditor_nome,
        coalesce(nullif(trim(coalesce(apu.auditor_mat, '')), ''), nullif(trim(coalesce(ap.auditor_mat, '')), ''), 'SEM_MATRICULA') as auditor_mat
    from app.aud_pvps_pul apu
    join app.aud_pvps ap
      on ap.audit_id = apu.audit_id
    where apu.audit_id = any(coalesce(p_audit_ids, array[]::uuid[]))
    order by apu.audit_id, upper(trim(coalesce(apu.end_pul, '')));
end;
$$;

create or replace function app.produtividade_events_base(
    p_cd integer,
    p_dt_ini date default null,
    p_dt_fim date default null
)
returns table (
    activity_key text,
    activity_label text,
    unit_label text,
    user_id uuid,
    mat text,
    nome text,
    event_date date,
    metric_value numeric(18,3),
    detail text,
    source_ref text,
    event_at timestamptz
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $function$
    with profiles_cd as (
        select
            p.user_id,
            coalesce(nullif(trim(p.mat), ''), '-') as mat,
            coalesce(nullif(trim(p.nome), ''), 'Usuário') as nome,
            app.produtividade_norm_digits(p.mat) as mat_norm,
            app.produtividade_norm_text(p.nome) as nome_norm
        from authz.profiles p
        join authz.user_deposits ud
          on ud.user_id = p.user_id
         and ud.cd = p_cd
    ),
    inventario_enderecos as (
        select
            c.cd,
            c.counted_by as user_id,
            min(c.counted_mat) as mat,
            min(c.counted_nome) as nome,
            c.cycle_date as event_date,
            c.zona,
            upper(c.endereco) as endereco,
            c.etapa::integer as etapa,
            count(*)::integer as total_itens,
            min(c.count_id::text) as source_ref,
            max(c.updated_at) as event_at
        from app.conf_inventario_counts c
        where c.cd = p_cd
        group by
            c.cd,
            c.counted_by,
            c.cycle_date,
            c.zona,
            upper(c.endereco),
            c.etapa
    ),
    prod_vol_src as (
        select
            v.cd,
            coalesce(v.aud, v.usuario, '') as aud,
            coalesce(v.seq_ped, '') as seq_ped,
            v.filial,
            coalesce(v.placa, '') as placa,
            v.rota,
            coalesce(v.vol_conf, 0) as vol_conf,
            app.produtividade_norm_digits(coalesce(v.aud, v.usuario, '')) as aud_digits,
            app.produtividade_norm_text(coalesce(v.aud, v.usuario, '')) as aud_norm,
            coalesce(
                timezone('America/Sao_Paulo', v.encerramento)::date,
                timezone('America/Sao_Paulo', v.dt_lib)::date,
                timezone('America/Sao_Paulo', v.dt_ped)::date,
                timezone('America/Sao_Paulo', v.updated_at)::date
            ) as event_date,
            coalesce(v.encerramento, v.dt_lib, v.dt_ped, v.updated_at) as event_at
        from app.db_prod_vol v
        where v.cd = p_cd
          and coalesce(v.vol_conf, 0) > 0
    ),
    prod_blitz_src as (
        select
            b.cd,
            b.filial,
            b.nr_pedido,
            coalesce(b.auditor, '') as auditor,
            coalesce(b.qtd_un, 0) as qtd_un,
            app.produtividade_norm_digits(b.auditor) as aud_digits,
            app.produtividade_norm_text(b.auditor) as aud_norm,
            coalesce(
                timezone('America/Sao_Paulo', b.dt_conf)::date,
                timezone('America/Sao_Paulo', b.updated_at)::date
            ) as event_date,
            coalesce(b.dt_conf, b.updated_at) as event_at
        from app.db_prod_blitz b
        where b.cd = p_cd
          and coalesce(b.qtd_un, 0) > 0
    )
    select
        e.activity_key,
        e.activity_label,
        e.unit_label,
        e.user_id,
        e.mat,
        e.nome,
        e.event_date,
        e.metric_value,
        e.detail,
        e.source_ref,
        e.event_at
    from (
        select
            'coleta_sku'::text as activity_key,
            'Coleta de Mercadoria'::text as activity_label,
            'sku'::text as unit_label,
            c.user_id,
            c.mat_aud as mat,
            c.nome_aud as nome,
            timezone('America/Sao_Paulo', c.data_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | %s', c.coddv, left(coalesce(c.descricao, ''), 110)) as detail,
            c.id::text as source_ref,
            c.data_hr as event_at
        from app.aud_coleta c
        where c.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', c.data_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', c.data_hr)::date <= p_dt_fim)

        union all

        select
            'pvps_endereco'::text as activity_key,
            'PVPS'::text as activity_label,
            'endereços'::text as unit_label,
            p.auditor_id as user_id,
            p.auditor_mat as mat,
            p.auditor_nome as nome,
            timezone('America/Sao_Paulo', p.dt_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('SEP %s | Coddv %s', p.end_sep, p.coddv) as detail,
            p.audit_id::text as source_ref,
            p.dt_hr as event_at
        from app.aud_pvps p
        where p.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', p.dt_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', p.dt_hr)::date <= p_dt_fim)

        union all

        select
            'pvps_endereco'::text as activity_key,
            'PVPS'::text as activity_label,
            'endereços'::text as unit_label,
            coalesce(apu.auditor_id, p.auditor_id) as user_id,
            coalesce(apu.auditor_mat, p.auditor_mat) as mat,
            coalesce(apu.auditor_nome, p.auditor_nome) as nome,
            timezone('America/Sao_Paulo', apu.dt_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('PUL %s | SEP %s | Coddv %s', apu.end_pul, p.end_sep, p.coddv) as detail,
            apu.audit_pul_id::text as source_ref,
            apu.dt_hr as event_at
        from app.aud_pvps_pul apu
        join app.aud_pvps p
          on p.audit_id = apu.audit_id
        where p.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', apu.dt_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', apu.dt_hr)::date <= p_dt_fim)

        union all

        select
            'atividade_extra_pontos'::text as activity_key,
            'Atividade Extra'::text as activity_label,
            'pontos'::text as unit_label,
            a.user_id,
            a.mat,
            a.nome,
            a.data_inicio as event_date,
            round(coalesce(a.pontos, 0), 3)::numeric(18,3) as metric_value,
            left(coalesce(a.descricao, ''), 160) as detail,
            a.id::text as source_ref,
            a.created_at as event_at
        from app.atividade_extra a
        where a.cd = p_cd
          and coalesce(a.approval_status, 'approved') = 'approved'
          and (p_dt_ini is null or a.data_inicio >= p_dt_ini)
          and (p_dt_fim is null or a.data_inicio <= p_dt_fim)

        union all

        select
            'alocacao_endereco'::text as activity_key,
            'Alocação'::text as activity_label,
            'endereços'::text as unit_label,
            a.auditor_id as user_id,
            a.auditor_mat as mat,
            a.auditor_nome as nome,
            timezone('America/Sao_Paulo', a.dt_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Endereço %s | Coddv %s', a.endereco, a.coddv) as detail,
            a.audit_id::text as source_ref,
            a.dt_hr as event_at
        from app.aud_alocacao a
        where a.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', a.dt_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', a.dt_hr)::date <= p_dt_fim)

        union all

        select
            'entrada_notas_sku'::text as activity_key,
            'Entrada de Notas'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_entrada_notas_itens i
        join app.conf_entrada_notas c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'termo_sku'::text as activity_key,
            'Conferência de Termo'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_termo_itens i
        join app.conf_termo c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'avulso_sku'::text as activity_key,
            'Conferência Volume Avulso'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_volume_avulso_itens i
        join app.conf_volume_avulso c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'pedido_direto_sku'::text as activity_key,
            'Conferência Pedido Direto'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_pedido_direto_itens i
        join app.conf_pedido_direto c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'zerados_endereco'::text as activity_key,
            'Inventário (Zerados)'::text as activity_label,
            'endereços'::text as unit_label,
            z.user_id,
            z.mat,
            z.nome,
            z.event_date,
            z.total_itens::numeric(18,3) as metric_value,
            format('Zona %s | Endereço %s | Etapa %s | Itens %s', z.zona, z.endereco, z.etapa, z.total_itens) as detail,
            z.source_ref,
            z.event_at
        from inventario_enderecos z
        where (p_dt_ini is null or z.event_date >= p_dt_ini)
          and (p_dt_fim is null or z.event_date <= p_dt_fim)

        union all

        select
            'devolucao_nfd'::text as activity_key,
            'Devolução de Mercadoria'::text as activity_label,
            'devolução'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) as event_date,
            1::numeric(18,3) as metric_value,
            case
                when c.conference_kind = 'sem_nfd' then
                    concat_ws(
                        ' | ',
                        'Sem NFD',
                        case
                            when nullif(trim(coalesce(c.nfo, '')), '') is not null
                                then format('NFO %s', nullif(trim(coalesce(c.nfo, '')), ''))
                            else null
                        end,
                        case
                            when nullif(trim(coalesce(c.motivo_sem_nfd, '')), '') is not null
                                then format('Motivo %s', nullif(trim(coalesce(c.motivo_sem_nfd, '')), ''))
                            else null
                        end,
                        format('Ref %s', left(c.conf_id::text, 8))
                    )
                else
                    coalesce(
                        format('NFD %s', c.nfd::text),
                        format('Chave %s', nullif(trim(coalesce(c.chave, '')), '')),
                        format('Ref %s', left(c.conf_id::text, 8))
                    )
            end as detail,
            c.conf_id::text as source_ref,
            coalesce(c.finalized_at, c.updated_at) as event_at
        from app.conf_devolucao c
        where c.cd = p_cd
          and c.status in ('finalizado_ok', 'finalizado_falta')
          and (
              p_dt_ini is null
              or coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) >= p_dt_ini
          )
          and (
              p_dt_fim is null
              or coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) <= p_dt_fim
          )

        union all

        select
            'prod_vol_mes'::text as activity_key,
            'Produtividade Volume (base externa)'::text as activity_label,
            'volume'::text as unit_label,
            pr.user_id,
            pr.mat,
            pr.nome,
            v.event_date,
            v.vol_conf::numeric(18,3) as metric_value,
            format(
                'Pedido %s | Filial %s | Rota %s | Placa %s',
                coalesce(nullif(trim(v.seq_ped), ''), '-'),
                coalesce(v.filial::text, '-'),
                coalesce(v.rota::text, '-'),
                coalesce(nullif(trim(v.placa), ''), '-')
            ) as detail,
            format(
                'prod_vol:%s:%s:%s',
                coalesce(nullif(trim(v.seq_ped), ''), '-'),
                coalesce(v.filial::text, '-'),
                to_char(timezone('America/Sao_Paulo', v.event_at), 'YYYYMMDDHH24MISS')
            ) as source_ref,
            v.event_at
        from prod_vol_src v
        join lateral (
            select
                p.user_id,
                p.mat,
                p.nome
            from profiles_cd p
            where (
                v.aud_digits <> ''
                and p.mat_norm = v.aud_digits
            ) or (
                v.aud_norm <> ''
                and p.nome_norm = v.aud_norm
            )
            order by
                case when v.aud_digits <> '' and p.mat_norm = v.aud_digits then 0 else 1 end,
                p.user_id
            limit 1
        ) pr on true
        where (p_dt_ini is null or v.event_date >= p_dt_ini)
          and (p_dt_fim is null or v.event_date <= p_dt_fim)

        union all

        select
            'prod_blitz_un'::text as activity_key,
            'Produtividade Blitz (base externa)'::text as activity_label,
            'unidades'::text as unit_label,
            pr.user_id,
            pr.mat,
            pr.nome,
            b.event_date,
            b.qtd_un::numeric(18,3) as metric_value,
            format('Filial %s | Pedido %s', b.filial::text, b.nr_pedido::text) as detail,
            format('prod_blitz:%s:%s', b.filial::text, b.nr_pedido::text) as source_ref,
            b.event_at
        from prod_blitz_src b
        join lateral (
            select
                p.user_id,
                p.mat,
                p.nome
            from profiles_cd p
            where (
                b.aud_digits <> ''
                and p.mat_norm = b.aud_digits
            ) or (
                b.aud_norm <> ''
                and p.nome_norm = b.aud_norm
            )
            order by
                case when b.aud_digits <> '' and p.mat_norm = b.aud_digits then 0 else 1 end,
                p.user_id
            limit 1
        ) pr on true
        where (p_dt_ini is null or b.event_date >= p_dt_ini)
          and (p_dt_fim is null or b.event_date <= p_dt_fim)
    ) e;
$function$;

grant execute on function public.rpc_pvps_submit_pul(uuid, text, text) to authenticated;
grant execute on function public.rpc_pvps_submit_pul(uuid, text, text, text) to authenticated;
grant execute on function public.rpc_pvps_submit_pul(integer, uuid, text, text) to authenticated;
grant execute on function public.rpc_pvps_submit_pul(integer, uuid, text, text, text) to authenticated;
grant execute on function public.rpc_pvps_completed_pul_items(integer, uuid) to authenticated;
grant execute on function public.rpc_pvps_report_pul_items(uuid[]) to authenticated;
