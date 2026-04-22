# Monitor DB_DEVOLUCAO - Detecção em 1 minuto

## 🎯 Objetivo
Manter DB_DEVOLUCAO sempre atualizado na aplicação, verificando a cada 1 minuto se há dados novos e sincronizando apenas essa tabela quando necessário.

## 🚀 Como usar

### 1. Iniciar o Monitor
```bat
INICIAR_MONITOR_DEVOLUCAO.bat
```

### 2. O que acontece automaticamente:
- ✅ Verifica DB_DEVOLUCAO a cada 1 minuto
- ✅ Se houver dados novos (arquivo modificado), atualiza as queries
- ✅ Sincroniza APENAS DB_DEVOLUCAO no Supabase
- ✅ Não interfere com o fluxo principal dos outros arquivos
- ✅ Reprocessa automaticamente se o sync falhar

### 3. Fluxos paralelos:
- **Monitor 1min:** DB_DEVOLUCAO (dedicado)
- **Automação 30min:** Todos os outros arquivos (fluxo normal)

## ⚙️ Configuração

### Frequências atualizadas:
- **1 minuto:** DB_DEVOLUCAO (monitor dedicado, durante horário ativo)
- **30 minutos:** DB_ENTRADA_NOTAS, DB_ATENDIMENTO
- **1 hora:** DB_TERMO, DB_PEDIDO_DIRETO, DB_PROD_VOL, DB_ESTQ_ENTR, DB_BLITZ
- **6 horas:** BD_END
- **1x por dia:** DB_BARRAS, BD_AVULSO, BD_ROTAS, DB_LOG_END, DB_USUARIO

## 📊 Vantagens

1. **DB_DEVOLUCAO sempre atualizado** - Máximo 1 minuto de atraso no horário ativo
2. **Eficiência máxima** - Só sincroniza quando há dados novos
3. **Não interfere** - Outros arquivos mantêm seu fluxo normal
4. **Baixo I/O** - Sincroniza apenas 1 tabela por vez
5. **Independente** - Funciona mesmo se automação principal estiver parada
6. **Sem perda de evento** - Só marca como processado depois do sync concluído

## 🔧 Arquivos criados:
- `MONITOR_DEVOLUCAO_5MIN.bat` - Monitor principal
- `verificar_devolucao_rapido.vbs` - Verifica se há dados novos
- `atualizar_devolucao_rapido.vbs` - Atualiza apenas DB_DEVOLUCAO
- `INICIAR_MONITOR_DEVOLUCAO.bat` - Inicializador
- `db_devolucao_last_sync.txt` - Estado local da última sincronização concluída

## ⚠️ Importante:
- Execute o monitor em uma janela separada
- Mantenha a automação principal rodando normalmente
- Para parar, feche a janela do monitor ou pressione Ctrl+C
- Fora do horário comercial, o monitor fica em standby e verifica a cada 5 minutos
