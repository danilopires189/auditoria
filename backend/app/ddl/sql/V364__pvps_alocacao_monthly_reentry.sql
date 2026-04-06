alter table app.aud_pvps
    add column if not exists audit_month_ref date;

update app.aud_pvps
set audit_month_ref = date_trunc('month', timezone('America/Sao_Paulo', coalesce(dt_hr, now())))::date
where audit_month_ref is null;

alter table app.aud_pvps
    alter column audit_month_ref set not null;

alter table app.aud_pvps
    alter column audit_month_ref set default (date_trunc('month', timezone('America/Sao_Paulo', now()))::date);

alter table app.aud_alocacao
    add column if not exists audit_month_ref date;

update app.aud_alocacao
set audit_month_ref = date_trunc('month', timezone('America/Sao_Paulo', coalesce(dt_hr, now())))::date
where audit_month_ref is null;

alter table app.aud_alocacao
    alter column audit_month_ref set not null;

alter table app.aud_alocacao
    alter column audit_month_ref set default (date_trunc('month', timezone('America/Sao_Paulo', now()))::date);

create or replace function app.pvps_alocacao_sync_audit_month_ref()
returns trigger
language plpgsql
as $$
begin
    new.audit_month_ref := date_trunc('month', timezone('America/Sao_Paulo', coalesce(new.dt_hr, now())))::date;
    return new;
end;
$$;

drop trigger if exists trg_aud_pvps_sync_audit_month_ref on app.aud_pvps;
create trigger trg_aud_pvps_sync_audit_month_ref
before insert on app.aud_pvps
for each row execute function app.pvps_alocacao_sync_audit_month_ref();

drop trigger if exists trg_aud_alocacao_sync_audit_month_ref on app.aud_alocacao;
create trigger trg_aud_alocacao_sync_audit_month_ref
before insert on app.aud_alocacao
for each row execute function app.pvps_alocacao_sync_audit_month_ref();

alter table app.aud_pvps
    drop constraint if exists uq_aud_pvps_sep;

alter table app.aud_pvps
    drop constraint if exists uq_aud_pvps_sep_month;

alter table app.aud_pvps
    add constraint uq_aud_pvps_sep_month unique (cd, coddv, end_sep, audit_month_ref);

alter table app.aud_alocacao
    drop constraint if exists uq_aud_alocacao_queue;

alter table app.aud_alocacao
    drop constraint if exists uq_aud_alocacao_queue_month;

alter table app.aud_alocacao
    add constraint uq_aud_alocacao_queue_month unique (queue_id, audit_month_ref);

create index if not exists idx_aud_pvps_item_month_dt
    on app.aud_pvps (cd, coddv, end_sep, audit_month_ref, dt_hr desc);

create index if not exists idx_aud_alocacao_queue_month_dt
    on app.aud_alocacao (queue_id, audit_month_ref, dt_hr desc);

create index if not exists idx_aud_alocacao_item_month_dt
    on app.aud_alocacao (cd, coddv, endereco, audit_month_ref, dt_hr desc);

create or replace function app.pvps_reseed(p_cd integer)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_limit integer := app.pvps_alocacao_window_limit();
    v_buffer integer := app.pvps_alocacao_candidate_buffer_limit();
    v_today date := (timezone('America/Sao_Paulo', now()))::date;
    v_month_ref date := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
