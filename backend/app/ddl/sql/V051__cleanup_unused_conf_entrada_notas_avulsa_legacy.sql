-- Limpeza do legado da avulsa antiga (pré resolução por Seq/NF via targets).
-- No modelo atual (V050+), os itens conferidos da avulsa são persistidos em
-- app.conf_entrada_notas_itens (por target_conf_id), tornando estas estruturas obsoletas.

drop function if exists public.rpc_conf_entrada_notas_avulsa_sync_snapshot(uuid, jsonb);
drop function if exists public.rpc_conf_entrada_notas_avulsa_reset_item(uuid, integer);
drop function if exists public.rpc_conf_entrada_notas_avulsa_set_item_qtd(uuid, integer, integer);

drop function if exists app.conf_entrada_notas_avulsa_itens_sync_conferidos();

drop table if exists app.conf_entrada_notas_avulsa_itens_conferidos;
drop table if exists app.conf_entrada_notas_avulsa_itens;
