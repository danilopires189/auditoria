create or replace function app.pvps_reseed(p_cd integer)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_limit integer := app.pvps_alocacao_window_limit();
    v_buffer integer := app.pvps_alocacao_candidate_buffer_limit();
begin
    with current_started as (
        select distinct d.coddv
        from app.db_pvps d
        where d.cd = p_cd
          and d.is_pending
          and d.is_window_active
          and exists (
              select 1
              from app.aud_pvps ap
              where ap.cd = d.cd
                and ap.coddv = d.coddv
          )
    ),
    started_products as (
        select
            e.cd,
            e.coddv,
            e.dat_ult_compra,
            greatest(coalesce(e.qtd_est_disp, 0), 0) as qtd_est_disp,
            coalesce(min(app.pvps_admin_priority_score(
                e.cd,
                'pvps',
                app.pvps_alocacao_normalize_zone(sep.endereco),
                e.coddv,
                null
            )), 9999)::integer as priority_score
        from app.db_estq_entr e
        join current_started cs
          on cs.coddv = e.coddv
        left join app.db_end sep
          on sep.cd = e.cd
         and sep.coddv = e.coddv
         and upper(trim(coalesce(sep.tipo, ''))) = 'SEP'
        where e.cd = p_cd
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
        group by e.cd, e.coddv, e.dat_ult_compra, e.qtd_est_disp
    ),
    recent_products as (
        select
            e.cd,
            e.coddv,
            e.dat_ult_compra,
            greatest(coalesce(e.qtd_est_disp, 0), 0) as qtd_est_disp,
            coalesce(min(app.pvps_admin_priority_score(
                e.cd,
                'pvps',
                app.pvps_alocacao_normalize_zone(sep.endereco),
                e.coddv,
                null
            )), 9999)::integer as priority_score
        from app.db_estq_entr e
        left join app.db_end sep
          on sep.cd = e.cd
         and sep.coddv = e.coddv
         and upper(trim(coalesce(sep.tipo, ''))) = 'SEP'
        where e.cd = p_cd
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
          and not exists (
              select 1
              from current_started cs
              where cs.coddv = e.coddv
          )
        group by e.cd, e.coddv, e.dat_ult_compra, e.qtd_est_disp
        order by priority_score asc, e.dat_ult_compra desc, e.coddv
        limit v_buffer
    ),
    source_products as (
        select *, true as is_started from started_products
        union all
        select *, false as is_started from recent_products
    ),
    candidate_rows as (
        select
            sp.cd,
            sp.coddv,
            coalesce(
                nullif(trim(coalesce(sep.descricao, '')), ''),
                nullif(trim(coalesce(pul.descricao, '')), ''),
                format('CODDV %s', sp.coddv)
            ) as descricao,
            upper(trim(sep.endereco)) as end_sep,
            upper(trim(pul.endereco)) as end_pul,
            app.pvps_alocacao_normalize_zone(sep.endereco) as zona,
            sp.qtd_est_disp,
            sp.dat_ult_compra,
            sp.priority_score
        from source_products sp
        join app.db_end sep
          on sep.cd = sp.cd
         and sep.coddv = sp.coddv
         and upper(trim(coalesce(sep.tipo, ''))) = 'SEP'
        join app.db_end pul
          on pul.cd = sp.cd
         and pul.coddv = sp.coddv
         and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where not app.pvps_admin_is_item_blacklisted(
            sp.cd,
            'pvps',
            app.pvps_alocacao_normalize_zone(sep.endereco),
            sp.coddv,
            sp.coddv::text || '|' || upper(trim(sep.endereco))
        )
          and not exists (
              select 1
              from app.aud_pvps ap
              where ap.cd = sp.cd
                and ap.coddv = sp.coddv
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
            min(c.priority_score)::integer as priority_score,
            bool_or(sp.is_started) as is_started
        from candidate_rows c
        join source_products sp
          on sp.cd = c.cd
         and sp.coddv = c.coddv
        group by c.cd, c.coddv
    ),
    active_products as (
        with pinned as (
            select cp.coddv
            from candidate_products cp
            where cp.is_started
            order by cp.priority_score asc, cp.dat_ult_compra desc, cp.coddv
        ),
        fresh as (
            select cp.coddv
            from candidate_products cp
            where not cp.is_started
            order by cp.priority_score asc, cp.dat_ult_compra desc, cp.coddv
            limit greatest(v_limit - (select count(*) from pinned), 0)
        )
        select coddv from pinned
        union
        select coddv from fresh
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
    v_buffer integer := app.pvps_alocacao_candidate_buffer_limit();
begin
    with current_started as (
        select distinct d.coddv
        from app.db_alocacao d
        where d.cd = p_cd
          and d.is_pending
          and d.is_window_active
          and exists (
              select 1
              from app.aud_alocacao aa
              where aa.cd = d.cd
                and aa.coddv = d.coddv
          )
    ),
    started_products as (
        select
            e.cd,
            e.coddv,
            e.dat_ult_compra,
            greatest(coalesce(e.qtd_est_disp, 0), 0) as qtd_est_disp,
            coalesce(min(app.pvps_admin_priority_score(
                e.cd,
                'alocacao',
                app.pvps_alocacao_normalize_zone(pul.endereco),
                e.coddv,
                null
            )), 9999)::integer as priority_score
        from app.db_estq_entr e
        join current_started cs
          on cs.coddv = e.coddv
        left join app.db_end pul
          on pul.cd = e.cd
         and pul.coddv = e.coddv
         and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where e.cd = p_cd
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
        group by e.cd, e.coddv, e.dat_ult_compra, e.qtd_est_disp
    ),
    recent_products as (
        select
            e.cd,
            e.coddv,
            e.dat_ult_compra,
            greatest(coalesce(e.qtd_est_disp, 0), 0) as qtd_est_disp,
            coalesce(min(app.pvps_admin_priority_score(
                e.cd,
                'alocacao',
                app.pvps_alocacao_normalize_zone(pul.endereco),
                e.coddv,
                null
            )), 9999)::integer as priority_score
        from app.db_estq_entr e
        left join app.db_end pul
          on pul.cd = e.cd
         and pul.coddv = e.coddv
         and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where e.cd = p_cd
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
          and not exists (
              select 1
              from current_started cs
              where cs.coddv = e.coddv
          )
        group by e.cd, e.coddv, e.dat_ult_compra, e.qtd_est_disp
        order by priority_score asc, e.dat_ult_compra desc, e.coddv
        limit v_buffer
    ),
    source_products as (
        select *, true as is_started from started_products
        union all
        select *, false as is_started from recent_products
    ),
    candidate_rows as (
        select
            sp.cd,
            sp.coddv,
            coalesce(
                nullif(trim(coalesce(pul.descricao, '')), ''),
                format('CODDV %s', sp.coddv)
            ) as descricao,
            upper(trim(pul.endereco)) as endereco,
            app.pvps_alocacao_normalize_zone(pul.endereco) as zona,
            nullif(trim(coalesce(pul.andar, '')), '') as nivel,
            app.pvps_alocacao_normalize_validade(pul.validade) as val_sist,
            sp.qtd_est_disp,
            sp.dat_ult_compra,
            sp.priority_score
        from source_products sp
        join app.db_end pul
          on pul.cd = sp.cd
         and pul.coddv = sp.coddv
         and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where nullif(trim(coalesce(pul.validade, '')), '') is not null
          and not app.pvps_admin_is_item_blacklisted(
              sp.cd,
              'alocacao',
              app.pvps_alocacao_normalize_zone(pul.endereco),
              sp.coddv,
              null
          )
          and not exists (
              select 1
              from app.aud_alocacao aa
              where aa.cd = sp.cd
                and aa.coddv = sp.coddv
                and aa.endereco = upper(trim(pul.endereco))
          )
    ),
    candidate_products as (
        select
            c.cd,
            c.coddv,
            max(c.dat_ult_compra) as dat_ult_compra,
            max(c.qtd_est_disp) as qtd_est_disp,
            min(c.priority_score)::integer as priority_score,
            bool_or(sp.is_started) as is_started
        from candidate_rows c
        join source_products sp
          on sp.cd = c.cd
         and sp.coddv = c.coddv
        group by c.cd, c.coddv
    ),
    active_products as (
        with pinned as (
            select cp.coddv
            from candidate_products cp
            where cp.is_started
            order by cp.priority_score asc, cp.dat_ult_compra desc, cp.coddv
        ),
        fresh as (
            select cp.coddv
            from candidate_products cp
            where not cp.is_started
            order by cp.priority_score asc, cp.dat_ult_compra desc, cp.coddv
            limit greatest(v_limit - (select count(*) from pinned), 0)
        )
        select coddv from pinned
        union
        select coddv from fresh
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
