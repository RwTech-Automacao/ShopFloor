# Resumo diário por posto — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development.

**Objetivo:** um tipo de regra novo (`resumo`) que, na hora configurada, manda uma linha por posto
da regra com a taxa de aprovação do dia.

**Spec:** `docs/superpowers/specs/2026-10-08-alertas-resumo-diario-design.md` — leia antes.

**Arquitetura:** o resumo entra no `alerta_avaliar` por uma **saída única no topo do laço**, com
`continue` logo depois — o caminho da ocorrência **nunca o enxerga**. Nenhuma condição nova nos seis
passos existentes. A aritmética de horário fica no TypeScript, como na 0139.

## Restrições globais

- **Tudo em PT-BR**: identificadores, comentários, mensagens, textos de tela.
- ⚠️ `--maxWorkers=2` é **obrigatório** no vitest desta máquina (4 núcleos; sem isso exit 137).
- ⚠️ **Rode nos DOIS fusos** quando mexer em horário: `npx vitest ...` e `TZ=UTC npx vitest ...`.
  O servidor roda em UTC e esta branch irmã já teve vazamento que **só** morria com `TZ=UTC`.
- ⚠️ `next build` **RODA** nesta worktree (`node_modules` é diretório real, não symlink). Use-o:
  `NODE_OPTIONS="--max-old-space-size=4096" npx next build`.
- ⚠️ **`'use server'` só exporta funções async.** Exportar um tipo de lá quebra o `next build` **em
  silêncio**. Tipos vão para `domain/`.
- ⚠️ **O projeto TEM harness de teste SQL**: `supabase/tests/rodar-alertas-test.sh` sobe um Postgres
  15 descartável em Docker e aplica cada migração **duas vezes**. Rodar é seguro e esperado.
- Migração **idempotente**, corpo de função com `$func$` (o SQL Editor recusa `$$`, inclusive em
  comentário), `notify pgrst, 'reload schema';` na última linha.
- ⚠️ **`tem_permissao` sempre com 2 argumentos.** A forma de 1 argumento checa permissão GLOBAL.
- ⚠️ **Não rode nada contra Dev nem Prod.** Só o Postgres descartável do harness.
- `git add` com caminhos explícitos — **nunca** `git add -A` nem `git add .`.
- Commit termina com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- ⚠️ `.superpowers/` está no `.gitignore` de propósito. **NÃO** use `git add -f`.

---

### Task 1: Domínio — chegou a hora de mandar?

**Arquivos:** criar `src/modules/alertas/domain/resumo.ts` e `__tests__/resumo.test.ts`

**Interface produzida:**

```ts
/** Chegou a hora configurada e o resumo ainda não foi enviado HOJE (em São Paulo)? */
export function horaDeEnviarResumo(
  horaResumo: string,            // 'HH:MM'
  enviadoEm: string | null,      // 'AAAA-MM-DD' do último envio, ou null
  agora: Date,
): boolean
export const HORA_RESUMO_MIN = '06:00'
export const HORA_RESUMO_MAX = '19:00'
```

- [ ] **Passo 1: testes que falham**

