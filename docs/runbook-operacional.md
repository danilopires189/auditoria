# Runbook Operacional

## Objetivo

Este runbook organiza a operacao diaria do backend de sincronizacao e os checkpoints minimos para sustentar o ambiente com previsibilidade.

## Arquivos e pastas importantes

- `backend/config.yml`: cadastro das tabelas, arquivos e tipos
- `backend/automation_config.json`: janela, intervalo e nome da tarefa
- `backend/data/`: arquivos de origem
- `backend/logs/`: logs operacionais
- `backend/logs/rejections/`: exportacoes de rejeicao

## Rotina recomendada

### Inicio de operacao ou troca de maquina

1. validar `backend/.env`
2. executar `bootstrap`
3. executar `healthcheck`
4. executar `validate`
5. executar `sync`

### Operacao manual

```powershell
py -3 backend\main.py sync --config backend\config.yml --env-file backend\.env
```

### Validacao sem promocao

```powershell
py -3 backend\main.py dry-run --config backend\config.yml --env-file backend\.env
```

### Processar tabelas especificas

```powershell
py -3 backend\main.py sync --config backend\config.yml --env-file backend\.env --table db_barras --table db_usuario
```

### Forcar tabela mesmo sem mudanca detectada

```powershell
py -3 backend\main.py sync --config backend\config.yml --env-file backend\.env --force-table db_barras
```

## Automacao agendada

### Instalar ou atualizar a tarefa

```powershell
py -3 backend\main.py automation-task install --config backend\config.yml --env-file backend\.env --automation-config backend\automation_config.json
```

### Consultar status

```powershell
py -3 backend\main.py automation-task status --config backend\config.yml --env-file backend\.env --automation-config backend\automation_config.json
```

### Rodar imediatamente

```powershell
py -3 backend\main.py automation-task run-now --config backend\config.yml --env-file backend\.env --automation-config backend\automation_config.json
```

### Remover a tarefa

```powershell
py -3 backend\main.py automation-task remove --config backend\config.yml --env-file backend\.env --automation-config backend\automation_config.json
```

## Politica operacional

O arquivo `backend/automation_config.json` controla:

- `automation_enabled`
- `interval_minutes`
- `window_start`
- `window_end`
- `timezone`
- `exclude_sunday`
- `task_name`

Use a mesma fonte para mudar politica de horario, em vez de editar scripts `.bat` manualmente.

## Quando usar cada comando

- `bootstrap`: primeira subida, mudanca de schema ou nova maquina
- `healthcheck`: diagnostico de conectividade
- `refresh`: atualizar planilhas que dependem de Excel/consulta externa
- `validate`: diagnostico estrutural antes de promover
- `sync`: carga real
- `dry-run`: simulacao segura
- `automation-cycle`: execucao orquestrada com regras de janela e reprocessamento
- `gui`: operacao assistida por interface Tkinter

## Evidencias operacionais

A cada execucao observe:

- codigo de retorno do comando
- `run_id` informado na saida
- pasta `backend/logs/`
- pasta `backend/logs/rejections/`

Quando houver falha parcial:

1. registre o `run_id`;
2. identifique as tabelas com erro;
3. corrija origem, schema ou conectividade;
4. reexecute com `--table` ou `--reprocess-failures`.

## Rotina de suporte para o frontend

Em caso de reclamacao de usuarios:

1. validar se o frontend esta online;
2. validar o modo manutencao;
3. validar se o backend sincronizou as bases envolvidas;
4. conferir se o usuario tem perfil/CD corretos;
5. validar RPCs e RLS no Supabase quando o problema for de acesso.

## Mudancas com impacto de operacao

Antes de publicar alteracoes em producao, confirme:

- migracoes novas aplicadas com `bootstrap`
- novas variaveis de ambiente documentadas
- novos arquivos de origem registrados em `config.yml`
- novos acessos de rede informados para TI, quando houver
- documentacao atualizada no `README` e em `docs/`
