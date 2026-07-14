# Anexos de foto por processo — Subsistema B (export mensal + limpeza) — Design

**Feature #1 do roadmap.** Segundo subsistema, implementado **após** o A
(`2026-07-14-anexos-fotos-processo-A-design.md`). Os dois vão para produção
**juntos** para o pessoal usar. Este documento registra as decisões já
tomadas no brainstorm; será a base do ciclo spec→plano→execução do B.

## Objetivo

Exportar todas as fotos de um mês num arquivo `.ZIP` com os arquivos
**renomeados** (para arquivar num Google Drive manualmente) e, em passo
separado, **limpar** essas fotos do Storage (que é buffer temporário).

## Decisões (aprovadas)

1. **Agrupamento por mês:** pela **data de chegada** do processo
   (`data_chegada`), mesma lógica dos accordions da lista. Processos sem data
   entram num grupo "sem-data".
2. **Export:** botão **"Exportar ZIP"** por mês → baixa um `.zip` com todas as
   fotos daquele mês, já renomeadas. ZIP montado no **servidor** (lib `jszip`,
   dependência nova).
3. **Rename dos arquivos no ZIP:** `{pedido}-{item}-p{numero}-{i}.{ext}`, onde
   `pedido` = `numero_pedido`, `item` = `codigo_material`, `numero` = número do
   processo, `i` = índice da foto no processo (1..3). Robustez obrigatória:
   - **Sanitizar** `pedido`/`item`: remover acentos e trocar caracteres
     inválidos de nome de arquivo (`/ \ : * ? " < > |`, espaços) por `-`.
   - **Fallback** quando `pedido` ou `item` estiver vazio: usar `p{numero}`
     naquela posição (nunca gerar nome quebrado como `-COD.jpg`).
   - **Unicidade** garantida pelo `p{numero}` (número do processo é único) +
     índice — dois processos com mesmo pedido+item nunca colidem no ZIP.
   - Exemplo: pedido `1234`, item `COD123`, processo #57, 2ª foto →
     `1234-COD123-p57-2.jpg`.
4. **Limpeza:** botão **separado** **"Limpar fotos do mês"**, com
   **confirmação**, gate `administrar`. Remove os objetos do Storage **e** as
   linhas de `anexos_processo` daquele mês. Nunca acoplado ao download (evita
   perda se o download falhar). Após limpar, os processos daquele mês passam a
   mostrar "0 fotos" (as fotos ficam só no ZIP arquivado no Drive).
5. **Tela:** nova página **"Exportar Fotos"** no menu Recebimento, gate
   `administrar`. Lista os meses que têm fotos (contagem por mês) e, por mês,
   os botões Exportar / Limpar.
6. **Sem automação:** nada de job agendado apagando fotos — a limpeza é sempre
   um ato manual e explícito do administrador, após arquivar.

## Notas de arquitetura (a detalhar no ciclo do B)

- **Consulta de meses com fotos:** join `anexos_processo` × `processos_recebimento`
  agrupando por mês de `data_chegada` (provável RPC, como `processos_meses`
  do 0014, para contagem correta em escala).
- **Montagem do ZIP:** Server Action que carrega os objetos do mês do Storage
  (client de serviço), aplica o rename e devolve o `.zip` (stream/base64) para
  download no cliente. Atenção ao limite de resposta do Next/Vercel — se o
  volume do mês for grande, avaliar signed URLs + zip no cliente, ou paginação.
- **Limpeza:** Server Action gate `administrar` → `storage.remove([...paths])`
  + delete das linhas (o `on delete cascade` da FK cobre a tabela se apagar
  por processo; aqui apagamos por mês).
- **Dependência nova:** `jszip`.
- **Log:** reuso `excluir` (limpeza) e, se fizer sentido, um log da exportação
  (`acao` reutilizada) — decidir no ciclo do B.

## Fora de escopo

- Google Drive API (v2 futura — o arquivamento no Drive é manual: baixa o ZIP
  e sobe no Drive).
