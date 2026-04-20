# Monitor DB_DEVOLUCAO - A cada 5 minutos

## 🎯 Objetivo
Manter DB_DEVOLUCAO sempre atualizado na aplicação, verificando a cada 5 minutos se há dados novos e sincronizando apenas essa tabela quando necessário.

## 🚀 Como usar

### 1. Iniciar o Monitor
```bat
INICIAR_MONITOR_DEVOLUCAO.bat
```

### 2. O que acontece automaticamente:
- ✅ Verifica DB_DEVOLUCAO a cada 5 minutos
- ✅ Se houver dados novos (arquivo modificado), atualiza as queries
- ✅ Sincroniza APENAS DB_DEVOLUCAO no Supabase
- ✅ Não interfere com o fluxo principal dos outros arquivos

### 3. Fluxos paralelos:
- **Monitor 5min:** DB_DEVOLUCAO (dedicado)
- **Automação 30min:** Todos os outros arquivos (fluxo normal)

## ⚙️ Configuração

### Frequências atualizadas:
- **5 minutos:** DB_DEVOLUCAO (monitor dedicado)
- **30 minutos:** DB_ENTRADA_NOTAS, DB_ATENDIMENTO
- **1 hora:** DB_TERMO, DB_PEDIDO_DIRETO, DB_ESTQ_ENTR, DB_BLITZ
- **6 horas:** BD_END
- **1x por dia:** DB_BARRAS, BD_AVULSO, BD_ROTAS, DB_LOG_END, DB_USUARIO, DB_PROD_VOL

## 📊 Vantagens

1. **DB_DEVOLUCAO sempre atualizado** - Máximo 5 minutos de atraso
2. **Eficiência máxima** - Só sincroniza quando há dados novos
3. **Não interfere** - Outros arquivos mantêm seu fluxo normal
4. **Baixo I/O** - Sincroniza apenas 1 tabela por vez
5. **Independente** - Funciona mesmo se automação principal estiver parada

## 🔧 Arquivos criados:
- `MONITOR_DEVOLUCAO_5MIN.bat` - Monitor principal
- `verificar_devolucao_rapido.vbs` - Verifica se há dados novos
- `atualizar_devolucao_rapido.vbs` - Atualiza apenas DB_DEVOLUCAO
- `INICIAR_MONITOR_DEVOLUCAO.bat` - Inicializador

## ⚠️ Importante:
- Execute o monitor em uma janela separada
- Mantenha a automação principal rodando normalmente
- Para parar, feche a janela do monitor ou pressione Ctrl+C