```ts
import { describe, expect, it } from 'vitest'
import { horaDeEnviarResumo } from '../resumo'

/** Instante a partir da hora de PAREDE de São Paulo (UTC-3, sem horário de verão). */
function sp(dia: string, hhmm: string): Date { return new Date(`${dia}T${hhmm}:00-03:00`) }

describe('horaDeEnviarResumo', () => {
  it('antes da hora não manda', () => {
    expect(horaDeEnviarResumo('18:00', null, sp('2026-10-08', '17:59'))).toBe(false)
  })
  it('na hora em ponto manda', () => {
    expect(horaDeEnviarResumo('18:00', null, sp('2026-10-08', '18:00'))).toBe(true)
  })
  it('depois da hora, no mesmo dia, ainda manda se não mandou', () => {
    expect(horaDeEnviarResumo('18:00', null, sp('2026-10-08', '18:47'))).toBe(true)
  })
  it('já mandou HOJE: não manda de novo', () => {
    expect(horaDeEnviarResumo('18:00', '2026-10-08', sp('2026-10-08', '18:47'))).toBe(false)
  })
  it('mandou ONTEM: manda hoje', () => {
    expect(horaDeEnviarResumo('18:00', '2026-10-07', sp('2026-10-08', '18:01'))).toBe(true)
  })
  it('mandou ontem, mas ainda não chegou a hora de hoje', () => {
    expect(horaDeEnviarResumo('18:00', '2026-10-07', sp('2026-10-08', '09:00'))).toBe(false)
  })
  it('hora malformada nunca manda', () => {
    for (const ruim of ['', '18', '25:00', 'abc', '18:60']) {
      expect(horaDeEnviarResumo(ruim, null, sp('2026-10-08', '23:00')), ruim).toBe(false)
    }
  })
  it('23:30 em São Paulo é 02:30 do dia SEGUINTE em UTC — o dia é o da fábrica', () => {
    // mandou "hoje" às 23:30 SP; em UTC já virou o dia, mas não pode mandar de novo
    expect(horaDeEnviarResumo('23:00', '2026-10-08', sp('2026-10-08', '23:30'))).toBe(false)
  })
  it('00:30 em São Paulo ainda é o dia novo, e o de ontem não bloqueia', () => {
    expect(horaDeEnviarResumo('00:00', '2026-10-07', sp('2026-10-08', '00:30'))).toBe(true)
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**, nos dois fusos (`npx vitest run …` e `TZ=UTC npx vitest run …`)
- [ ] **Passo 3: implementar**

Reaproveite `lerHhMm` de `domain/intervalos.ts` para conferir o formato — não escreva outro regex.
Para a data de hoje em São Paulo, reaproveite `partesSp` de `intervalos.ts` (exporte-a se ainda não
for exportada; **não duplique**). ⚠️ Nunca use `agora.getDate()`/`getHours()`: usam o fuso do
processo, que no servidor é UTC.

- [ ] **Passo 4: verde nos dois fusos** + `npx tsc --noEmit` + eslint
- [ ] **Passo 5: commit**

---

### Task 2: Domínio — o tipo `resumo` nos tipos e na validação

**Arquivos:** `domain/tipos.ts`, `domain/regra.ts`, teste novo

**O que muda:**

1. `TipoRegra` += `'resumo'`; `TIPOS_REGRA`, `NOME_TIPO_REGRA` ('Resumo diário'),
   `DESCRICAO_TIPO_REGRA` ('Manda, na hora escolhida, a taxa de aprovação do dia de cada posto.'),
   `ehTipoRegra`.
2. `EntradaRegra`/`RegraValida` ganham `horaResumo: string | null`.
3. **O que o tipo `resumo` EXIGE:** nome, pelo menos 1 posto, **intervalos** (com
   `validarIntervalos`, passo `null` — o passo não se aplica), **hora** entre 06:00 e 19:00,
   destinatários, canais.
4. **O que ele NÃO usa, e a validação RECUSA se vier preenchido** (em vez de ignorar em silêncio):
   `taxaMinima`, `minimoBipes`, `lembreteMin`, `limiteTempo`, `limiteOcorrencias`, `pausaMaxMin`.
   Mensagem única: `'O resumo diário não usa este campo.'`
5. `janelaTipo` no `resumo` sai como `'intervalos'` (ele usa os intervalos), e `janelaValor` sai
   `null` — **sem passo**. ⚠️ Confira o que a 0139 exige no check do banco e **concorde com ele**:
   se o check atual exigir `janela_valor >= 15` para `janela_tipo = 'intervalos'`, a Task 4 precisa
   afrouxá-lo para `tipo = 'resumo'`. **Diga no relatório o que encontrou.**
6. A hora fora de 06:00–19:00 recusa com: `'A hora do resumo deve ficar entre 06:00 e 19:00 (fora
   disso o banco está desligado e o relatório não sairia).'`

