# Obrigatoriedade da faixa de SN no Cadastro de OP — Design

> **Data:** 2026-07-28 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-pos-prod`
> **Tipo:** correção/regra de negócio pequena. Segue o fluxo Dev × Prod.

## Contexto

No Cadastro de OP (`/shopfloor/ordens`), a **faixa de SN** da OP (`sn_ini`..`sn_fim`, colunas de
`sf_ordens`) é hoje **opcional** — a regra atual só exige "os dois limites juntos ou nenhum"
([`domain/validar-ordem.ts`](../../../src/modules/shopfloor/domain/validar-ordem.ts)). Muitas OPs
migradas vieram com faixa vazia, e o N1 do Lançamento/Integração é **gradual** por causa disso
(OP sem faixa não bloqueia).

A faixa alimenta regras reais: o **N1** (`serieDentroDaFaixa`) valida se o SN de uma placa/produto
cai na faixa da OP. Uma OP sem faixa — ou com faixa **incoerente** (limites com prefixos/sufixos
diferentes, ou início > fim) — enfraquece esse rastreio.

**No Prod a `sf_ordens` está vazia** (OPs cadastradas do zero), então tornar a faixa obrigatória faz
o Prod nascer consistente. No Dev há ~115 OPs migradas (muitas sem faixa) — que passarão a exigir
faixa ao serem editadas.

## Objetivo

Tornar a **faixa de SN obrigatória e coerente** ao salvar uma OP (criar **e** editar), com mensagens
de erro claras, sem tocar em nenhuma outra regra.

## Escopo

**Dentro:**
- Validação do Cadastro de OP (`validarOrdem`), aplicada a **criar e editar** (a função é
  compartilhada pelas duas actions).
- Nova função de domínio `faixaCoerente` (coerência da faixa).
- UI do formulário: marcar SN inicial/SN final como obrigatórios + texto de ajuda.
- Testes (domínio) e atualização das regras de negócio.

**Fora (confirmado com o usuário):**
- O **gate N1** no Lançamento/Integração continua **gradual** (OP sem faixa não bloqueia) — protege
  as OPs antigas do Dev ainda não editadas.
- Obrigatoriedade do **SN individual** no Lançamento.
- Filtros/scroll da tela de OP (item de backlog separado).

## Design

### 1. Domínio — `faixaCoerente` (nova, em `serie.ts`)

Colocada junto de `partesSerie`/`serieDentroDaFaixa` (mesma responsabilidade: lógica pura de série),
reusando `partesSerie`.

```ts
/** True se snIni..snFim formam uma faixa coerente: mesmo formato e início ≤ fim. */
export function faixaCoerente(snIni: string, snFim: string): boolean
```

Regras (assume os dois já não-vazios; defensivamente devolve `false` se algum `limpo` for vazio):
- **Numérico** (`ai.num` e `af.num` não-NaN): coerente se
  `lc(ai.prefixo) === lc(af.prefixo)` **e** `lc(ai.sufixo) === lc(af.sufixo)` **e** `ai.num ≤ af.num`.
  (`lc` = lowercase, alinhado ao `serieDentroDaFaixa`.)
- **Misto** (um lado numérico e o outro não): **incoerente** (`false`).
- **Lexical** (nenhum lado com bloco de dígitos): coerente se `ai.limpo !== '' && ai.limpo ≤ af.limpo`.
- **início == fim** é **válido** (OP de 1 peça).

### 2. Domínio — `validarOrdem` (alterado, em `validar-ordem.ts`)

A ordem das checagens (retorna o primeiro erro encontrado):
1. `pmo` vazio → `'Informe o PMO.'` *(inalterado)*
2. `op` vazio → `'Informe o número da OP.'` *(inalterado)*
3. `cliente` vazio → `'Informe o cliente.'` *(inalterado)*
4. `snIni` **ou** `snFim` vazio → `'Preencha o início e o fim da faixa de SN.'` *(era opcional; agora exige)*
5. `!faixaCoerente(snIni, snFim)` → `'Faixa de SN inválida: início e fim devem ter o mesmo formato, e o início não pode ser maior que o fim.'`
6. senão `{ ok: true }`

O comentário da função e a regra "ou deixe ambos vazios" (mensagem antiga) saem.

### 3. Aplicação — sem mudança

`criarOrdem` e `atualizarOrdem` ([`application/ordens-actions.ts`](../../../src/modules/shopfloor/application/ordens-actions.ts))
já chamam `validarOrdem` e propagam `{ ok:false, erro }` pra tela. Confirmar na implementação que o
erro é exibido no formulário (o mecanismo de erro já existente).

### 4. UI — `ordem-form.tsx`

- Labels **SN inicial** e **SN final**: marcar como obrigatórios (asterisco visual, padrão dos outros
  campos obrigatórios do form).
- Texto de ajuda curto perto da faixa: ex. *"Mesmo formato nos dois limites (ex.: `SN0001` a `SN0500`)."*
- A validação de verdade é no servidor (`validarOrdem`); a UI só sinaliza obrigatoriedade. Não
  duplicar a lógica de coerência no client (fonte única = domínio).

### 5. Testes (Vitest, TDD — domínio puro)

`domain/__tests__/serie.test.ts` (ou arquivo dedicado) — **`faixaCoerente`**:
- numérico válido (`SN0001`, `SN0500`) → true
- início > fim (`SN0500`, `SN0001`) → false
- prefixos divergentes (`SN0001`, `XX0500`) → false
- sufixos divergentes (`0001A`, `0500B`) → false
- início == fim (`SN0001`, `SN0001`) → true
- lexical válido (`ABC`, `ABD`) → true
- lexical invertido (`ABD`, `ABC`) → false
- misto (`SN0001`, `ABC`) → false
- algum vazio → false

`domain/__tests__/validar-ordem.test.ts` — **`validarOrdem`** (novos casos):
- faixa vazia (ambos) → erro "Preencha o início e o fim…"
- só um limite → erro "Preencha o início e o fim…"
- faixa incoerente (início>fim) → erro "Faixa de SN inválida…"
- faixa válida → `{ ok: true }`
- PMO/OP/cliente vazios ainda barram (regressão dos casos existentes)

### 6. Documentação

- `docs/regras-de-negocio-shopfloor.md`: **regra 2 do Cadastro de OP** passa de
  *"faixa de SN opcional, mas os dois limites juntos ou nenhum"* → *"faixa de SN **obrigatória**:
  os dois limites, **coerentes** (mesmo formato, início ≤ fim)"*.
- Mover/atualizar o item de backlog **"Obrigatoriedade de faixa/Nº de Série"** (a parte "exigir faixa
  em toda OP" foi feita; o N1 não-gradual e o SN obrigatório no Lançamento seguem no backlog).

## Critérios de sucesso

- Criar OP sem faixa (ou com só um limite) → **barrado** com mensagem clara.
- Criar/editar OP com faixa incoerente (início>fim, prefixos diferentes) → **barrado**.
- Criar/editar OP com faixa válida → **salva**.
- PMO/OP/cliente continuam obrigatórios (sem regressão).
- N1 no Lançamento/Integração **inalterado** (segue gradual).
- Testes de domínio passando; build limpo.

## Riscos

- **OPs antigas do Dev sem faixa:** ao editá-las, o usuário será obrigado a preencher a faixa. É o
  comportamento desejado (consistência), mas vale saber que edições rápidas passam a exigir faixa.
- Baixo risco geral: mudança concentrada em 2 arquivos de domínio + UI, sem tocar em banco/RLS.
