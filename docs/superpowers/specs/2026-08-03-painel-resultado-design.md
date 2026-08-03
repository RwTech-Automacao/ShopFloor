# Painel de Resultado (feedback rico das ações) — Design · Fase 1 (telas de bipe)

> **Data:** 2026-08-03 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-painel-resultado`
> **Tipo:** UX — troca os toasts pequenos por um painel grande fixo (Opção A) com informação relevante da ação.
> **Sem migração, sem backend.** Fase 1 = telas de **bipe**; cadastros ficam pra Fase 2.

## Contexto

Hoje as ações dão retorno por **toast** (sonner) — o "balãozinho" verde/vermelho que some sozinho e mostra pouca
informação. O usuário quer algo **maior e mais completo**, mostrando o que é relevante pra cada ação (ex.: no erro
"peça já registrada", ver o SN e o posto; no sucesso, ver o que foi registrado). Aprovado o formato **Opção A —
painel grande fixo** (ver artifact do comparativo). Rollout **faseado**: Fase 1 nas telas de bipe.

## Objetivo

Um componente reusável **`PainelResultado`** (bloco grande ✓/✗ com título + detalhes + "o que fazer") que mostra o
resultado da **última ação** e **fica na tela até a próxima**. Aplicado nas telas de bipe: **Peça** (Lançamento,
inclui Burn-in), **Embalagem** e **Integração**.

## Escopo

**Dentro (Fase 1):** o componente + tipo `ResultadoAcao`; substituir os toasts por ele nas 3 telas de bipe
(`lancamento-form` Peça/`onEnviar`, `embalagem-panel`, `integracao-panel`), com conteúdo rico por ação.
**Fora:** cadastros (Fase 2 — erro no diálogo, sucesso na lista); o bipe do **cabeçalho** (carrega OP) segue toast
(não é registro de peça); o **seletor de SN ambíguo** da Integração continua como está.

## Design

### 1. Componente — `src/components/ui/painel-resultado.tsx`
```ts
export interface ChipResultado { rotulo?: string; valor: string; mono?: boolean; destaque?: boolean }
export interface ResultadoAcao {
  tipo: 'ok' | 'erro'
  titulo: string
  detalhe?: string           // linha de apoio
  chips?: ChipResultado[]    // fatos (SN, posto, status, caixa, código…)
  dica?: string              // "o que fazer" (sobretudo no erro)
}
export function PainelResultado({ resultado }: { resultado: ResultadoAcao | null }): JSX.Element | null
```
Render: `null` se `resultado` for null. Senão, um bloco (Card-like) com **borda esquerda** e fundo tint verde
(`ok`) ou vermelho (`erro`), **ícone grande** (✓ / !), **título** grande, **detalhe**, **chips** (pílulas rótulo+valor;
`mono` p/ SN/código; `destaque` p/ status Aprovado) e **dica**. Tailwind no padrão do app (verde `green-600/700`,
vermelho `red-600/700`, `bg-card`, `border-border`). Acessível (role apropriado); respeita dark mode.

### 2. `lancamento-form.tsx` — Peça / Burn-in (`onEnviar`)
- Estado `const [resultado, setResultado] = useState<ResultadoAcao | null>(null)`; renderiza `<PainelResultado
  resultado={resultado} />` no topo do card **Peça** (acima do campo de SN).
- **Sucesso** (hoje `toast.success('Registrado.')`): `{ tipo:'ok', titulo: ehBurnin ? (burninEvento==='saida'
  ? 'Saída de Burn-in registrada' : 'Entrada de Burn-in registrada') : 'Peça registrada', chips: [SN(mono),
  Posto, ...(mostraStatus ? [status com destaque se Aprovado] : [])] }`.
- **Erro** (hoje `toast.error(r.erro)`): `{ tipo:'erro', titulo: r.erro, chips: [SN(mono), Posto] }`.
- Limpar `resultado` ao trocar de posto/OP (contexto novo). O bipe do cabeçalho (linha 95) **segue toast**.

### 3. `embalagem-panel.tsx`
- Estado `resultado`; painel no topo do card.
- **Embalar sucesso** (hoje sem toast): `{ tipo:'ok', titulo:'Peça embalada', chips:[SN(mono), Caixa `CX${seq} ·
  ${qtdNaCaixa+1}/${limite}`] }`.
- **Embalar erro** (`toast.error(r.erro)`): `{ tipo:'erro', titulo:r.erro, chips:[SN(mono)], dica: /caixa cheia/i.test(r.erro)
  ? 'Feche a caixa e continue na próxima.' : undefined }`.
- **Fechar caixa sucesso** (`Caixa fechada: código`): `{ tipo:'ok', titulo:'Caixa fechada', chips:[Código(mono)] }`.
- **Fechar erro / limite inválido / carregar erro**: `{ tipo:'erro', titulo: <mensagem> }`.

### 4. `integracao-panel.tsx`
- Estado `resultado`; painel no topo.
- **Placa encaixada** (`Placa encaixada em PMO`): `{ tipo:'ok', titulo:'Placa encaixada', chips:[PMO, SN(mono)] }`.
- **Erros de encaixe** (PMO já tem placa / SN já encaixado / fora receita / SN não encontrado): `{ tipo:'erro',
  titulo: <mensagem>, chips:[SN(mono) quando fizer sentido] }`.
- **Integração registrada** (`Integração registrada: código`): `{ tipo:'ok', titulo:'Integração registrada',
  chips:[Código(mono), Produto SN(mono)] }`.
- **Registrar erro**: `{ tipo:'erro', titulo: r.erro }`. O **seletor de SN ambíguo** fica como está.

## Critérios de sucesso
- Nas 3 telas de bipe, cada ação mostra o **painel grande** (verde/vermelho) com título + detalhes relevantes,
  e ele **fica** até a próxima ação (não some sozinho).
- O erro "peça já registrada" mostra o **SN e o posto** junto (o pedido do usuário).
- Sem toasts duplicados nessas ações (o painel substitui). Build/lint/test verdes. Sem migração.

## Riscos / considerações
- **Substituição, não adição:** remover os `toast.*` dessas ações (o painel é o feedback). Toasts seguem noutras telas (Fase 2).
- **Espaço na tela:** o painel ocupa lugar fixo; posicioná-lo no topo do card de ação, compacto quando sem detalhe.
- **Reuso:** o componente é genérico (`ResultadoAcao`), pronto pra Fase 2 (cadastros) sem retrabalho.
- Smoke: sucesso/erro de cada tela (Peça, Burn-in entrada/saída, Embalagem bipe+cheia+fechar, Integração encaixe+registrar), dark mode, e que o painel persiste até a próxima ação.
