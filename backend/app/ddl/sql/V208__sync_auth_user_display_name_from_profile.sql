create or replace function authz.sync_auth_user_display_name(
    p_user_id uuid,
    p_nome text
)
returns void
language plpgsql
security definer
set search_path = authz, auth, public
as $$
declare
    v_nome text;
begin
    v_nome := nullif(trim(coalesce(p_nome, '')), '');

    if p_user_id is null or v_nome is null then
        return;
    end if;

    update auth.users u
    set
        raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
            || jsonb_build_object(
                'nome', v_nome,
                'name', v_nome,
                'full_name', v_nome,
                'display_name', v_nome
            ),
        updated_at = now()
    where u.id = p_user_id
      and u.deleted_at is null;

    update auth.identities i
    set
        identity_data = coalesce(i.identity_data, '{}'::jsonb)
            || jsonb_build_object(
                'name', v_nome,
                'full_name', v_nome,
                'display_name', v_nome
            ),
        updated_at = now()
    where i.user_id = p_user_id
      and i.provider = 'email';
end;
$$;

create or replace function authz.trg_sync_auth_user_display_name()
returns trigger
language plpgsql
security definer
set search_path = authz, auth, public
as $$
begin
    perform authz.sync_auth_user_display_name(new.user_id, new.nome);
    return new;
end;
$$;

drop trigger if exists trg_authz_profiles_sync_auth_user_display_name on authz.profiles;

create trigger trg_authz_profiles_sync_auth_user_display_name
after insert or update of nome on authz.profiles
for each row
execute function authz.trg_sync_auth_user_display_name();

do $$
declare
    rec record;
begin
    for rec in
        select p.user_id, p.nome
        from authz.profiles p
        join auth.users u
          on u.id = p.user_id
        where u.deleted_at is null
          and nullif(trim(coalesce(p.nome, '')), '') is not null
    loop
        perform authz.sync_auth_user_display_name(rec.user_id, rec.nome);
    end loop;
end
$$;

grant execute on function authz.sync_auth_user_display_name(uuid, text) to authenticated;