begin
    with current_started as (
        select coddv
        from (
            select
                d.coddv,
                min(app.pvps_admin_priority_score(d.cd, 'pvps', d.zona, d.coddv, d.coddv::text || '|' || d.end_sep))::integer as priority_score,
                max(d.dat_ult_compra) as dat_ult_compra
            from app.db_pvps d
            where d.cd = p_cd
              and d.is_pending
              and d.is_window_active
              and exists (
                  select 1
                  from app.aud_pvps ap
                  where ap.cd = d.cd
                    and ap.coddv = d.coddv
                    and ap.audit_month_ref = v_month_ref
                    and timezone('America/Sao_Paulo', ap.dt_hr)::date = v_today
              )
            group by d.coddv
            order by priority_score asc, dat_ult_compra desc, d.coddv
            limit v_limit
        ) started
    ),
    started_rows as (
        select
            d.cd,
            d.zona,
            d.coddv,
            d.descricao,
            d.end_sep,
            d.end_pul,
            d.qtd_est_disp,
            d.dat_ult_compra,
            true as is_window_active
        from app.db_pvps d
        join current_started cs
          on cs.coddv = d.coddv
        where d.cd = p_cd
          and d.is_pending
          and d.is_window_active
    ),
    candidate_products as (
        select
            rb.cd,
            rb.coddv,
            rb.dat_ult_compra,
            rb.qtd_est_disp
        from (
            select
                e.cd,
                e.coddv,
                e.dat_ult_compra,
                greatest(coalesce(e.qtd_est_disp, 0), 0) as qtd_est_disp,
                row_number() over (
                    partition by e.cd, e.coddv
                    order by e.dat_ult_compra desc, greatest(coalesce(e.qtd_est_disp, 0), 0) desc, e.coddv
                ) as rn
            from app.db_estq_entr e
            where e.cd = p_cd
              and coalesce(e.qtd_est_disp, 0) >= 200
              and e.dat_ult_compra is not null
              and not exists (
                  select 1
                  from current_started cs
                  where cs.coddv = e.coddv
              )
        ) rb
        where rb.rn = 1
    ),
    eligible_rows as (
        select
            cp.cd,
            app.pvps_alocacao_normalize_zone(sep.endereco) as zona,
            cp.coddv,
            coalesce(
                nullif(trim(coalesce(sep.descricao, '')), ''),
                nullif(trim(coalesce(pul.descricao, '')), ''),
                format('CODDV %s', cp.coddv)
            ) as descricao,
            upper(trim(sep.endereco)) as end_sep,
            upper(trim(pul.endereco)) as end_pul,
            cp.qtd_est_disp,
            cp.dat_ult_compra,
            app.pvps_admin_priority_score(
                cp.cd,
                'pvps',
                app.pvps_alocacao_normalize_zone(sep.endereco),
                cp.coddv,
                cp.coddv::text || '|' || upper(trim(sep.endereco))
            )::integer as priority_score
        from candidate_products cp
        join app.db_end sep
          on sep.cd = cp.cd
         and sep.coddv = cp.coddv
         and upper(trim(coalesce(sep.tipo, ''))) = 'SEP'
        join app.db_end pul
          on pul.cd = cp.cd
         and pul.coddv = cp.coddv
         and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where not app.pvps_admin_is_item_blacklisted(
            cp.cd,
            'pvps',
            app.pvps_alocacao_normalize_zone(sep.endereco),
            cp.coddv,
            cp.coddv::text || '|' || upper(trim(sep.endereco))
        )
          and not exists (
              select 1
              from app.aud_pvps ap
              where ap.cd = cp.cd
                and ap.coddv = cp.coddv
                and ap.end_sep = upper(trim(sep.endereco))
                and ap.audit_month_ref = v_month_ref
                and ap.status in ('concluido', 'nao_conforme')
          )
    ),
    eligible_products as (
        select
            er.cd,
            er.coddv,
            max(er.dat_ult_compra) as dat_ult_compra,
            max(er.qtd_est_disp) as qtd_est_disp,
            min(er.priority_score) as priority_score
        from eligible_rows er
        group by er.cd, er.coddv
        order by priority_score asc, dat_ult_compra desc, coddv
        limit v_buffer
    ),
    active_recent_products as (
        select ep.coddv
        from eligible_products ep
        order by ep.priority_score asc, ep.dat_ult_compra desc, ep.coddv
        limit greatest(v_limit - (select count(*) from current_started), 0)
    ),
    recent_rows as (
        select
            er.cd,
            er.zona,
            er.coddv,
            er.descricao,
            er.end_sep,
            er.end_pul,
            er.qtd_est_disp,
            er.dat_ult_compra,
            exists (
                select 1
                from active_recent_products arp
                where arp.coddv = er.coddv
            ) as is_window_active
        from eligible_rows er
        join eligible_products ep
          on ep.cd = er.cd
         and ep.coddv = er.coddv
    ),
    expanded as (
        select * from started_rows
        union all
        select * from recent_rows
    ),
    upserted as (
        insert into app.db_pvps (
            cd,
            zona,
            coddv,
            descricao,
            end_sep,
            end_pul,
            qtd_est_disp,
            dat_ult_compra,
            is_pending,
            is_window_active
        )
        select
            e.cd,
            e.zona,
            e.coddv,
            e.descricao,
            e.end_sep,
            e.end_pul,
            e.qtd_est_disp,
            e.dat_ult_compra,
            true,
            e.is_window_active
        from expanded e
        on conflict (cd, coddv, end_sep, end_pul)
        do update set
            zona = excluded.zona,
            descricao = excluded.descricao,
            qtd_est_disp = excluded.qtd_est_disp,
            dat_ult_compra = excluded.dat_ult_compra,
            is_pending = true,
            is_window_active = excluded.is_window_active
        returning 1
    )
    update app.db_pvps d
    set is_pending = false,
        is_window_active = false
    where d.cd = p_cd
      and d.is_pending
      and not exists (
          select 1
          from expanded e
          where e.cd = d.cd
            and e.coddv = d.coddv
            and e.end_sep = d.end_sep
            and e.end_pul = d.end_pul
      );
