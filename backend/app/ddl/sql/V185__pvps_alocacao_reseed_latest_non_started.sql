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
    recent_product_base as (
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
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
          and not exists (
              select 1
              from current_started cs
              where cs.coddv = e.coddv
          )
    ),
    recent_products as (
        select
            rb.cd,
            rb.coddv,
            rb.dat_ult_compra,
            rb.qtd_est_disp,
            coalesce(min(app.pvps_admin_priority_score(
                rb.cd,
                'pvps',
                app.pvps_alocacao_normalize_zone(sep.endereco),
                rb.coddv,
                null
            )), 9999)::integer as priority_score
        from recent_product_base rb
        left join app.db_end sep
          on sep.cd = rb.cd
         and sep.coddv = rb.coddv
         and upper(trim(coalesce(sep.tipo, ''))) = 'SEP'
        where rb.rn = 1
        group by rb.cd, rb.coddv, rb.dat_ult_compra, rb.qtd_est_disp
        order by priority_score asc, rb.dat_ult_compra desc, rb.coddv
        limit v_buffer
    ),
    active_recent_products as (
        select rp.coddv
        from recent_products rp
        order by rp.priority_score asc, rp.dat_ult_compra desc, rp.coddv
        limit greatest(v_limit - (select count(*) from current_started), 0)
    ),
    recent_rows as (
        select
            rp.cd,
            app.pvps_alocacao_normalize_zone(sep.endereco) as zona,
            rp.coddv,
            coalesce(
                nullif(trim(coalesce(sep.descricao, '')), ''),
                nullif(trim(coalesce(pul.descricao, '')), ''),
                format('CODDV %s', rp.coddv)
            ) as descricao,
            upper(trim(sep.endereco)) as end_sep,
            upper(trim(pul.endereco)) as end_pul,
            rp.qtd_est_disp,
            rp.dat_ult_compra,
            exists (
                select 1
                from active_recent_products arp
                where arp.coddv = rp.coddv
            ) as is_window_active
        from recent_products rp
        join app.db_end sep
          on sep.cd = rp.cd
         and sep.coddv = rp.coddv
         and upper(trim(coalesce(sep.tipo, ''))) = 'SEP'
        join app.db_end pul
          on pul.cd = rp.cd
         and pul.coddv = rp.coddv
         and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where not app.pvps_admin_is_item_blacklisted(
            rp.cd,
            'pvps',
            app.pvps_alocacao_normalize_zone(sep.endereco),
            rp.coddv,
            rp.coddv::text || '|' || upper(trim(sep.endereco))
        )
          and not exists (
              select 1
              from app.aud_pvps ap
              where ap.cd = rp.cd
                and ap.coddv = rp.coddv
                and ap.end_sep = upper(trim(sep.endereco))
                and ap.status in ('concluido', 'nao_conforme')
          )
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
    recent_product_base as (
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
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
          and not exists (
              select 1
              from current_started cs
              where cs.coddv = e.coddv
          )
    ),
    recent_products as (
        select
            rb.cd,
            rb.coddv,
            rb.dat_ult_compra,
            rb.qtd_est_disp,
            coalesce(min(app.pvps_admin_priority_score(
                rb.cd,
                'alocacao',
                app.pvps_alocacao_normalize_zone(pul.endereco),
                rb.coddv,
                null
            )), 9999)::integer as priority_score
        from recent_product_base rb
        left join app.db_end pul
          on pul.cd = rb.cd
         and pul.coddv = rb.coddv
         and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where rb.rn = 1
        group by rb.cd, rb.coddv, rb.dat_ult_compra, rb.qtd_est_disp
        order by priority_score asc, rb.dat_ult_compra desc, rb.coddv
        limit v_buffer
    ),
    active_recent_products as (
        select rp.coddv
        from recent_products rp
        order by rp.priority_score asc, rp.dat_ult_compra desc, rp.coddv
        limit greatest(v_limit - (select count(*) from current_started), 0)
    ),
    recent_rows as (
        select
            rp.cd,
            app.pvps_alocacao_normalize_zone(pul.endereco) as zona,
            rp.coddv,
            coalesce(
                nullif(trim(coalesce(pul.descricao, '')), ''),
                format('CODDV %s', rp.coddv)
            ) as descricao,
            upper(trim(pul.endereco)) as endereco,
            nullif(trim(coalesce(pul.andar, '')), '') as nivel,
            app.pvps_alocacao_normalize_validade(pul.validade) as val_sist,
            rp.qtd_est_disp,
            rp.dat_ult_compra,
            exists (
                select 1
                from active_recent_products arp
                where arp.coddv = rp.coddv
            ) as is_window_active
        from recent_products rp
        join app.db_end pul
          on pul.cd = rp.cd
         and pul.coddv = rp.coddv
         and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where nullif(trim(coalesce(pul.validade, '')), '') is not null
          and not app.pvps_admin_is_item_blacklisted(
              rp.cd,
              'alocacao',
              app.pvps_alocacao_normalize_zone(pul.endereco),
              rp.coddv,
              null
          )
          and not exists (
              select 1
              from app.aud_alocacao aa
              where aa.cd = rp.cd
                and aa.coddv = rp.coddv
                and aa.endereco = upper(trim(pul.endereco))
          )
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
