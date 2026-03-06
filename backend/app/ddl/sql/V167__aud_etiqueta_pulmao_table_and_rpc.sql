create schema if not exists aud;

create table if not exists aud.etiqueta_pulmao (
    id uuid primary key default gen_random_uuid(),
    data_hr timestamptz not null default timezone('utc', now()),
    user_id uuid not null references auth.users(id) on delete restrict,
    usuario text not null,
    cd integer not null,
    codigo_interno integer not null,
    barra text not null,
    coddv_resolvido integer null,
    descricao text null,
    validado boolean not null default false,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_aud_etiqueta_pulmao_data_hr
    on aud.etiqueta_pulmao(data_hr desc);

create index if not exists idx_aud_etiqueta_pulmao_cd_data_hr
    on aud.etiqueta_pulmao(cd, data_hr desc);

create index if not exists idx_aud_etiqueta_pulmao_user_data_hr
    on aud.etiqueta_pulmao(user_id, data_hr desc);

create index if not exists idx_aud_etiqueta_pulmao_barra
    on aud.etiqueta_pulmao(barra);

create index if not exists idx_aud_etiqueta_pulmao_codigo_interno
    on aud.etiqueta_pulmao(codigo_interno);

create index if not exists idx_aud_etiqueta_pulmao_coddv_resolvido
    on aud.etiqueta_pulmao(coddv_resolvido);

alter table aud.etiqueta_pulmao enable row level security;

revoke all on schema aud from anon;
revoke all on schema aud from authenticated;
grant usage on schema aud to authenticated;

revoke all on aud.etiqueta_pulmao from anon;
revoke all on aud.etiqueta_pulmao from authenticated;

create or replace function public.rpc_aud_etiqueta_pulmao_insert(
    p_cd integer default null,
    p_codigo_interno integer default null,
    p_barras text default null,
    p_coddv_resolvido integer default null,
    p_descricao text default null,
    p_validado boolean default null,
    p_data_hr timestamptz default null
)
returns table (
    id uuid,
    data_hr timestamptz,
    user_id uuid,
    usuario text,
    cd integer,
    codigo_interno integer,
    barra text,
    coddv_resolvido integer,
    descricao text,
    validado boolean,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, aud, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
    v_usuario text;
    v_codigo_interno integer;
    v_barras text;
    v_coddv_resolvido integer;
    v_descricao text;
    v_validado boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    v_codigo_interno := coalesce(p_codigo_interno, 0);
    if v_codigo_interno <= 0 then
        raise exception 'CODIGO_INTERNO_INVALIDO';
    end if;

    v_barras := regexp_replace(coalesce(p_barras, ''), '\s+', '', 'g');
    if v_barras = '' then
        raise exception 'BARRAS_OBRIGATORIA';
    end if;

    v_coddv_resolvido := nullif(coalesce(p_coddv_resolvido, 0), 0);
    if v_coddv_resolvido is not null and v_coddv_resolvido < 0 then
        raise exception 'CODDV_RESOLVIDO_INVALIDO';
    end if;

    v_descricao := nullif(trim(coalesce(p_descricao, '')), '');
    v_validado := coalesce(p_validado, false);
    v_usuario := coalesce(
        nullif(trim(coalesce(v_profile.nome, '')), ''),
        nullif(trim(coalesce(v_profile.mat, '')), ''),
        v_uid::text
    );

    return query
    insert into aud.etiqueta_pulmao (
        data_hr,
        user_id,
        usuario,
        cd,
        codigo_interno,
        barra,
        coddv_resolvido,
        descricao,
        validado
    )
    values (
        coalesce(p_data_hr, timezone('utc', now())),
        v_uid,
        v_usuario,
        v_cd,
        v_codigo_interno,
        v_barras,
        v_coddv_resolvido,
        v_descricao,
        v_validado
    )
    returning
        etiqueta_pulmao.id,
        etiqueta_pulmao.data_hr,
        etiqueta_pulmao.user_id,
        etiqueta_pulmao.usuario,
        etiqueta_pulmao.cd,
        etiqueta_pulmao.codigo_interno,
        etiqueta_pulmao.barra,
        etiqueta_pulmao.coddv_resolvido,
        etiqueta_pulmao.descricao,
        etiqueta_pulmao.validado,
        etiqueta_pulmao.created_at;
end;
$$;

grant execute on function public.rpc_aud_etiqueta_pulmao_insert(integer, integer, text, integer, text, boolean, timestamptz) to authenticated;
