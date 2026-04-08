# Otimizações Aplicadas para Reduzir I/O no Supabase

## 📊 Resumo das Mudanças

### 1. Frequência de Execução
- **ANTES:** A cada 20 minutos
- **DEPOIS:** A cada 30 minutos
- **Redução:** 25% menos execuções por dia (72 → 48 execuções)

### 2. Modo de Sincronização das Tabelas
Mudança de `full_replace` para `upsert` nas seguintes tabelas:

#### ✅ Tabelas Otimizadas:
- `db_devolucao`: 18.743 linhas → só atualiza o que mudou  
- `db_pedido_direto`: só atualiza o que mudou
- `db_rotas`: só atualiza o que mudou
- `db_termo`: só atualiza o que mudou
- `db_estq_entr`: só atualiza o que mudou
- `db_prod_blitz`: só atualiza o que mudou
- `db_prod_vol`: só atualiza o que mudou
- `db_end`: já estava otimizada

### 3. Frequência por Arquivo
- **DB_ENTRADA_NOTAS:** a cada 30 minutos em `full_replace`
- **DB_ATENDIMENTO:** a cada 30 minutos em `full_replace`
- **DB_DEVOLUCAO:** monitor dedicado

### 4. Lógica "1x por Dia" Melhorada
- **ANTES:** Verifica se passaram 24 horas desde a última atualização
- **DEPOIS:** Verifica se já atualizou hoje (data atual)
- **Benefício:** Mais intuitivo e previsível

**Tabelas com frequência "1x por dia":**
- DB_BARRAS, BD_AVULSO, BD_ROTAS, DB_LOG_END, DB_USUARIO, DB_PROD_VOL

### 5. Configurações do Sistema
- **Pool de conexões:** 5 → 3 (menos conexões simultâneas)
- **Timeout:** 3600s → 1800s (libera conexões mais rápido)
- **Log level:** INFO → WARNING (menos logs)
- **Modo padrão:** full_replace → upsert

## 📈 Impacto Esperado

### Redução de I/O Estimada:
- **Frequência:** 25% menos execuções
- **Modo upsert:** 70-90% menos operações por tabela
- **Total estimado:** 80-85% de redução no I/O

### Antes das Otimizações (por dia):
- 72 execuções × 31.544 linhas (ENTRADA+DEVOLUCAO) = ~2.3M operações
- Mais outras tabelas em full_replace

### Depois das Otimizações (por dia):
- 48 execuções × apenas registros alterados = ~200-300K operações
- Redução de aproximadamente 85% no I/O

## ⚠️ Pontos de Atenção

1. **Teste as chaves únicas:** Verifique se não há duplicatas após a primeira sincronização
2. **Monitore o Supabase:** Acompanhe o uso de I/O nas próximas horas
3. **Backup:** Mantenha backup dos dados antes de aplicar

## 🔧 Observação Atual

`DB_ENTRADA_NOTAS` e `DB_ATENDIMENTO` foram padronizados para `full_replace` a cada 30 minutos para manter banco e planilha sempre espelhados.

## 🔧 Como Reverter (se necessário)

Se houver problemas, altere no `config.yml`:
```yaml
mode: "full_replace"  # em vez de "upsert"
```

E no `verificar_frequencia.vbs`, volte para:
```vb
WScript.Quit 0  ' para SEMPRE atualizar
```
