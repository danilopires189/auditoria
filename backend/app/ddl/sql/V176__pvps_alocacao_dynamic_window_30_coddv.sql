alter table if exists app.db_pvps
    add column if not exists is_window_active boolean not null default false;

alter table if exists app.db_alocacao
    add column if not exists is_window_active boolean not null default false;

create index if not exists idx_db_pvps_cd_pending_window
    on app.db_pvps (cd, is_pending, is_window_active, dat_ult_compra desc, coddv);

create index if not exists idx_db_alocacao_cd_pending_window
    on app.db_alocacao (cd, is_pending, is_window_active, dat_ult_compra desc, coddv);

create or replace function app.pvps_alocacao_window_limit()
returns integer
language sql
immutable
as $$
    select 30;
$$;

create or replace function app.pvps_reseed(p_cd integer)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_limit integer := app.pvps_alocacao_window_limit();
begin
    with current_started as (
        select distinct d.coddv
        from app.db_pvps d
        where d.cd = p_cd
          and d.is_pending
          and exists (
              select 1
              from app.aud_pvps ap
              where ap.cd = d.cd
                and ap.coddv = d.coddv
          )
    ),
    candidate_rows as (
        select
            e.cd,
            e.coddv,
            coalesce(
                nullif(trim(coalesce(sep.descricao, '')), ''),
                nullif(trim(coalesce(pul.descricao, '')), ''),
                format('CODDV %s', e.coddv)
            ) as descricao,
            upper(trim(sep.endereco)) as end_sep,
            upper(trim(pul.endereco)) as end_pul,
            app.pvps_alocacao_normalize_zone(sep.endereco) as zona,
            greatest(coalesce(e.qtd_est_disp, 0), 0) as qtd_est_disp,
            e.dat_ult_compra,
            app.pvps_admin_priority_score(
                e.cd,
                'pvps',
                app.pvps_alocacao_normalize_zone(sep.endereco),
                e.coddv,
                e.coddv::text || '|' || upper(trim(sep.endereco))
            ) as priority_score
        from app.db_estq_entr e
        join app.db_end sep
          on sep.cd = e.cd
         and sep.coddv = e.coddv
         and upper(trim(coalesce(sep.tipo, ''))) = 'SEP'
        join app.db_end pul
          on pul.cd = e.cd
         and pul.coddv = e.coddv
         and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where e.cd = p_cd
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
          and not app.pvps_admin_is_item_blacklisted(
              e.cd,
              'pvps',
              app.pvps_alocacao_normalize_zone(sep.endereco),
              e.coddv,
              e.coddv::text || '|' || upper(trim(sep.endereco))
          )
          and not exists (
              select 1
              from app.aud_pvps ap
              where ap.cd = e.cd
                and ap.coddv = e.coddv
                and ap.end_sep = upper(trim(sep.endereco))
                and ap.status in ('concluido', 'nao_conforme')
          )
    ),
    candidate_products as (
        select
            c.cd,
            c.coddv,
            max(c.dat_ult_compra) as dat_ult_compra,
            max(c.qtd_est_disp) as qtd_est_disp,
            min(c.priority_score)::integer as priority_score
        from candidate_rows c
        group by c.cd, c.coddv
    ),
    ranked_products as (
        select
            cp.cd,
            cp.coddv,
            cp.dat_ult_compra,
            cp.qtd_est_disp,
            cp.priority_score,
            (cs.coddv is not null) as is_started
        from candidate_products cp
        left join current_started cs
          on cs.coddv = cp.coddv
    ),
    started_products as (
        select rp.coddv
        from ranked_products rp
        where rp.is_started
        order by rp.priority_score asc, rp.dat_ult_compra desc, rp.coddv
    ),
    fresh_products as (
        select rp.coddv
        from ranked_products rp
        where not rp.is_started
        order by rp.priority_score asc, rp.dat_ult_compra desc, rp.coddv
        limit greatest(v_limit - (select count(*) from started_products), 0)
    ),
    active_products as (
        select coddv from started_products
        union
        select coddv from fresh_products
    ),
    expanded as (
        select
            c.cd,
            c.zona,
            c.coddv,
            c.descricao,
            c.end_sep,
            c.end_pul,
            c.qtd_est_disp,
            c.dat_ult_compra,
            exists (
                select 1
                from active_products ap
                where ap.coddv = c.coddv
            ) as is_window_active
        from candidate_rows c
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
begin
    with current_started as (
        select distinct d.coddv
        from app.db_alocacao d
        where d.cd = p_cd
          and d.is_pending
          and exists (
              select 1
              from app.aud_alocacao aa
              where aa.cd = d.cd
                and aa.coddv = d.coddv
          )
    ),
    candidate_rows as (
        select
            e.cd,
            e.coddv,
            coalesce(
                nullif(trim(coalesce(pul.descricao, '')), ''),
                format('CODDV %s', e.coddv)
            ) as descricao,
            upper(trim(pul.endereco)) as endereco,
            app.pvps_alocacao_normalize_zone(pul.endereco) as zona,
            nullif(trim(coalesce(pul.andar, '')), '') as nivel,
            app.pvps_alocacao_normalize_validade(pul.validade) as val_sist,
            greatest(coalesce(e.qtd_est_disp, 0), 0) as qtd_est_disp,
            e.dat_ult_compra,
            app.pvps_admin_priority_score(
                e.cd,
                'alocacao',
                app.pvps_alocacao_normalize_zone(pul.endereco),
                e.coddv,
                null
            ) as priority_score
        from app.db_estq_entr e
        join app.db_end pul
          on pul.cd = e.cd
         and pul.coddv = e.coddv
         and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where e.cd = p_cd
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
          and nullif(trim(coalesce(pul.validade, '')), '') is not null
          and not app.pvps_admin_is_item_blacklisted(
              e.cd,
              'alocacao',
              app.pvps_alocacao_normalize_zone(pul.endereco),
              e.coddv,
              null
          )
          and not exists (
              select 1
              from app.aud_alocacao aa
              where aa.cd = e.cd
                and aa.coddv = e.coddv
                and aa.endereco = upper(trim(pul.endereco))
          )
    ),
    candidate_products as (
        select
            c.cd,
            c.coddv,
            max(c.dat_ult_compra) as dat_ult_compra,
            max(c.qtd_est_disp) as qtd_est_disp,
            min(c.priority_score)::integer as priority_score
        from candidate_rows c
        group by c.cd, c.coddv
    ),
    ranked_products as (
        select
            cp.cd,
            cp.coddv,
            cp.dat_ult_compra,
            cp.qtd_est_disp,
            cp.priority_score,
            (cs.coddv is not null) as is_started
        from candidate_products cp
        left join current_started cs
          on cs.coddv = cp.coddv
    ),
    started_products as (
        select rp.coddv
        from ranked_products rp
        where rp.is_started
        order by rp.priority_score asc, rp.dat_ult_compra desc, rp.coddv
    ),
    fresh_products as (
        select rp.coddv
        from ranked_products rp
        where not rp.is_started
        order by rp.priority_score asc, rp.dat_ult_compra desc, rp.coddv
        limit greatest(v_limit - (select count(*) from started_products), 0)
    ),
    active_products as (
        select coddv from started_products
        union
        select coddv from fresh_products
    ),
    expanded as (
        select
            c.cd,
            c.zona,
            c.coddv,
            c.descricao,
            c.endereco,
            c.nivel,
            c.val_sist,
            c.qtd_est_disp,
            c.dat_ult_compra,
            exists (
                select 1
                from active_products ap
                where ap.coddv = c.coddv
            ) as is_window_active
        from candidate_rows c
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

create or replace function app.pvps_alocacao_refresh_window(
    p_cd integer,
    p_modulo text default 'ambos'
)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_modulo text;
begin
    v_modulo := lower(coalesce(p_modulo, 'ambos'));
    if v_modulo not in ('pvps', 'alocacao', 'ambos') then
        raise exception 'MODULO_INVALIDO';
    end if;

    perform app.pvps_admin_cleanup_grace(p_cd);

    if v_modulo in ('pvps', 'ambos') then
        perform app.pvps_reseed(p_cd);
    end if;
    if v_modulo in ('alocacao', 'ambos') then
        perform app.alocacao_reseed(p_cd);
    end if;
end;
$$;

create or replace function app.pvps_alocacao_replenish(p_cd integer, p_modulo text)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
begin
    perform app.pvps_alocacao_refresh_window(p_cd, p_modulo);
end;
$$;

drop function if exists public.rpc_pvps_manifest_items_page(integer, text, integer, integer);

create function public.rpc_pvps_manifest_items_page(
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
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_zona := upper(nullif(trim(coalesce(p_zona, '')), ''));
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 100), 1), 1000);

    perform app.pvps_alocacao_refresh_window(v_cd, 'pvps');

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
    pul_done as (
        select
            ap.cd,
            ap.coddv,
            ap.end_sep,
            count(*)::integer as pul_auditados
        from app.aud_pvps ap
        join app.aud_pvps_pul apu on apu.audit_id = ap.audit_id
        where ap.cd = v_cd
        group by ap.cd, ap.coddv, ap.end_sep
    )
    select
        b.cd,
        b.zona,
        b.coddv,
        b.descricao,
        b.end_sep,
        b.pul_total,
        coalesce(pd.pul_auditados, 0) as pul_auditados,
        coalesce(ap.status, 'pendente_sep') as status,
        ap.end_sit,
        ap.val_sep,
        ap.audit_id,
        b.dat_ult_compra,
        b.qtd_est_disp,
        b.priority_score,
        b.is_window_active
    from base b
    left join app.aud_pvps ap
      on ap.cd = b.cd and ap.coddv = b.coddv and ap.end_sep = b.end_sep
    left join pul_done pd
      on pd.cd = b.cd and pd.coddv = b.coddv and pd.end_sep = b.end_sep
    order by b.is_window_active desc, b.priority_score asc, b.dat_ult_compra desc, b.zona, b.end_sep, b.coddv
    offset v_offset
    limit v_limit;