- [ ] **Passos 1 a 5** no ritmo TDD. Teste as **fronteiras exatas**: 06:00 e 19:00 **aceitos**,
      05:59 e 19:01 **recusados**. Esta branch irmã teve 6 mutações sobrevivendo por teste na
      fronteira errada.

---

### Task 3: Domínio — o texto do resumo

**Arquivos:** `domain/mensagens.ts` (ou um módulo novo), teste

```ts
export interface LinhaResumo { posto: string; aprovados: number; reprovados: number }
/** Uma linha por posto, com a taxa. Postos sem bipe JÁ VÊM FORA da lista. */
export function textoResumo(nomeRegra: string, dia: Date, linhas: LinhaResumo[]): string
```

Use `formatarTaxa` e `formatarDataHoraCurta`/`formatarHora` de `domain/relogio.ts` — **não** escreva
régua nova de porcentagem nem de data.

⚠️ **O teto de 2000 caracteres vale aqui também** (`LIMITE_MENSAGEM`): o Discord **recusa a mensagem
inteira** se passar. Uma regra com 30 postos estoura. Corte a lista e diga quantos ficaram de fora
("… e mais 12 postos"), reaproveitando o que `mensagens.ts` já faz para isso.

- [ ] **Passos 1 a 5.** Teste: um posto · vários · lista que estoura o limite · o corte dizendo
      quantos sobraram.

---

### Task 4: Migração — as colunas e a saída única no `alerta_avaliar`

**Arquivo:** criar `supabase/migrations/0141_alertas_resumo_diario.sql` (confira o número livre).

**Leia antes:** `0139_alertas_intervalos.sql` inteira — ela é o molde mais recente e mostra como
este projeto recria essas duas funções declarando diferença por diferença.

**O esquema:**
- `alerta_regras` ganha `hora_resumo time` e `resumo_enviado_em date`
- o check de `janela_tipo` aceita o que a Task 2 apurou para o `resumo`
- um check: `tipo <> 'resumo' or hora_resumo is not null`

**A lógica — e aqui está o ponto do plano:**

⚠️ **O resumo entra por UMA saída no topo do laço, com `continue` logo depois.** O caminho da
ocorrência (mínimo de bipes → `v_abaixo` → `select ... for update` → abrir/normalizar/insistir)
**não ganha nenhuma condição nova** e **nunca vê** uma regra de resumo.

```sql
    if t.tipo = 'resumo' then
      -- O app já decidiu que é hora (p_resumos traz só as regras prontas). Aqui: monta as linhas,
      -- enfileira e grava a data. NUNCA cai no caminho da ocorrência — relatório não abre nem fecha.
      ...
      continue;
    end if;
```

**Por que assim, e não com `if t.tipo <> 'resumo'` espalhado:** seriam seis condições numa função de
~400 linhas sem teste de unidade, e esquecer qualquer uma produz defeito silencioso — ocorrência
fantasma de relatório, "Resolvido" num relatório, ou reenvio a cada 5 minutos. Escreva esse motivo
no comentário.

**O contrato novo:** `alerta_avaliar(p_canal_discord text, p_blocos jsonb, p_resumos jsonb)`.
`p_resumos` é `{"<regra_id>": true}` — só as regras cuja hora chegou e que ainda não mandaram hoje.
Regra de resumo ausente do mapa é **pulada**. Mesmo padrão do `p_blocos` da 0139.

**A data é gravada SÓ quando envia.** Dia sem nenhum posto com dado: **não envia e não grava** — e
aí tenta de novo amanhã. Gravar sem enviar faria o relatório sumir por um dia inteiro em silêncio.

⚠️ Assinatura nova é outra função: refaça os `revoke`/`grant` e dê `drop function if exists` na
antiga, **depois** do `create`. `notify pgrst` no fim.

- [ ] **Passos:** escrever · reler inteira respondendo, com a linha: (a) o resumo passa pelo caminho
      da ocorrência em algum ponto? (b) a data é gravada em algum caminho que não envia? (c) os três
      tipos antigos mudaram de comportamento? (d) é idempotente? · commit

