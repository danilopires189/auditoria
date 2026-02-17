alter table app.conf_entrada_notas_avulsa
    drop constraint if exists uq_conf_entrada_notas_avulsa_daily;

create unique index if not exists uq_conf_entrada_notas_avulsa_daily_open
    on app.conf_entrada_notas_avulsa(conf_date, cd, kind)
    where status = 'em_conferencia';

create or replace function public.rpc_conf_entrada_notas_avulsa_open(
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    transportadora text,
    fornecedor text,
    status text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_today date;
    v_profile record;
    v_conf app.conf_entrada_notas_avulsa%rowtype;
    v_user_active app.conf_entrada_notas_avulsa%rowtype;
    v_read_only boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_entrada_notas_avulsa_autoclose_stale();

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    select *
    into v_user_active
    from app.conf_entrada_notas_avulsa c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and v_user_active.cd <> v_cd then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_ENTRADA';
    end if;

    if not exists (
        select 1
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.coddv is not null
    ) then
        raise exception 'BASE_ENTRADA_NOTAS_VAZIA';
    end if;

    select *
    into v_conf
    from app.conf_entrada_notas_avulsa c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.kind = 'avulsa'
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if found then
        if v_conf.started_by <> v_uid then
            raise exception 'CONFERENCIA_AVULSA_EM_USO';
        end if;
        v_read_only := false;
    else
        insert into app.conf_entrada_notas_avulsa (
            conf_date,
            cd,
            kind,
            transportadora,
            fornecedor,
            started_by,
            started_mat,
            started_nome,
            status,
            started_at,
            finalized_at,
            updated_at
        )
        values (
            v_today,
            v_cd,
            'avulsa',
            'CONFERENCIA AVULSA',
            'GERAL',
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            now(),
            null,
            now()
        )
        returning * into v_conf;

        v_read_only := false;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.transportadora,
        c.fornecedor,
        c.status,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_entrada_notas_avulsa c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

grant execute on function public.rpc_conf_entrada_notas_avulsa_open(integer) to authenticated;
