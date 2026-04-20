# Manual de Treinamento Operacional

- Pasta fonte do manual mestre de treinamento operacional.
- Os arquivos são lidos em ordem alfabética por pasta e consolidados em `docs/manual-treinamento-operacional.md`.
- O `.docx` final é gerado por `powershell -File scripts/build-training-doc.ps1`.

## Estrutura

- `00-frontmatter`: capa, objetivo, convenções e sumário.
- `01-geral`: instruções comuns de acesso, navegação e operação.
- `02-modulos`: uma seção por módulo ativo do menu atual.
- `03-anexos`: glossário, FAQ curto, erros comuns e checklist diário.

## Convenções editoriais

- `> [!ATENCAO]`: alerta operacional.
- `> [!DICA]`: atalho ou prática recomendada.
- `> [!REGRA]`: regra que o usuário precisa respeitar.
- `> [!ERRO]`: falha comum e ação imediata.
- `[INSERIR IMAGEM - ...]`: espaço reservado para captura de tela.

## Saídas

- `docs/manual-treinamento-operacional.md`
- `docs/manual-treinamento-operacional.docx`
