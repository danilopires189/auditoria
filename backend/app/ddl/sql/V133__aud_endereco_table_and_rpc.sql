create schema if not exists aud;

create table if not exists aud.endereco (
    id uuid primary key default gen_random_uuid(),
    data_hr timestamptz not null default timezone('utc', now()),
    user_id uuid not null references auth.users(id) on delete restrict,
    usuario text not null,
    cd integer not null,
    barra text not null,
    coddv integer not null,
    descricao text not null,
    end_infor text not null,
    end_corret text not null,
    validado boolean not null default false,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_aud_endereco_data_hr
    on aud.endereco(data_hr desc);

create index if not exists idx_aud_endereco_cd_data_hr
    on aud.endereco(cd, data_hr desc);

create index if not exists idx_aud_endereco_user_data_hr
    on aud.endereco(user_id, data_hr desc);

create index if not exists idx_aud_endereco_barra
    on aud.endereco(barra);

create index if not exists idx_aud_endereco_coddv
    on aud.endereco(coddv);

alter table aud.endereco enable row level security;

revoke all on schema aud from anon;
revoke all on schema aud from authenticated;
grant usage on schema aud to authenticated;

revoke all on aud.endereco from anon;
revoke all on aud.endereco from authenticated;

create or replace function public.rpc_aud_endereco_insert(
    p_cd integer default null,
    p_barras text default null,
    p_coddv integer default null,
    p_descricao text default null,
    p_end_infor text default null,
    p_end_corret text default null,
    p_validado boolean default null,
    p_data_hr timestamptz default null
)
returns table (
    id uuid,
    data_hr timestamptz,
    user_id uuid,
    usuario text,
    cd integer,
    barra text,
    coddv integer,
    descricao text,
    end_infor text,
    end_corret text,
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
    v_barras text;
    v_coddv integer;
    v_descricao text;
    v_end_infor text;
    v_end_corret text;
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

    v_barras := regexp_replace(coalesce(p_barras, ''), '\s+', '', 'g');
    if v_barras = '' then
        raise exception 'BARRAS_OBRIGATORIA';
    end if;

    v_coddv := coalesce(p_coddv, 0);
    if v_coddv <= 0 then
        raise exception 'CODDV_INVALIDO';
    end if;

    v_descricao := coalesce(
        nullif(trim(coalesce(p_descricao, '')), ''),
        format('CODDV %s', v_coddv)
    );

    v_end_infor := upper(trim(coalesce(p_end_infor, '')));
    if v_end_infor = '' then
        raise exception 'ENDERECO_INFORMADO_OBRIGATORIO';
    end if;

    v_end_corret := upper(trim(coalesce(p_end_corret, '')));
    if v_end_corret = '' then
        raise exception 'ENDERECO_CORRETO_OBRIGATORIO';
    end if;

    v_validado := coalesce(p_validado, false);
    v_usuario := coalesce(
        nullif(trim(coalesce(v_profile.nome, '')), ''),
        nullif(trim(coalesce(v_profile.mat, '')), ''),
        v_uid::text
    );

    return query
    insert into aud.endereco (
        data_hr,
        user_id,
        usuario,
        cd,
        barra,
        coddv,
        descricao,
        end_infor,
        end_corret,
        validado
    )
    values (
        coalesce(p_data_hr, timezone('utc', now())),
        v_uid,
        v_usuario,
        v_cd,
        v_barras,
        v_coddv,
        v_descricao,
        v_end_infor,
        v_end_corret,
        v_validado
    )
    returning
        endereco.id,
        endereco.data_hr,
        endereco.user_id,
        endereco.usuario,
        endereco.cd,
        endereco.barra,
        endereco.coddv,
        endereco.descricao,
        endereco.end_infor,
        endereco.end_corret,
        endereco.validado,
        endereco.created_at;
end;
$$;

grant execute on function public.rpc_aud_endereco_insert(integer, text, integer, text, text, text, boolean, timestamptz) to authenticated;