end;
$$;

create or replace function app.alocacao_reseed(p_cd integer)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_limit integer := app.pvps_alocacao_window_limit();
    v_buffer integer := app.pvps_alocacao_candidate_buffer_limit();
    v_today date := (timezone('America/Sao_Paulo', now()))::date;
    v_month_ref date := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
begin
    with current_started as (
        select coddv
        from (
            select
                d.coddv,
                min(app.pvps_admin_priority_score(d.cd, 'alocacao', d.zona, d.coddv, d.queue_id::text))::integer as priority_score,
                max(d.dat_ult_compra) as dat_ult_compra
            from app.db_alocacao d
            where d.cd = p_cd
              and d.is_pending
              and d.is_window_active
              and exists (
                  select 1
                  from app.aud_alocacao aa
                  where aa.cd = d.cd
                    and aa.coddv = d.coddv
                    and aa.audit_month_ref = v_month_ref
                    and timezone('America/Sao_Paulo', aa.dt_hr)::date = v_today
              )
            group by d.coddv
            order by priority_score asc, dat_ult_compra desc, d.coddv
            limit v_limit
        ) started
    ),
    started_rows as (
        select
            d.cd,
            d.zona,
            d.coddv,
            d.descricao,
            d.endereco,
            d.nivel,
            d.val_sist,
            d.qtd_est_disp,
            d.dat_ult_compra,
            true as is_window_active
        from app.db_alocacao d
        join current_started cs
          on cs.coddv = d.coddv
        where d.cd = p_cd
          and d.is_pending
          and d.is_window_active
    ),
    candidate_products as (
        select
            rb.cd,
            rb.coddv,
            rb.dat_ult_compra,
            rb.qtd_est_disp
        from (
            select
                e.cd,
                e.coddv,
                e.dat_ult_compra,
                greatest(coalesce(e.qtd_est_disp, 0), 0) as qtd_est_disp,
                row_number() over (
                    partition by e.cd, e.coddv
                    order by e.dat_ult_compra desc, greatest(coalesce(e.qtd_est_disp, 0), 0) desc, e.coddv
                ) as rn
            from app.db_estq_entr e
            where e.cd = p_cd
              and coalesce(e.qtd_est_disp, 0) >= 200
              and e.dat_ult_compra is not null
              and not exists (
                  select 1
                  from current_started cs
                  where cs.coddv = e.coddv
              )
        ) rb
        where rb.rn = 1
    ),
    eligible_rows as (
        select
            cp.cd,
            app.pvps_alocacao_normalize_zone(pul.endereco) as zona,
            cp.coddv,
            coalesce(
                nullif(trim(coalesce(pul.descricao, '')), ''),
                format('CODDV %s', cp.coddv)
            ) as descricao,
            upper(trim(pul.endereco)) as endereco,
            nullif(trim(coalesce(pul.andar, '')), '') as nivel,
            app.pvps_alocacao_normalize_validade(pul.validade) as val_sist,
            cp.qtd_est_disp,
            cp.dat_ult_compra,
            app.pvps_admin_priority_score(
                cp.cd,
                'alocacao',
                app.pvps_alocacao_normalize_zone(pul.endereco),
                cp.coddv,
                null
            )::integer as priority_score
        from candidate_products cp
        join app.db_end pul
          on pul.cd = cp.cd
         and pul.coddv = cp.coddv
         and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where nullif(trim(coalesce(pul.validade, '')), '') is not null
          and not app.pvps_admin_is_item_blacklisted(
              cp.cd,
              'alocacao',
              app.pvps_alocacao_normalize_zone(pul.endereco),
              cp.coddv,
              null
          )
          and not exists (
              select 1
              from app.aud_alocacao aa
              where aa.cd = cp.cd
                and aa.coddv = cp.coddv
                and aa.endereco = upper(trim(pul.endereco))
                and aa.audit_month_ref = v_month_ref
          )
    ),
    eligible_products as (
        select
            er.cd,
            er.coddv,
            max(er.dat_ult_compra) as dat_ult_compra,
            max(er.qtd_est_disp) as qtd_est_disp,
            min(er.priority_score) as priority_score
        from eligible_rows er
        group by er.cd, er.coddv
        order by priority_score asc, dat_ult_compra desc, coddv
        limit v_buffer
    ),
    active_recent_products as (
        select ep.coddv
        from eligible_products ep
        order by ep.priority_score asc, ep.dat_ult_compra desc, ep.coddv
        limit greatest(v_limit - (select count(*) from current_started), 0)
    ),
    recent_rows as (
        select
            er.cd,
            er.zona,
            er.coddv,
            er.descricao,
            er.endereco,
            er.nivel,
            er.val_sist,
            er.qtd_est_disp,
            er.dat_ult_compra,
            exists (
                select 1
                from active_recent_products arp
                where arp.coddv = er.coddv
            ) as is_window_active
        from eligible_rows er
        join eligible_products ep
          on ep.cd = er.cd
         and ep.coddv = er.coddv
    ),
    expanded as (
        select * from started_rows
        union all
        select * from recent_rows
    ),
    upserted as (
        insert into app.db_alocacao (
            cd,
            zona,
            coddv,
            descricao,
            endereco,
            nivel,
            val_sist,
            qtd_est_disp,
            dat_ult_compra,
            is_pending,
            is_window_active
        )
        select
            e.cd,
            e.zona,
            e.coddv,
            e.descricao,
            e.endereco,
            e.nivel,
            e.val_sist,
            e.qtd_est_disp,
            e.dat_ult_compra,
            true,
            e.is_window_active
        from expanded e
        on conflict (cd, coddv, endereco)
        do update set
            zona = excluded.zona,
            descricao = excluded.descricao,
            nivel = excluded.nivel,
            val_sist = excluded.val_sist,
            qtd_est_disp = excluded.qtd_est_disp,
            dat_ult_compra = excluded.dat_ult_compra,
            is_pending = true,
            is_window_active = excluded.is_window_active
        returning 1
    )
    update app.db_alocacao d
    set is_pending = false,
        is_window_active = false
    where d.cd = p_cd
      and d.is_pending
      and not exists (
          select 1
          from expanded e
          where e.cd = d.cd
            and e.coddv = d.coddv
            and e.endereco = d.endereco
      );
