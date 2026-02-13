grant usage on schema app to authenticated;
grant usage on schema authz to authenticated;

revoke all on all tables in schema app from anon;
revoke all on all tables in schema app from authenticated;
grant select on all tables in schema app to authenticated;

select app.apply_runtime_security('db_entrada_notas');
select app.apply_runtime_security('db_avulso');
select app.apply_runtime_security('db_usuario');
select app.apply_runtime_security('db_barras');
select app.apply_runtime_security('db_devolucao');
select app.apply_runtime_security('db_pedido_direto');
select app.apply_runtime_security('db_termo');