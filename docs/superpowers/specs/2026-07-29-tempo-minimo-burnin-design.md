# Tempo mínimo de Burn-in (por OP, com aviso na saída) — Design

> **Data:** 2026-07-29 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-pos-prod`
> **Tipo:** feature (Cadastro de OP + Lançamento/Burn-in). **Precisa de migração no Dev.** Fluxo Dev × Prod.

## Contexto

O Burn-in tem hoje **entrada → saída** pareadas por peça ([0037_sf_burnin.sql](../../../supabase/migrations/0037_sf_burnin.sql)):
a **entrada** grava um registro `posto='Burn-in'`, `status=''`, `data_hora=now()`; a **saída** exige uma
entrada aberta e grava o status. Não há noção de **tempo mínimo** de permanência. A reunião (2026-07-29)
pediu **"poder setar tempo mínimo no Burn-in"**.

Decisões (usuário):
- **Onde:** por enquanto **no Cadastro de OP** (cada OP tem seu tempo mínimo). Um "ajuste global maior" fica
  no backlog.
- **Ação:** **só avisa** — se a peça sair antes do tempo, mostra uma **confirmação** ("faltavam X; registrar
  mesmo assim?"); se confirmar, grava normal. Não bloqueia.

## Objetivo

Permitir definir um **tempo mínimo de Burn-in por OP** e, na **saída** do Burn-in, **avisar** (confirmação)
quando a peça está saindo antes desse tempo — sem travar.

## Escopo

**Dentro:**
- Migração: `sf_ordens.tempo_min_burnin` (minutos, default 0 = sem mínimo).
- Cadastro de OP: campo **"Tempo mín. Burn-in"** (`hh:mm`, opcional).
- Saída do Burn-in (na tela de Lançamento): **aviso/confirmação** se `decorrido < mínimo`.

**Fora (confirmado):**
- **Bloquear** de fato (é só aviso). Se um dia virar trava → mover a checagem pro RPC (relógio do servidor).
- Tempo **global/config** (backlog: "ajuste maior").
- Mostrar contagem/tempo restante no **painel de Burn-in** (`analisar/burn-in`) — dá pra somar depois.
- Mexer no RPC `sf_burnin` (fica **intacto**; o aviso é pré-gravação, no cliente).
- Tempo por padrão de fluxo/PMO.

## Design

### 1. Migração — `supabase/migrations/0060_sf_ordens_tempo_min_burnin.sql`
```sql
alter table public.sf_ordens
  add column if not exists tempo_min_burnin int not null default 0;  -- minutos; 0 = sem mínimo
comment on column public.sf_ordens.tempo_min_burnin is 'Tempo mínimo de Burn-in em minutos (0 = sem mínimo).';
```
Sem mudança de RLS (a coluna herda as policies da tabela). **Aplicar só no Dev** (via `supabase db push`).
Vira a migração **0060** (na sequência das 0058/0059 já no Dev).

### 2. Domínio — `src/modules/shopfloor/domain/tempo-burnin.ts` (TDD)
Conversões puras, testáveis:
- `tempoParaMinutos(texto: string): number | null` — aceita `''`→`0`; `'H:MM'`/`'HH:MM'` com **horas
  ilimitadas** (ex.: `'48:00'`) e minutos `00–59`; devolve total em minutos; formato inválido → `null`.
  (Regex `^(\d+):([0-5]?\d)$` além do vazio.)
- `minutosParaTempo(min: number): string` — inverso, `hh:mm` com zero-pad nos minutos (ex.: `120`→`'2:00'`).
- `formatarDuracao(min: number): string` — legível pro aviso: `95`→`'1h 35min'`, `40`→`'40min'`,
  `120`→`'2h'`.

### 3. Infra — `src/modules/shopfloor/infra/ordem-repository.ts`
- `interface DadosOrdem` += `tempo_min_burnin: number`.
- `interface OrdemRow` += `tempo_min_burnin: number`.
- `listarOrdens()` — incluir `tempo_min_burnin` no `.select(...)` e no cast/retorno.
- `criarOrdem`/`atualizarOrdem` **não mudam** (já gravam o objeto `dados` inteiro via `insert(dados)` /
  `update({ ...dados, updated_at })`).

### 4. Infra — `src/modules/shopfloor/infra/lancamento-repository.ts`
- `interface OrdemLancamentoLista` += `tempo_min_burnin: number`.
- `listarOrdensParaLancamento()` — incluir `tempo_min_burnin` no `.select(...)`, no cast e no `map`.
- **Nova função** `buscarEntradaBurninAberta(pmo, op, snNorm): Promise<string | null>`:
  - `select status, data_hora from sf_registros where pmo=… and op=… and numero_serie_norm=… and
    posto='Burn-in' order by data_hora desc limit 1`;
  - se a linha existe **e** `status === ''` (entrada aberta) → retorna `data_hora` (ISO); senão `null`.
  - Espelha a lógica do RPC (`v_ultimo_status = ''` ⇒ dentro). RLS de `sf_registros` (select =
    `shopfloor.visualizar`) já é satisfeita — o operador tem `visualizar` (a cascata do Lançamento lê
    `sf_ordens`, que exige a mesma permissão).

### 5. Application — `src/modules/shopfloor/application/ordens-actions.ts`
- `lerDados(fd)`: ler o campo `tempo_min_burnin` (texto `hh:mm`), converter com `tempoParaMinutos`. Como
  `lerDados` retorna `DadosOrdem` (número), fazer a conversão e, se **inválida**, sinalizar erro. Padrão:
  parsear no `criarOrdemAction`/`editarOrdemAction` **antes** de montar `dados`:
  ```ts
  const tempoBruto = String(formData.get('tempo_min_burnin') ?? '').trim()
  const tempoMin = tempoParaMinutos(tempoBruto)
  if (tempoMin === null) return { ok: false, erro: 'Tempo mínimo de Burn-in inválido (use hh:mm).' }
  ```
  e incluir `tempo_min_burnin: tempoMin` no objeto `dados` (ajustar `lerDados` p/ receber o valor já
  convertido, ou setar o campo após a chamada). `validarOrdem` **não muda** (tempo é opcional; 0 é válido).

### 6. Application — `src/modules/shopfloor/application/lancar-action.ts` (ou action nova)
- **Nova server action** `buscarEntradaBurnin(pmo: string, op: string, numeroSerie: string): Promise<string | null>`:
  - guard `getSessao` + `podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')`;
  - normaliza a SN com `normalizarSerie` (mesma função do `lancar-action`);
  - chama `buscarEntradaBurninAberta(pmo, op, snNorm)`; retorna o ISO ou `null`.
  - Pode viver em `lancar-action.ts` (já tem os imports) ou num arquivo próprio `burnin-aviso-action.ts`.

