# Opções de Configuração DB_END

## 🎯 Problema Resolvido
O erro `there is no unique or exclusion constraint matching the ON CONFLICT specification` ocorre quando tentamos usar `upsert` com uma chave única que não existe no banco.

## ✅ Solução Atual (Recomendada)
**Configuração ativa:** `mode: "full_replace"`

### Vantagens:
- ✅ **Funciona sempre** - não depende de constraints no banco
- ✅ **Espelho perfeito** - banco fica exatamente igual ao Excel
- ✅ **Remove duplicatas** - dados antigos são automaticamente removidos
- ✅ **Performance boa** - ~600k registros em 2 minutos

### Como funciona:
1. Remove todos os registros da tabela
2. Insere todos os dados do Excel
3. Resultado: banco = Excel (sem dados antigos)

## 🔧 Outras Opções Disponíveis

### Opção 1: Upsert com Chave Simples
```yaml
mode: "upsert"
unique_keys: ["cd", "coddv", "endereco", "tipo"]
```
- ⚠️ **Requer** constraint no banco
- ✅ Mais eficiente para atualizações parciais
- ❌ Pode deixar dados antigos

### Opção 2: Upsert com Chave Completa
```yaml
mode: "upsert" 
unique_keys: ["cd", "coddv", "endereco", "andar", "validade", "tipo"]
```
- ⚠️ **Requer** constraint no banco com todas as colunas
- ✅ Máxima granularidade
- ❌ Constraint complexa

### Opção 3: Full Replace (Atual)
```yaml
mode: "full_replace"
unique_keys: []
```
- ✅ **Não requer** constraints
- ✅ Sempre funciona
- ✅ Dados sempre atualizados

## 🛠️ Scripts Disponíveis

### Verificação:
- `scripts/verificar_constraints_banco.py` - Verifica constraints no banco
- `scripts/check_duplicatas_excel.py` - Verifica duplicatas no Excel
- `scripts/check_endereco_completo.py` - Compara Excel vs Banco

### Limpeza:
- `scripts/limpar_duplicatas_bd_end.py` - Remove duplicatas do Excel
- `AUTOMACAO_COM_LIMPEZA.bat` - Automação com limpeza integrada

## 📋 Recomendação Final

**Use `full_replace`** (configuração atual) porque:
1. Sempre funciona independente do banco
2. Garante dados atualizados
3. Remove duplicatas automaticamente
4. Performance adequada para o volume de dados

Se precisar de `upsert` no futuro, será necessário criar as constraints no banco Supabase primeiro.