---

### Task 5: Teste SQL no harness

**Arquivos:** criar `supabase/tests/alertas_resumo_test.sql`; estender `rodar-alertas-test.sh`.

**Leia** `alertas_intervalos_test.sql` — é o molde.

**Os casos que precisam existir:**
1. Regra de resumo no `p_resumos` → enfileira **uma** mensagem e grava a data
2. A mesma rodada de novo → **nada** (a regra sai do mapa quando já mandou)
3. Regra de resumo **ausente** do mapa → pulada, nada gravado
4. **Nenhum posto com dado** → não enfileira **e não grava a data**
5. Posto sem bipe **sai** da lista; os outros continuam
6. ⚠️ **O resumo NÃO cria ocorrência** — `select count(*) from alerta_ocorrencias` não muda
7. ⚠️ **Os três tipos antigos não mudaram** — um caso de cada, abrindo e normalizando como sempre

**Rode o runner** e diga o resultado real. Se falhar, o teste pegou algo: investigue e conserte a
migração.

**Prove por sabotagem** ao menos os casos 4 e 6.

---

### Task 6: Infra — decidir a hora no app e passar o mapa

**Arquivos:** `infra/regras-repository.ts`, `infra/repositorio-servico.ts`, testes

- o repositório lê e grava `hora_resumo` e `resumo_enviado_em`
- `avaliar()` monta `p_resumos` chamando `horaDeEnviarResumo` para cada regra de resumo ativa
- mantém `p_canal_discord` e `p_blocos`

⚠️ **Afirme o tipo** do que vem do banco antes de usar — se `hora_resumo` chegar em outro formato, o
resumo para de sair **sem log**. Registre no `console.error` com o id da regra, como a 0139 faz com
o `janela_valor`.

- [ ] **Passos 1 a 5**, afirmando os **argumentos** das chamadas, não só o efeito. ⚠️ Prove que os
      mocks pegam: um teste que **falha** quando o mock devolve erro.

---

### Task 7: Tela — o tipo novo no formulário

**Arquivos:** `src/app/(app)/configuracoes/sf-alertas/regra-form.tsx`, teste

**Leia o arquivo inteiro antes.** Siga o `JANELAS` (linha ~30), os rádios e o `Explica`.

1. O tipo **"Resumo diário"** no seletor de tipo
2. Com ele: campo **hora** (`<input type="time">`, padrão `18:00`) + o **editor de intervalos** que
   a 0139 já criou (reaproveite o componente, **não copie**)
3. **Somem**: taxa mínima, mínimo de bipes, lembrete, o grupo de rádios da Janela, limite de tempo,
   limite de ocorrências, prévia
4. **Ficam**: nome, postos, PMOs, destinatários, canais, ativa

- [ ] **Passos 1 a 5.** ⚠️ Prove que as asserções negativas **não são vacuosas**: sabote o portão de
      cada campo escondido e confirme que o teste falha. Nesta branch irmã uma asserção negativa
      passava vazia porque o elemento nunca era renderizado naquele tipo.

---

### Task 8: A lista de regras e a tela de Ocorrências

**Conferir, e só mexer se faltar.** A coluna "Limite" e a "Janela" precisam fazer sentido para o
resumo (ou mostrar "—"). E um resumo **nunca** aparece em Ocorrências, o que é correto — veja se
alguma contagem ou filtro da tela quebra com isso.

**Se já estiver certo, NÃO MEXA** — diga no relatório que conferiu. Commit só com o teste que prega
o comportamento é um resultado bom.

---

## Depois das tarefas

1. Revisão de branch inteira (modelo mais capaz).
2. 0141 no Dev → `docker compose restart rest` → smoke: criar uma regra de resumo, "Avaliar agora"
   antes e depois da hora, conferir que sai **uma vez** e que a lista bate com o Dashboard.
3. ⚠️ **Ordem de deploy: a migração ANTES do app.** A assinatura nova de `alerta_avaliar` derruba a
   anterior; app novo contra banco velho quebra o cron.