### 7. UI — Cadastro de OP (`src/app/(app)/shopfloor/ordens/`)
- **`ordem-form.tsx`:** novo estado controlado `const [tempoMinBurnin, setTempoMinBurnin] = useState(
  minutosParaTempo(ordem?.tempo_min_burnin ?? 0) )` (mostra `''` quando 0? decisão: **0 → campo vazio**;
  usar `ordem?.tempo_min_burnin ? minutosParaTempo(...) : ''`). Input **"Tempo mín. Burn-in"** (`hh:mm`,
  placeholder `ex.: 2:00`, opcional), `name="tempo_min_burnin"`, controlado. Incluir no **reset-on-open** do
  Dialog e o tipo `OrdemView` ganha `tempo_min_burnin: number` (mapeado em `page.tsx`). Mostrar só uma dica
  ("deixe vazio p/ sem mínimo").
- **`page.tsx`:** incluir `tempo_min_burnin` no `OrdemView` mapeado a partir de `listarOrdens()`.

### 8. UI — Lançamento (`src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`)
- `useConfirmacao()` (import + hook + render de `{dialog}`).
- Em `onEnviar`, **antes** do `startTransition(lancar(...))`, quando `ehBurnin && burninEvento === 'saida'` e
  `(ordemSel?.tempo_min_burnin ?? 0) > 0`:
  ```ts
  const entradaIso = await buscarEntradaBurnin(pmo, op, numeroSerie)
  if (entradaIso) {
    const decorridoMin = (Date.now() - Date.parse(entradaIso)) / 60000
    const min = ordemSel.tempo_min_burnin
    if (decorridoMin < min) {
      const faltam = formatarDuracao(Math.ceil(min - decorridoMin))
      const ok = await confirmar({
        titulo: 'Sair antes do tempo mínimo de Burn-in?',
        descricao: `Faltavam ${faltam} para o mínimo. Registrar a saída mesmo assim?`,
      })
      if (!ok) return
    }
  }
  ```
  Só depois segue o fluxo atual (`lancar(...)`). Se `tempo_min = 0`, entrada, ou tempo cumprido → sem atrito.
  Refatorar `onEnviar` p/ `async` na parte do await antes de `startTransition` (ou fazer o await dentro de um
  handler async e depois `startTransition`).

## Critérios de sucesso
- Cadastro de OP salva/edita `Tempo mín. Burn-in` (`hh:mm` → minutos); vazio = 0 (sem mínimo); formato
  inválido → erro. Reabrir "Nova OP" vem limpo.
- Saída de Burn-in **antes** do mínimo → confirmação com "faltavam X"; **Cancelar** não grava, **Confirmar**
  grava. Saída após o mínimo (ou OP sem mínimo) → grava direto, sem diálogo.
- Entrada do Burn-in inalterada; RPC `sf_burnin` inalterado.
- `tempoParaMinutos`/`minutosParaTempo`/`formatarDuracao` com testes (incl. `48:00`, `1:05`, `''`, inválidos).
- Build limpo; migração `0060` só no Dev; Prod intacta.

## Riscos / considerações
- **Relógio do cliente:** o "decorrido" usa `Date.now()` vs `data_hora` (servidor). Como é **só aviso**, o
  desvio é irrelevante. Vira trava só migrando a checagem pro RPC (backlog).
- **Burn-in > 24h:** o campo aceita `hh:mm` com **horas ilimitadas** (parser próprio; não usar `<input
  type="time">`, que trava em 23:59).
- **RLS do lookup:** o operador de Lançamento tem `shopfloor.visualizar` (a cascata prova isso), então o
  `select` em `sf_registros` passa; sem RPC security-definer novo.
- **`onEnviar` vira async antes do `startTransition`:** garantir que o `disabled`/`enviando` continue
  consistente (o await do lookup é rápido; manter o botão desabilitado durante).
- Migração é só `add column` com default → **não reescreve** linhas existentes (Postgres 11+: default
  constante é metadata-only). Seguro no Dev e depois no Prod.
