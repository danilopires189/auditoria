create table if not exists authz.profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    nome text,
    mat text,
    role text not null check (role in ('admin', 'auditor', 'viewer')),
    cd_default integer,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists authz.user_deposits (
    user_id uuid not null references auth.users(id) on delete cascade,
    cd integer not null,
    created_at timestamptz not null default timezone('utc', now()),
    primary key (user_id, cd)
);

create index if not exists idx_authz_profiles_role on authz.profiles(role);
create index if not exists idx_authz_user_deposits_user_cd on authz.user_deposits(user_id, cd);
create index if not exists idx_authz_user_deposits_cd_user on authz.user_deposits(cd, user_id);