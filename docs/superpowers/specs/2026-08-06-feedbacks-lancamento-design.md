# Feedbacks da tela de Lançamento — Design

> **Data:** 2026-08-06 · **Módulo:** ShopFloor (Operar → Lançamento) · **Branch:** `feat/shopfloor-feedbacks-lancamento`
> **Tipo:** UI (sem migração).

## Contexto
Hoje o Lançamento mostra um `PainelResultado` grande (verde=ok / vermelho=erro) só do **último** evento.
O usuário quer: (1) o balão do último com **fundo neutro** e só o **símbolo colorido**; (2) abaixo dele, uma
**tabela (log da sessão)** dos lançamentos, mais recente no topo, com 3 colunas.

## Design

### 1. Painel do último lançamento (fundo neutro, símbolo colorido)
`PainelResultado` passa a ter **fundo neutro** sempre; só o quadradinho do ícone é colorido. Três estados
(`tipo`):
- `ok` → ✓ **verde** (Aprovado ou registro neutro sem status).
- `reprova` → ✗ **vermelho** (Reprovado).
- `aviso` → ! **amarelo** (erro/bloqueio/pré-validação: duplicado, sequência, sem manutenção, tempo mínimo…).

Mantém título, chips (Nº Série, Posto, Status) e o campo `dica`. Componente é compartilhado com
Embalagem/Integração → aqueles passam a usar `ok`/`aviso` (antes `ok`/`erro`), ficando consistentes.

### 2. Tabela — histórico da sessão (`HistoricoLancamentos`)
Novo componente. Uma linha por lançamento **efetivo** (bipe → gravar), mais recente no topo, rolagem,
limite ~30. Colunas:
- **Lançamento**: ✓ verde (registrou) / ✗ vermelho (erro no registro).
- **Status**: ✓ verde (Aprovado) / ✗ vermelho (Reprovado) / — cinza (posto sem status ou registro falhou).
- **Nº de Série** (mono).

`LinhaHistorico = { lancamento: boolean; status: 'aprovado' | 'reprovado' | null; sn: string }`.

### 3. Regras
- Só **lançamentos efetivos** entram na tabela. Erros de **pré-validação** ("Preencha Colaborador…",
  "Não reconhecido…") aparecem só no balão (aviso), sem virar linha.
- Sem duplicar: quando o último evento é um lançamento, o balão mostra o mais recente e a tabela mostra os
  **anteriores** (`historico.slice(1)`); quando o último evento é um aviso de pré-validação, a tabela mostra o
  histórico **completo** (nada some). Controlado por um flag `ultimoEhLancamento`.
- Histórico é **da sessão** (zera ao recarregar), cresce mesmo trocando de posto/OP.
- Status do NQA (derivado): o cliente calcula Reprovado se `nqaVisual==='Reprovado' || nqaFuncional==='Reprovado'`
  só para exibição no balão/tabela.

### Arquivos
- **Modify** `src/components/ui/painel-resultado.tsx` (tipo `ok|reprova|aviso`, fundo neutro).
- **Create** `src/app/(app)/shopfloor/operar/lancamento/historico-lancamentos.tsx` (tabela + `LinhaHistorico`).
- **Modify** `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx` (estado `historico`, helper `mostrar`,
  chamadas de resultado, render da tabela).
- **Modify** `embalagem-panel.tsx`, `integracao-panel.tsx` (`erro`→`aviso`).

## Critérios de sucesso
- Balão neutro, símbolo verde/vermelho/amarelo conforme Aprovado/Reprovado/aviso.
- Cada lançamento vira uma linha (Lançamento ✓/✗, Status ✓/✗/—, Nº Série); mais recente no topo; rola.
- Pré-validações não sujam a tabela. Embalagem/Integração seguem funcionando (aviso amarelo no erro).
- build+lint+test verdes. Sem migração.
