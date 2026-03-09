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
              and coalesce(e.qtd_est_disp, 0) > 100
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
              and coalesce(e.qtd_est_disp, 0) > 100
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