end;
$$;

drop function if exists public.rpc_alocacao_manifest_items_page(integer, text, integer, integer);

create function public.rpc_alocacao_manifest_items_page(
    p_cd integer default null,
    p_zona text default null,
    p_offset integer default 0,
    p_limit integer default 200
)
returns table (
    queue_id uuid,
    cd integer,
    zona text,
    coddv integer,
    descricao text,
    endereco text,
    nivel text,
    val_sist text,
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
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_zona := upper(nullif(trim(coalesce(p_zona, '')), ''));
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 200), 1), 1000);

    perform app.pvps_alocacao_refresh_window(v_cd, 'alocacao');

    return query
    select
        d.queue_id,
        d.cd,
        d.zona,
        d.coddv,
        d.descricao,
        d.endereco,
        d.nivel,
        d.val_sist,
        d.dat_ult_compra,
        d.qtd_est_disp,
        app.pvps_admin_priority_score(v_cd, 'alocacao', d.zona, d.coddv, d.queue_id::text) as priority_score,
        d.is_window_active
    from app.db_alocacao d
    where d.cd = v_cd
      and d.is_pending
      and (v_zona is null or d.zona = v_zona)
      and not app.pvps_admin_is_item_blacklisted(v_cd, 'alocacao', d.zona, d.coddv, d.queue_id::text)
    order by d.is_window_active desc, priority_score asc, d.dat_ult_compra desc, d.zona, d.endereco, d.coddv
    offset v_offset
    limit v_limit;
end;
$$;

grant execute on function public.rpc_pvps_manifest_items_page(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_alocacao_manifest_items_page(integer, text, integer, integer) to authenticated;
