# Cabeçalho do Lançamento por bipe — Design

> **Data:** 2026-07-31 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-consulta-cabecalho`
> **Tipo:** mudança de fluxo no Lançamento (cabeçalho por bipe). **Sem migração, sem backend** (resolução no cliente).

## Contexto

Hoje o cabeçalho do Lançamento é uma **cascata de dropdowns**: Cliente → PMO → OP (mais Colaborador e Posto).
O operador escolhe na mão a cada troca. A ideia é: um **primeiro bipe** de nº de série **identifica a OP** (o SN
embute ano+OP+sequencial e é único), preenchendo Cliente/PMO/OP/Descrição; Colaborador e Posto seguem manuais.
O cabeçalho **persiste** entre lançamentos (já persiste hoje); um botão **"Atualizar cabeçalho"** reabre o bipe.

Decisões (confirmadas): (1) o 1º bipe **só identifica a OP** — não lança a peça; (2) SN sem match → **só avisa**
(no real sempre casa em uma; >1 também vira aviso); (3) Colaborador e Posto **persistem** entre lançamentos.

## Objetivo

Trocar a cascata Cliente/PMO/OP por um **bipe** que resolve a OP pela **faixa de SN** (client-side, `serieDentroDaFaixa`
sobre as OPs já carregadas no form). Colaborador e Posto continuam manuais e persistentes. Botão "Atualizar cabeçalho".

## Escopo

**Dentro:**
- Domínio: `resolverOpPorSn(ordens, sn)` — puro, testável (0/1/N matches).
- `lancamento-form.tsx`: dois estados do cabeçalho (bipe / OP carregada), botão "Atualizar cabeçalho", remoção da
  cascata Cliente/PMO/OP.

**Fora:**
- Backend/migração (resolução é 100% no cliente, com dados que o form já tem).
- Lógica de lançar peça, gate, Integração, Burn-in (inalterados — só o cabeçalho muda).
- Responsividade (outra onda).
- Persistência entre **sessões/refresh** (o cabeçalho persiste dentro da sessão do form, como hoje; recarregar a
  página zera — igual ao comportamento atual).

## Design

### 1. Domínio — `src/modules/shopfloor/domain/cabecalho-lancamento.ts` (+ testes)
Reusa `serieDentroDaFaixa`/`limparSerie` de `domain/serie`.
```ts
/** Resolve a OP de um SN bipado pela faixa (só OPs com faixa cadastrada).
 *  0 matches → SEM_OP; >1 → AMBIGUO (não deveria ocorrer com SN único); 1 → ok. */
export function resolverOpPorSn<T extends { sn_ini: string; sn_fim: string }>(
  ordens: T[],
  sn: string,
): { ok: true; ordem: T } | { ok: false; erro: 'SEM_OP' | 'AMBIGUO' }
```
Implementação: `limparSerie(sn)`; filtra `ordens` com `sn_ini`/`sn_fim` não-vazios e `serieDentroDaFaixa(...)`;
0 → `SEM_OP`; >1 → `AMBIGUO`; 1 → `{ ok:true, ordem }`.
Testes: casa em 1 OP (dentro da faixa) → ok; SN fora de todas → SEM_OP; SN em 2 faixas → AMBIGUO; OP sem faixa
(sn_ini/fim vazios) é ignorada; SN vazio → SEM_OP.

### 2. `lancamento-form.tsx` — cabeçalho por bipe
Estado novo: `const [bipeCab, setBipeCab] = useState('')` (o SN do cabeçalho). Reaproveita `cliente`/`pmo`/`op`
(já existem e já persistem). `ordemSel` continua derivando de cliente+pmo+op.

**Handler:**
```ts
function onBiparCabecalho() {
  if (bipeCab.trim() === '') return
  const r = resolverOpPorSn(ordens, bipeCab)
  if (!r.ok) {
    toast.error(r.erro === 'SEM_OP' ? 'SN não encontrado em nenhuma OP.' : 'SN cai em mais de uma OP.')
    return
  }
  setCliente(r.ordem.cliente); setPmo(r.ordem.pmo); setOp(r.ordem.op)
  setBipeCab('')
}
function atualizarCabecalho() {
  setCliente(''); setPmo(''); setOp('')
  setBipeCab('')
  // foco volta pro campo de bipe (via ref)
}
```

**Render do cabeçalho — dois estados** (substitui os dropdowns de Cliente/PMO/OP; Colaborador e Posto continuam):
- **`op === ''` (Estado A):** card destacado "Bipe o Nº de Série para carregar a OP" com `<Input>` (autoFocus,
  `onKeyDown` Enter → `onBiparCabecalho`, aceita digitação + Enter). Colaborador e Posto **não** aparecem ainda
  (ou aparecem desabilitados) — a OP vem primeiro.
- **`op !== ''` (Estado B):** cabeçalho compacto — **Cliente/PMO/OP/Descrição só leitura** + botão **"Atualizar
  cabeçalho"** (chama `atualizarCabecalho`) · **Colaborador** (input, persiste) · **Posto** (dropdown, persiste).
  Abaixo, o resto do Lançamento (bipe da peça `snRef`, status, etc.) **inalterado**.

**Foco:** ao carregar a OP, focar Colaborador se vazio, senão o SN da peça (`snRef`); ao "Atualizar cabeçalho",
focar o campo de bipe do cabeçalho.

**Remoção:** os `<Select>` de Cliente, PMO e OP (e os `useMemo` `clientes`/`pmos`/`ops` que só serviam a eles)
saem. `ordemSel`/`postosDaOp` e o resto ficam.

## Critérios de sucesso
- Sem OP: bipar (ou digitar+Enter) um SN válido carrega Cliente/PMO/OP/Descrição; SN inválido → aviso, não carrega.
- OP carregada: Colaborador e Posto preenchíveis e **persistem** entre lançamentos; "Atualizar cabeçalho" volta ao
  bipe mantendo Colaborador/Posto.
- Lançar peça, gate, Integração e Burn-in seguem funcionando igual (cabeçalho alimenta `ordemSel` como antes).
- Build/lint/test verdes (incl. o teste novo do domínio). Sem migração.

## Riscos / considerações
- **Resolução client-side** depende de `ordens` (OPs ativas) já estar no form — está (é a prop `ordens`). SN de OP
  finalizada não resolve (não está na lista) — aceitável (Lançamento é de OP ativa).
- **Remoção da cascata**: garantir que nada mais consome `clientes`/`pmos`/`ops` (eram só os dropdowns).
- **Sem plano-B de dropdown**: digitar o SN + Enter cobre o caso sem scanner (decisão do usuário: bipe é o caminho).
- Smoke: bipe válido, bipe inválido, digitar+Enter, atualizar cabeçalho (mantém Colab/Posto), vários lançamentos
  seguidos sem re-bipar cabeçalho, e um fluxo de Integração/Burn-in pra confirmar que o cabeçalho alimenta certo.