end;
$$;

create or replace function public.rpc_pvps_submit_sep(
    p_cd integer default null,
    p_coddv integer default null,
    p_end_sep text default null,
    p_end_sit text default null,
    p_val_sep text default null
)
returns table (
    audit_id uuid,
    status text,
    val_sep text,
    end_sit text,
    pul_total integer,
    pul_auditados integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
    v_mat text;
    v_nome text;
    v_end_sep text;
    v_end_sit text;
    v_val_sep text;
    v_audit_id uuid;
    v_pul_total integer;
    v_pul_auditados integer;
    v_status text := 'pendente_pul';
    v_flagged boolean := false;
    v_item_zona text;
    v_existing_auditor_id uuid;
    v_month_ref date := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_coddv is null or p_coddv <= 0 then raise exception 'CODDV_OBRIGATORIO'; end if;
    v_end_sep := upper(nullif(trim(coalesce(p_end_sep, '')), ''));
    if v_end_sep is null then raise exception 'END_SEP_OBRIGATORIO'; end if;

    select d.zona into v_item_zona
    from app.db_pvps d
    where d.cd = v_cd and d.coddv = p_coddv and d.end_sep = v_end_sep
    limit 1;

    if v_item_zona is null then
        raise exception 'ITEM_PVPS_NAO_ENCONTRADO';
    end if;

    if app.pvps_admin_is_item_blacklisted(v_cd, 'pvps', v_item_zona, p_coddv, p_coddv::text || '|' || v_end_sep) then
        raise exception 'ITEM_BLOQUEADO_BLACKLIST';
    end if;

    if exists (
        select 1
        from app.db_pvps d
        where d.cd = v_cd
          and d.coddv = p_coddv
          and d.end_sep = v_end_sep
          and not d.is_pending
    ) then
        select ap.auditor_id
        into v_existing_auditor_id
        from app.aud_pvps ap
        where ap.cd = v_cd
          and ap.coddv = p_coddv
          and ap.end_sep = v_end_sep
        order by ap.dt_hr desc
        limit 1;

        if v_existing_auditor_id = v_uid then
            raise exception 'ITEM_PVPS_AUDITADO_PELO_USUARIO';
        end if;
        raise exception 'ITEM_PVPS_AUDITADO_POR_OUTRO_USUARIO';
    end if;

    v_end_sit := lower(trim(coalesce(p_end_sit, '')));
    if v_end_sit = '' then
        v_end_sit := null;
    elsif v_end_sit not in ('vazio', 'obstruido') then
        raise exception 'END_SIT_INVALIDO';
    end if;

    v_flagged := v_end_sit is not null;
    if v_flagged then
        v_val_sep := null;
    else
        v_val_sep := app.pvps_alocacao_normalize_validade(p_val_sep);
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    insert into app.aud_pvps (
        cd, zona, coddv, descricao, end_sep, end_sit, val_sep,
        auditor_id, auditor_mat, auditor_nome, status, dt_hr, audit_month_ref
    )
    select
        d.cd,
        d.zona,
        d.coddv,
        d.descricao,
        d.end_sep,
        v_end_sit,
        v_val_sep,
        v_uid,
        v_mat,
        v_nome,
        case when v_flagged then 'concluido' else 'pendente_pul' end,
        now(),
        v_month_ref
    from app.db_pvps d
    where d.cd = v_cd and d.coddv = p_coddv and d.end_sep = v_end_sep
    order by d.dat_ult_compra desc
    limit 1
    on conflict on constraint uq_aud_pvps_sep_month
    do update set
        end_sit = excluded.end_sit,
        val_sep = excluded.val_sep,
        auditor_id = excluded.auditor_id,
        auditor_mat = excluded.auditor_mat,
        auditor_nome = excluded.auditor_nome,
        status = excluded.status,
        dt_hr = now(),
        audit_month_ref = excluded.audit_month_ref
    returning app.aud_pvps.audit_id into v_audit_id;

    select count(*)::integer
    into v_pul_total
    from app.db_pvps d
    where d.cd = v_cd and d.coddv = p_coddv and d.end_sep = v_end_sep;

    select count(*)::integer
    into v_pul_auditados
    from app.aud_pvps_pul apu
    where apu.audit_id = v_audit_id;

    if v_flagged then
        v_status := 'concluido';
        update app.db_pvps
        set is_pending = false
        where cd = v_cd and coddv = p_coddv and end_sep = v_end_sep;

        perform app.pvps_alocacao_replenish(v_cd, 'pvps');
    end if;

    return query
    select v_audit_id, v_status, v_val_sep, v_end_sit, coalesce(v_pul_total, 0), coalesce(v_pul_auditados, 0);
end;
$$;

create or replace function public.rpc_alocacao_submit(
    p_queue_id uuid,
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
    v_profile record;
    v_mat text;
    v_nome text;
    v_item app.db_alocacao%rowtype;
    v_end_sit text;
    v_val_conf text;
    v_val_sist text;
    v_aud_sit text;
    v_audit_id uuid;
    v_existing_auditor_id uuid;
    v_month_ref date := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    select * into v_item from app.db_alocacao where queue_id = p_queue_id for update;
    if v_item.queue_id is null then raise exception 'ITEM_ALOCACAO_NAO_ENCONTRADO'; end if;
    if not v_item.is_pending then
        select aa.auditor_id
        into v_existing_auditor_id
        from app.aud_alocacao aa
        where aa.queue_id = v_item.queue_id
        order by aa.dt_hr desc
        limit 1;

        if v_existing_auditor_id = v_uid then
            raise exception 'ITEM_ALOCACAO_AUDITADO_PELO_USUARIO';
        end if;
        raise exception 'ITEM_ALOCACAO_AUDITADO_POR_OUTRO_USUARIO';
    end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_item.cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    if app.pvps_admin_is_item_blacklisted(v_item.cd, 'alocacao', v_item.zona, v_item.coddv, v_item.queue_id::text) then
        raise exception 'ITEM_BLOQUEADO_BLACKLIST';
    end if;

    v_end_sit := lower(trim(coalesce(p_end_sit, '')));
    if v_end_sit = '' then
        v_end_sit := null;
    elsif v_end_sit not in ('vazio', 'obstruido') then
        raise exception 'END_SIT_INVALIDO';
    end if;

    select app.pvps_alocacao_normalize_validade(e.validade)
    into v_val_sist
    from app.db_end e
    where e.cd = v_item.cd
      and e.coddv = v_item.coddv
      and upper(trim(coalesce(e.tipo, ''))) = 'PUL'
      and upper(trim(coalesce(e.endereco, ''))) = v_item.endereco
      and nullif(trim(coalesce(e.validade, '')), '') is not null
    order by
        app.pvps_alocacao_validade_rank(app.pvps_alocacao_normalize_validade(e.validade)),
        app.pvps_alocacao_normalize_validade(e.validade)
    limit 1;

    v_val_sist := coalesce(v_val_sist, app.pvps_alocacao_normalize_validade(v_item.val_sist));

    update app.db_alocacao
    set val_sist = v_val_sist
    where queue_id = v_item.queue_id;

    if v_end_sit is not null then
        v_val_conf := null;
        v_aud_sit := 'ocorrencia';
    else
        v_val_conf := app.pvps_alocacao_normalize_validade(p_val_conf);
        v_aud_sit := case when v_val_conf = v_val_sist then 'conforme' else 'nao_conforme' end;
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    insert into app.aud_alocacao (
        queue_id, cd, zona, coddv, descricao, endereco, nivel,
        end_sit, val_sist, val_conf, aud_sit,
        auditor_id, auditor_mat, auditor_nome, dt_hr, audit_month_ref
    )
    values (
        v_item.queue_id, v_item.cd, v_item.zona, v_item.coddv, v_item.descricao, v_item.endereco, v_item.nivel,
        v_end_sit, v_val_sist, v_val_conf, v_aud_sit,
        v_uid, v_mat, v_nome, now(), v_month_ref
    )
    on conflict on constraint uq_aud_alocacao_queue_month
    do update set
        end_sit = excluded.end_sit,
        val_sist = excluded.val_sist,
        val_conf = excluded.val_conf,
        aud_sit = excluded.aud_sit,
        auditor_id = excluded.auditor_id,
        auditor_mat = excluded.auditor_mat,
        auditor_nome = excluded.auditor_nome,
        dt_hr = now(),
        audit_month_ref = excluded.audit_month_ref
    returning app.aud_alocacao.audit_id into v_audit_id;

    update app.db_alocacao
    set is_pending = false
    where queue_id = v_item.queue_id;

    perform app.pvps_alocacao_replenish(v_item.cd, 'alocacao');

    return query
    select v_audit_id, v_aud_sit, v_val_sist, v_val_conf;
end;
$$;

create or replace function public.rpc_pvps_manifest_items_page(
    p_cd integer default null,
    p_zona text default null,
    p_offset integer default 0,
    p_limit integer default 100
)
returns table (
    cd integer,
    zona text,
    coddv integer,
    descricao text,
    end_sep text,
    pul_total integer,
    pul_auditados integer,
    status text,
    end_sit text,
    val_sep text,
    audit_id uuid,
    dat_ult_compra date,
    qtd_est_disp integer,
    priority_score integer,
    is_window_active boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zona text;
    v_offset integer;
    v_limit integer;
    v_month_ref date := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_zona := upper(nullif(trim(coalesce(p_zona, '')), ''));
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 100), 1), 1000);

    perform app.pvps_alocacao_replenish_if_needed(
        p_cd => v_cd,
        p_modulo => 'pvps',
        p_force => false,
        p_min_pending => 80,
        p_cooldown_seconds => 120
    );

    return query
    with base as (
        select
            d.cd,
            d.zona,
            d.coddv,
            max(d.descricao) as descricao,
            d.end_sep,
            max(d.dat_ult_compra) as dat_ult_compra,
            max(d.qtd_est_disp) as qtd_est_disp,
            count(*)::integer as pul_total,
            min(app.pvps_admin_priority_score(
                v_cd,
                'pvps',
                d.zona,
                d.coddv,
                d.coddv::text || '|' || d.end_sep
            ))::integer as priority_score,
            bool_or(d.is_window_active) as is_window_active
        from app.db_pvps d
        where d.cd = v_cd
          and d.is_pending
          and (v_zona is null or d.zona = v_zona)
          and not app.pvps_admin_is_item_blacklisted(
            v_cd,
            'pvps',
            d.zona,
            d.coddv,
            d.coddv::text || '|' || d.end_sep
          )
        group by d.cd, d.zona, d.coddv, d.end_sep
    ),
    page_base as (
        select
            b.cd,
            b.zona,
            b.coddv,
            b.descricao,
            b.end_sep,
            b.pul_total,
            b.dat_ult_compra,
            b.qtd_est_disp,
            b.priority_score,
            b.is_window_active
        from base b
        order by
            b.is_window_active desc,
            b.priority_score asc,
            b.dat_ult_compra desc,
            b.zona,
            b.end_sep,
            b.coddv
        offset v_offset
        limit v_limit
    )
    select
        pb.cd,
        pb.zona,
        pb.coddv,
        pb.descricao,
        pb.end_sep,
        pb.pul_total,
        coalesce(pd.pul_auditados, 0) as pul_auditados,
        coalesce(ap.status, 'pendente_sep') as status,
        ap.end_sit,
        ap.val_sep,
        ap.audit_id,
        pb.dat_ult_compra,
        pb.qtd_est_disp,
        pb.priority_score,
        pb.is_window_active
    from page_base pb
    left join lateral (
        select
            ap.audit_id,
            ap.status,
            ap.end_sit,
            ap.val_sep
        from app.aud_pvps ap
        where ap.cd = pb.cd
          and ap.coddv = pb.coddv
          and ap.end_sep = pb.end_sep
          and ap.audit_month_ref = v_month_ref
        order by ap.dt_hr desc nulls last, ap.audit_id desc
        limit 1
    ) ap on true
    left join lateral (
        select count(*)::integer as pul_auditados
        from app.aud_pvps_pul apu
        where apu.audit_id = ap.audit_id
    ) pd on true
    order by
        pb.is_window_active desc,
        pb.priority_score asc,
        pb.dat_ult_compra desc,
        pb.zona,
        pb.end_sep,
        pb.coddv;
end;
$$;

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
    v_month_ref date := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
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
          and ap.audit_month_ref = v_month_ref
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

grant execute on function public.rpc_pvps_submit_sep(integer, integer, text, text, text) to authenticated;
grant execute on function public.rpc_alocacao_submit(uuid, text, text) to authenticated;
grant execute on function public.rpc_pvps_manifest_items_page(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_pvps_pul_items(integer, integer, text) to authenticated;
