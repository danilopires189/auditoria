insert into authz.global_login_accounts (login_email, mat, nome, active)
values (
    '99175@pmenos.com.br',
    '99175',
    'SINEONE DOS ANJOS SANTANA',
    true
)
on conflict (login_email) do update
set
    mat = excluded.mat,
    nome = excluded.nome,
    active = excluded.active;

do $$
begin
    perform authz.ensure_profile_from_mat('99175');
end
$$;
