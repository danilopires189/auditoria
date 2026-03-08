create or replace function app.pvps_alocacao_compact_queue(
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

    if v_modulo in ('pvps', 'ambos') then
        delete from app.db_pvps d
        where d.cd = p_cd
          and not d.is_pending;
    end if;

    if v_modulo in ('alocacao', 'ambos') then
        delete from app.db_alocacao d
        where d.cd = p_cd
          and not d.is_pending
          and not exists (
              select 1
              from app.aud_alocacao aa
              where aa.queue_id = d.queue_id
          );
    end if;
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

    perform app.pvps_alocacao_compact_queue(p_cd, v_modulo);
end;
$$;
