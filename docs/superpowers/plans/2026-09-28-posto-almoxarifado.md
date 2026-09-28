# Posto Almoxarifado — Fase 1 (o posto e o bipe)

> **Para quem for executar:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans`, tarefa a tarefa. Os passos usam `- [ ]`.

**Objetivo:** criar o posto Almoxarifado, último da linha, onde o bipe do que foi embalado fica
registrado — a peça pelo número de série, a caixa coletiva pelo código — com as recusas que
impedem quantidade errada e estoque dobrado.

**Arquitetura:** um perfil novo (`almoxarifado`) no catálogo de perfis, que dá ao posto o painel e o
comportamento próprios, exatamente como a Integração e o Burn-in já funcionam. A decisão do que o
bipe é (série ou caixa) fica no domínio, em função pura; o que depende de dado — caixa fechada, já
lançada, reprovada — é validado no banco, numa RPC `security definer`, que é onde a corrida entre
dois operadores se resolve.

**Pilha:** Next.js 16 (App Router) · TypeScript · Postgres/Supabase · Vitest.

## Escopo

Este plano é a **Fase 1** e entrega o posto funcionando ponta a ponta dentro do ShopFloor.

**Fora deste plano, de propósito:** a fila de envio ao Compels, a idempotência do envio e a tela de
pendências. Eles dependem do endpoint do fornecedor, que ainda não é conhecido, e o formato da
carga muda conforme a resposta. Viram um plano próprio — a Fase 2 — quando o Valdeí responder. O
posto tem valor sem eles: é o último posto e encerra a peça no fluxo.

## Restrições globais

- **`AGENTS.md` do projeto:** esta versão do Next.js tem mudanças de API; leia o guia em
  `node_modules/next/dist/docs/` antes de escrever código de framework. Não confie na memória.
- **Toda migração é aditiva e idempotente:** `if not exists`, `create or replace`,
  `drop policy if exists`. Reaplicar não pode falhar nem mudar resultado.
- **Corpo de função com `$func$`**, nunca `$$` — o SQL Editor do Supabase recusa o de dois cifrões.
- **Toda função nova:** `revoke all ... from public, anon` e `grant execute ... to authenticated`,
  e a migração termina com `notify pgrst, 'reload schema';`.
- **RLS:** leitura por `tem_permissao('shopfloor', 'visualizar')`, escrita por `lancar`. A função de
  permissão é a de **dois argumentos** — a de um argumento anula o RBAC.
- **A próxima migração livre é a 0128.**
- **Português do Brasil** em tudo o que o operador lê. Mensagem de recusa diz o que aconteceu e o
  que fazer, nunca só "erro".
- **Rodar os testes com `--exclude "**/.claude/**"`** se houver worktree de agente na árvore.

---

### Task 1: o perfil `almoxarifado`

Um perfil novo no catálogo, para o posto ter comportamento próprio sem nenhum código olhar para o
nome dele. Sem isso, as tarefas seguintes não têm onde se pendurar.

**Arquivos:**
- Criar: `supabase/migrations/0128_sf_perfil_almoxarifado.sql`
- Modificar: `src/modules/shopfloor/domain/perfil-posto.ts` (tipo `RecursoPosto`)
- Testar: `src/modules/shopfloor/domain/__tests__/perfil-posto.test.ts`

**Interfaces:**
- Produz: o recurso `'almoxarifado'` no tipo `RecursoPosto`; a linha `almoxarifado` em
  `sf_posto_perfis`, atribuível no Cadastrar Posto.

- [ ] **Passo 1: escrever o teste que falha**

Em `src/modules/shopfloor/domain/__tests__/perfil-posto.test.ts`, acrescente:

```ts
describe('perfil almoxarifado', () => {
  const almoxarifado: PerfilPosto = {
    chave: 'almoxarifado', nome: 'Almoxarifado', temStatus: false, reprova: 'nenhum',
    gate: 'registrado', exigeManutencao: false, recurso: 'almoxarifado',
  }

  it('pode ser atribuído a um posto novo — não é singleton como a Manutenção', () => {
    expect(perfilAtribuivel(almoxarifado)).toBe(true)
  })

  it('não coleta status nem defeito: o bipe registra a entrada, não julga a peça', () => {
    expect(perfilTemStatus(almoxarifado)).toBe(false)
    expect(perfilPedeConfirmacaoConserto(almoxarifado)).toBe(false)
  })

  it('não entra no lançamento coletivo: a entrada é por peça ou por caixa, não por lista', () => {
    expect(perfilSuportaColetivo('almoxarifado')).toBe(false)
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run src/modules/shopfloor/domain/__tests__/perfil-posto.test.ts`
Esperado: FAIL — `'almoxarifado'` não é um `RecursoPosto`.

- [ ] **Passo 3: abrir o tipo no domínio**

Em `src/modules/shopfloor/domain/perfil-posto.ts`, troque a linha do tipo:

```ts
export type RecursoPosto = 'nenhum' | 'caixa' | 'nqa' | 'integracao' | 'burnin' | 'manutencao' | 'almoxarifado'
```

- [ ] **Passo 4: rodar e ver passar**

`npx vitest run src/modules/shopfloor/domain/__tests__/perfil-posto.test.ts` → PASS.

- [ ] **Passo 5: a migração**

Crie `supabase/migrations/0128_sf_perfil_almoxarifado.sql`:

```sql
-- =============================================================
-- Perfil "almoxarifado": o último posto da linha, onde o bipe do que foi embalado
-- registra a entrada no estoque.
--
-- Não tem status (não julga a peça) e não exige manutenção. O gate é 'registrado' e não
-- 'aprovado' porque a peça já foi aprovada antes de ser embalada — exigir aprovação de novo
-- recusaria tudo o que veio de um posto de passagem, como a própria Embalagem.
--
-- Atribuível no Cadastrar Posto: ao contrário da Manutenção, nada aqui depende do NOME do posto.
-- =============================================================

insert into public.sf_posto_perfis (chave, nome, tem_status, reprova, gate, exige_manutencao, recurso)
values ('almoxarifado', 'Almoxarifado', false, 'nenhum', 'registrado', false, 'almoxarifado')
on conflict (chave) do update
  set nome = excluded.nome,
      tem_status = excluded.tem_status,
      reprova = excluded.reprova,
      gate = excluded.gate,
      exige_manutencao = excluded.exige_manutencao,
      recurso = excluded.recurso;

notify pgrst, 'reload schema';
```

- [ ] **Passo 6: aplicar num Postgres descartável e conferir a idempotência**

```bash
docker run -d --name pg-almox -e POSTGRES_PASSWORD=t postgres:15-alpine
docker cp supabase/migrations/0128_sf_perfil_almoxarifado.sql pg-almox:/tmp/0128.sql
```

Como a 0128 depende da tabela da 0062, rode antes um `create table` mínimo de
`sf_posto_perfis` no container, aplique a 0128 **duas vezes** e confira que
`select count(*) from sf_posto_perfis where chave='almoxarifado'` devolve **1** nas duas.
Ao terminar: `docker rm -f pg-almox`.

- [ ] **Passo 7: commit**

```bash
git add supabase/migrations/0128_sf_perfil_almoxarifado.sql src/modules/shopfloor/domain/perfil-posto.ts src/modules/shopfloor/domain/__tests__/perfil-posto.test.ts
git commit -m "almoxarifado: o perfil do último posto"
```

---

### Task 2: o domínio do bipe — série ou caixa

A decisão do que foi bipado não precisa do banco: o formato basta. Isolar isso numa função pura é o
que permite testar as regras sem subir Postgres, e é onde a regra fica legível.

**Arquivos:**
- Criar: `src/modules/shopfloor/domain/almoxarifado.ts`
- Testar: `src/modules/shopfloor/domain/__tests__/almoxarifado.test.ts`

**Interfaces:**
- Consome: `separarCodigoCaixa` de `./caixa` (se não existir, acrescente-a lá, com teste — é lá
  que mora o formato do código).
- Produz:

```ts
export type TipoBipeAlmoxarifado = 'serie' | 'caixa'
export type RecusaBipeAlmoxarifado =
  | 'vazio'
  | 'caixa_aberta'          // CX[3] sem a quantidade: caixa que não fechou não tem quantidade
  | 'caixa_em_op_individual'
  | 'serie_em_op_coletiva'
export interface BipeAlmoxarifado {
  tipo: TipoBipeAlmoxarifado
  /** Série normalizada, quando o bipe é de peça. */
  serie: string
  /** Código completo da caixa, quando o bipe é de caixa. */
  codigoCaixa: string
  /** Quantidade que o bipe representa: 1 na peça, a qtd do código na caixa. */
  quantidade: number
}
export function classificarBipeAlmoxarifado(
  bipe: string,
  embalagemIndividual: boolean,
): { ok: true; bipe: BipeAlmoxarifado } | { ok: false; recusa: RecusaBipeAlmoxarifado }
```

- [ ] **Passo 1: escrever o teste que falha**

Crie `src/modules/shopfloor/domain/__tests__/almoxarifado.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { classificarBipeAlmoxarifado } from '../almoxarifado'

describe('classificarBipeAlmoxarifado', () => {
  it('numa OP individual, o bipe é a série e vale 1 unidade', () => {
    const r = classificarBipeAlmoxarifado('00043-00462-0015718', true)
    expect(r).toEqual({
      ok: true,
      bipe: { tipo: 'serie', serie: '00043-00462-0015718', codigoCaixa: '', quantidade: 1 },
    })
  })

  it('numa OP coletiva, o bipe é a caixa e vale a quantidade do próprio código', () => {
    const r = classificarBipeAlmoxarifado('CX[3][10]12345-PMO973', false)
    expect(r).toEqual({
      ok: true,
      bipe: { tipo: 'caixa', serie: '', codigoCaixa: 'CX[3][10]12345-PMO973', quantidade: 10 },
    })
  })

  it('recusa a caixa ainda aberta: sem quantidade fechada não há o que dar entrada', () => {
    expect(classificarBipeAlmoxarifado('CX[3]', false)).toEqual({ ok: false, recusa: 'caixa_aberta' })
  })

  it('recusa peça solta em OP coletiva — a entrada é por caixa', () => {
    expect(classificarBipeAlmoxarifado('00043-00462-0015718', false))
      .toEqual({ ok: false, recusa: 'serie_em_op_coletiva' })
  })

  it('recusa código de caixa em OP individual — ali não existe caixa', () => {
    expect(classificarBipeAlmoxarifado('CX[3][10]12345-PMO973', true))
      .toEqual({ ok: false, recusa: 'caixa_em_op_individual' })
  })

  it('recusa bipe vazio ou só espaço', () => {
    expect(classificarBipeAlmoxarifado('   ', true)).toEqual({ ok: false, recusa: 'vazio' })
  })

  it('a caixa reprovada no NQA é reconhecida como caixa — quem recusa é o banco, com o motivo', () => {
    const r = classificarBipeAlmoxarifado('CX[7]R[14]8498-PMOC14', false)
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run src/modules/shopfloor/domain/__tests__/almoxarifado.test.ts`
Esperado: FAIL — o módulo `../almoxarifado` não existe.

- [ ] **Passo 3: ler o que já existe antes de escrever**

Abra `src/modules/shopfloor/domain/caixa.ts` e confira os nomes exportados para separar o código da
caixa (`CX[seq][qtd]OP-PMO`, com o `R` da remontagem entrando depois do `seq`). **Reaproveite o que
estiver lá; não escreva um segundo parser de código de caixa.** Se faltar uma função para extrair a
quantidade, acrescente-a em `caixa.ts`, não aqui — é lá que mora o formato.

- [ ] **Passo 4: implementar**

Crie `src/modules/shopfloor/domain/almoxarifado.ts` com a decisão em três degraus: bipe vazio →
`vazio`; começa com `CX[` → é caixa (sem quantidade no código → `caixa_aberta`; OP individual →
`caixa_em_op_individual`); senão → é série (OP coletiva → `serie_em_op_coletiva`).

**A série sai do domínio como foi bipada**, só com `trim` — e o teste acima manda exatamente isso.
Eu tinha escrito aqui "passa por `normalizarSerie`" e estava errado: `normalizarSerie` come o
prefixo de revenda (`00043-00462-0015718` vira `43004620015718`, porque ela lê o `00043` como zero
à esquerda de enchimento, e ele é código de revenda). O que a tela mostra tem de ser o que a pessoa
bipou.

Normalizar é assunto da Task 3, no banco, e lá vale a regra oposta: a comparação de duplicidade tem
de usar **a mesma normalização que o resto do sistema já usa** para gravar `numero_serie_norm`,
senão o "já lançado" não casa com as linhas que a Embalagem gravou.

A quantidade da caixa sai do próprio código — **nunca de um `select` na tabela**: o código impresso
é o que está colado na caixa física, e é ele que o operador bipou.

- [ ] **Passo 5: rodar e ver passar**

`npx vitest run src/modules/shopfloor/domain/__tests__/almoxarifado.test.ts` → 7 passando.

- [ ] **Passo 6: commit**

```bash
git add src/modules/shopfloor/domain/almoxarifado.ts src/modules/shopfloor/domain/__tests__/almoxarifado.test.ts
git commit -m "almoxarifado: o domínio decide se o bipe é peça ou caixa"
```

---

### Task 3: a RPC da entrada, com as recusas que dependem de dado

O que o formato não resolve, o banco resolve: caixa fechada?, já lançada?, reprovada no NQA?, a
peça passou pela Embalagem? Tudo numa transação — é o que impede dois operadores bipando a mesma
caixa ao mesmo tempo de dar entrada em dobro.

**Arquivos:**
- Criar: `supabase/migrations/0129_sf_almoxarifado_entrada.sql`
- Criar: `supabase/tests/almoxarifado_test.sql`
- Criar: `supabase/tests/rodar-almoxarifado-test.sh`

**Interfaces:**
- Produz: `sf_almoxarifado_entrada(p_pmo text, p_op text, p_posto text, p_colaborador text,
  p_bipe text, p_tipo text, p_quantidade int) returns jsonb` — devolve
  `{"ok": true, "quantidade": 10}` ou `{"ok": false, "motivo": "<chave>", "detalhe": "<texto>"}`.

**Motivos que a RPC devolve** (a tela traduz cada um numa frase):
`sem_permissao` · `ordem_nao_encontrada` · `posto_invalido` · `caixa_nao_encontrada` ·
`caixa_aberta` · `caixa_reprovada` · `ja_lancado` · `serie_fora_da_faixa` · `serie_sem_embalagem`

- [ ] **Passo 1: escrever os testes SQL que falham**

Crie `supabase/tests/almoxarifado_test.sql` no molde de `supabase/tests/recebimento_fluxo_test.sql`
(leia-o antes: ele tem os stubs de `tem_permissao` e o padrão de `do $t$ ... raise notice`).
Os casos, com a fixture montando uma OP coletiva e uma individual:

1. caixa fechada e nunca lançada → `ok: true` e `quantidade` igual à do código;
2. **a mesma caixa bipada de novo → `ja_lancado`**, e o `detalhe` traz quando e por quem;
3. caixa que existe mas está aberta → `caixa_aberta`;
4. caixa reprovada no NQA → `caixa_reprovada`;
5. série de OP individual que passou pela Embalagem → `ok: true`, `quantidade` 1;
6. série que existe na faixa mas **não tem registro na Embalagem** → `serie_sem_embalagem`;
7. série fora da faixa da OP → `serie_fora_da_faixa`;
8. a mesma série bipada duas vezes → `ja_lancado`;
9. sem `tem_permissao('shopfloor','lancar')` → `sem_permissao`;
10. OP inexistente → `ordem_nao_encontrada`.

Crie `supabase/tests/rodar-almoxarifado-test.sh` copiando o de recebimento, trocando os arquivos
copiados para o container e acrescentando o passo de **idempotência**: aplicar a 0129 duas vezes e
conferir que um caso conhecido continua devolvendo o mesmo resultado.

- [ ] **Passo 2: rodar e ver falhar**

`supabase/tests/rodar-almoxarifado-test.sh` → falha com `function sf_almoxarifado_entrada does not exist`.

- [ ] **Passo 3: escrever a migração**

Crie `supabase/migrations/0129_sf_almoxarifado_entrada.sql`. O cabeçalho explica **por que** cada
recusa existe (copie os motivos da spec, não invente novos). A função:

- `language plpgsql`, `security definer`, `set search_path = public`;
- primeira linha do corpo: `if not tem_permissao('shopfloor','lancar') then return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;`
  — **recusa como dado, não como `raise`**: o painel precisa mostrar a frase, e exceção vira erro
  genérico na tela;
- confere a ordem em `sf_ordens` por `(pmo, op)`;
- confere que `p_posto` existe em `sf_postos` **com perfil de recurso `almoxarifado`** — impede que
  a RPC seja chamada apontando para outro posto;
- **quando `p_tipo = 'caixa'`:** acha a caixa em `sf_caixas` por `(pmo, op, codigo)`; não achou →
  `caixa_nao_encontrada`; `fechada = false` → `caixa_aberta`; código com a marca de remontagem →
  `caixa_reprovada`; **já existe linha em `sf_registros` com esse `numero_caixa` neste posto** →
  `ja_lancado`, e o `detalhe` traz `data_hora` e `colaborador` daquela linha;
- **quando `p_tipo = 'serie'`:** confere a faixa da OP (`sn_ini`/`sn_fim`); exige linha em
  `sf_registros` com essa série num posto cujo perfil tenha recurso `caixa` (a Embalagem) → senão
  `serie_sem_embalagem`; **já existe linha com esse `numero_serie_norm` neste posto** →
  `ja_lancado`, com `data_hora` e `colaborador` no detalhe;
- grava em `sf_registros`. ⚠️ **Essa tabela não tem coluna de quantidade, e não deve ganhar uma:**
  a quantidade já vive no código da caixa (`CX[seq][qtd]…`) e em `sf_caixas.qtd`. O registro é um
  por bipe — uma linha para a peça, uma linha para a caixa. Colunas a preencher:

```sql
insert into public.sf_registros
  (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
values
  (p_colaborador, p_posto, p_pmo, p_op, v_cliente,
   case when p_tipo = 'caixa' then p_bipe else '' end,
   case when p_tipo = 'serie' then p_bipe else '' end,
   case when p_tipo = 'serie' then sf_serie_norm(p_bipe) else '' end);
```

  (confira o nome real da função de normalização de série nas migrações antes de usar — é a mesma
  que o Lançamento usa para gravar `numero_serie_norm`);
- o `status` fica **vazio**: o perfil não tem status, o bipe não julga a peça;
- **tudo numa transação só**, com `select ... for update` na caixa antes de gravar: é o que resolve
  dois operadores bipando junto.

Feche com os `revoke`/`grant` e `notify pgrst, 'reload schema';`.

- [ ] **Passo 4: rodar e ver passar**

`supabase/tests/rodar-almoxarifado-test.sh` → todos os `notice` de ok, e a idempotência ok.

- [ ] **Passo 5: commit**

```bash
git add supabase/migrations/0129_sf_almoxarifado_entrada.sql supabase/tests/almoxarifado_test.sql supabase/tests/rodar-almoxarifado-test.sh
git commit -m "almoxarifado: a RPC de entrada e as recusas que dependem de dado"
```

---

### Task 4: o painel do posto no Lançamento

**Arquivos:**
- Criar: `src/app/(app)/shopfloor/operar/lancamento/almoxarifado-panel.tsx`
- Criar: `src/modules/shopfloor/application/almoxarifado-actions.ts`
- Modificar: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`
- Testar: `src/app/(app)/shopfloor/operar/lancamento/__tests__/almoxarifado-panel.test.tsx`

**Interfaces:**
- Consome: `classificarBipeAlmoxarifado` (Task 2) e a RPC `sf_almoxarifado_entrada` (Task 3).
- Produz: `registrarEntradaAlmoxarifado(entrada: { pmo: string; op: string; posto: string;
  colaborador: string; bipe: string }): Promise<{ ok: true; quantidade: number; tipo: 'serie' | 'caixa' }
  | { ok: false; erro: string }>`.

- [ ] **Passo 1: escrever os testes que falham**

Em `__tests__/almoxarifado-panel.test.tsx`, com a action mockada (molde:
`src/app/(app)/recebimento/fluxo/__tests__/fluxo-form.test.tsx`):

1. bipar uma série numa OP individual chama a action com o texto bipado e mostra **"1 peça"** no
   painel de resultado;
2. bipar um código de caixa numa OP coletiva mostra **"10 peças"**;
3. recusa devolvida pela action aparece **na tela, com a frase inteira**, e o campo continua focado
   para o próximo bipe;
4. o campo é limpo depois do bipe aceito — e **não** depois do recusado, para a pessoa ver o que
   bipou.

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run "src/app/(app)/shopfloor/operar/lancamento" --exclude "**/.claude/**"`

- [ ] **Passo 3: a server action**

Crie `almoxarifado-actions.ts` com `'use server'`, o gate
`podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')`, a chamada de
`classificarBipeAlmoxarifado` antes de ir ao banco (recusa de formato não precisa de round-trip) e,
passando, a RPC. Traduza **cada motivo** numa frase de operador. Exemplos, e mantenha este tom:

- `caixa_aberta` → "Esta caixa ainda não foi fechada. Feche a caixa na Embalagem antes de dar entrada."
- `ja_lancado` → "Esta caixa já deu entrada em 28/09 às 14:20, por João."
- `serie_sem_embalagem` → "Esta peça ainda não passou pela Embalagem."
- `serie_em_op_coletiva` → "Nesta OP a entrada é por caixa. Bipe o código da caixa."

- [ ] **Passo 4: o painel**

Crie `almoxarifado-panel.tsx` no molde do `integracao-panel.tsx`: campo único com foco automático,
`PainelResultado` grande (é tela de bipe — a UX travada do projeto é painel fixo, não toast), e o
rastro dos últimos bipes da sessão com a quantidade de cada um.

⚠️ **Reentrância:** trave o envio enquanto a action estiver em voo e **não** limpe o campo antes da
resposta. Foi exatamente essa fresta que engoliu bipe no Abastecimento (`2565526`): o reset pintava
na tela um desenho antes do fim do envio, e o bipe que caísse ali sumia sem aviso.

- [ ] **Passo 5: ligar no Lançamento**

Em `lancamento-form.tsx`, ao lado de `ehIntegracao` / `ehEmbalagem`, acrescente
`const ehAlmoxarifado = posto !== '' && perfilDo(posto).recurso === 'almoxarifado'` e renderize o
painel novo no mesmo ponto em que os outros são escolhidos.

- [ ] **Passo 6: rodar e ver passar**

`npx vitest run "src/app/(app)/shopfloor/operar/lancamento" --exclude "**/.claude/**"`

- [ ] **Passo 7: commit**

```bash
git add "src/app/(app)/shopfloor/operar/lancamento" src/modules/shopfloor/application/almoxarifado-actions.ts
git commit -m "almoxarifado: o painel do posto e as recusas em português de operador"
```

---

### Task 5: o segundo QR na folha da caixa

**Arquivos:**
- Modificar: `src/modules/shopfloor/application/embalagem-actions.ts` (junto de `qrDaCaixa`)
- Modificar: `src/app/(app)/shopfloor/analisar/caixas/caixas-form.tsx` (a folha)
- Modificar: `src/app/(app)/shopfloor/operar/lancamento/embalagem-panel.tsx` (o Fechar caixa)
- Testar: `src/modules/shopfloor/application/__tests__/qr-codigo-caixa.test.ts`

**Interfaces:**
- Produz: `qrCodigoDaCaixa(pmo, op, posto, seq): Promise<{ ok: true; svg: string; codigo: string } | { ok: false; erro: string }>`

- [ ] **Passo 1: o teste que falha**

O QR novo carrega **só o código final da caixa** — uma linha, nada de lista de séries. Teste que,
para uma caixa fechada, `conteudo` é exatamente o código, e que caixa **aberta** devolve erro: sem
código final não há o que imprimir.

- [ ] **Passo 2: rodar e ver falhar.**

- [ ] **Passo 3: implementar**

Em `embalagem-actions.ts`, ao lado de `qrDaCaixa`, acrescente `qrCodigoDaCaixa` — mesma biblioteca,
mesmo SVG no servidor, mesmo gate de permissão. **Não mexa no `qrDaCaixa`:** ele continua com a
lista de séries, que é a conferência pelo celular que a fábrica usa hoje.

- [ ] **Passo 4: a folha**

Em `caixas-form.tsx`, coloque o QR novo **pequeno, ao lado** do grande, com o código legível
embaixo dele em fonte monoespaçada — se o leitor falhar, alguém consegue conferir com o olho.

- [ ] **Passo 5: sair em toda caixa fechada**

No `embalagem-panel.tsx`, depois do "Fechar caixa" dar certo, abra a folha pronta para imprimir.
⚠️ **Navegador não imprime em silêncio:** vai passar pelo diálogo do sistema, e isso é inevitável
enquanto a impressão for pelo navegador. Deixe o botão em evidência em vez de esconder num menu.

- [ ] **Passo 6: rodar e ver passar. Passo 7: commit.**

```bash
git commit -m "almoxarifado: a folha da caixa ganha o QR do código, ao lado do QR das séries"
```

---

### Task 6: o Almoxarifado no Fluxo da OP

**Arquivos:**
- Modificar: `src/modules/shopfloor/domain/fluxo-op.ts`
- Modificar: `src/app/(app)/shopfloor/fluxo/fluxo-node.tsx` (ícone do recurso)
- Testar: `src/modules/shopfloor/domain/__tests__/fluxo-op.test.ts`

- [ ] **Passo 1: o teste que falha**

Numa OP que tenha o posto de almoxarifado no fluxo, ele aparece **depois da Embalagem** e a caixa
"Concluído" passa a contar o que passou por ele. Numa OP **sem** esse posto, nada muda — as OPs
antigas não podem regredir por causa de um posto que elas não têm.

- [ ] **Passo 2: rodar e ver falhar. Passo 3: implementar. Passo 4: rodar e ver passar.**

Em `fluxo-node.tsx`, acrescente o ícone do recurso novo em `iconePorRecurso` — use
`PackageCheck` de `lucide-react`, que é o mesmo do Concluído e diz "entrou no estoque".

- [ ] **Passo 5: commit**

```bash
git commit -m "almoxarifado: o posto entra no Fluxo da OP, depois da Embalagem"
```

---

## Depois das seis tarefas

1. **Revisão da branch inteira** com `superpowers:requesting-code-review`.
2. **Aplicar a 0128 e a 0129 no Dev** e fazer o smoke guiado: uma OP individual e uma coletiva,
   bipando certo, bipando duas vezes, bipando caixa aberta, bipando peça solta na coletiva.
3. **Só então** merge e deploy — com as duas migrações **antes** do app.

## O que este plano deixa para a Fase 2

A fila de envio ao Compels, a chave de idempotência do envio, a tela de pendências e o cron. Todos
dependem do endpoint do fornecedor. Quando o Valdeí responder, vira plano próprio — e o bipe já
estará gravando, então a Fase 2 só acrescenta o caminho de saída.
