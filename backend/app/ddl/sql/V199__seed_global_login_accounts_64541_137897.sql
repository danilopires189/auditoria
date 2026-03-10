insert into authz.global_login_accounts (login_email, mat, nome, active)
values
    ('64541@pmenos.com.br', '64541', 'ANDRE LUIZ OLIVEIRA MORAIS', true),
    ('mat_64541@login.auditoria.local', '64541', 'ANDRE LUIZ OLIVEIRA MORAIS', true),
    ('137897@pmenos.com.br', '137897', 'CAIO CESAR FERNANDES LOPES', true),
    ('mat_137897@login.auditoria.local', '137897', 'CAIO CESAR FERNANDES LOPES', true)
on conflict (login_email) do update
set
    mat = excluded.mat,
    nome = excluded.nome,
    active = excluded.active;

do $$
begin
    perform authz.ensure_profile_from_mat('64541');
    perform authz.ensure_profile_from_mat('137897');
end
$$;
