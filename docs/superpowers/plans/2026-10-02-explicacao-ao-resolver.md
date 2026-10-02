# Explicação ao resolver uma ocorrência — plano de implementação

> **Para quem for executar:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> (recomendada) ou `superpowers:executing-plans`, tarefa a tarefa. Os passos usam `- [ ]`.

**Objetivo:** ao resolver uma ocorrência de alerta, a pessoa escreve (opcionalmente) o que fez — e
essa explicação chega a quem recebeu o alerta.

**Arquitetura:** as três portas que resolvem (tela, Discord, Telegram) caem na **mesma** função do
banco. A explicação entra como **parâmetro dela**, então nenhuma porta escapa e não há regra
duplicada. No Discord, o clique passa a abrir a caixa de texto nativa (o *modal*) antes de
resolver.

**Pilha:** Next.js 16 (App Router) · React 19 · TypeScript · Postgres/Supabase · Vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-explicacao-ao-resolver-design.md`

## Global Constraints

- **A branch nasce de `feat/melhorias-out01`**, que já traz a **0136**. A próxima migração livre é
  a **0137** — mas 0128–0135 estão em outras branches abertas; **confira antes de aplicar**.
- **Corpo de função com `$func$`, nunca o delimitador de dois cifrões — nem dentro de comentário.**
  O SQL Editor do Supabase recusa o arquivo.
- Migração aditiva e idempotente; `revoke all ... from public, anon` + grant explícito; termina com
  `notify pgrst, 'reload schema';`.
- Permissão é `tem_permissao` de **dois** argumentos — a de um **anula o RBAC**. O
  `usuario_tem_permissao(uuid, text, text)` de três é outra coisa (checa o destinatário) e é
  legítimo.
- ⚠️ **Os Alertas estão EM PRODUÇÃO com cron rodando.** Toda função recriada precisa de `diff -u`
  contra a versão anterior, com as diferenças declaradas no cabeçalho.
- **A explicação é OPCIONAL** (decisão do usuário). Vazio resolve igual, e a mensagem sai sem rabo.
- Português do Brasil em tudo que o usuário lê.
- Rodar teste só do que se toca, com `--exclude "**/.claude/**"` **e `--maxWorkers=2`** — com o
  padrão, esta máquina de 4 núcleos mata o processo (exit 137). **Nunca a suíte inteira.**
- **`npx next build` faz parte do teste** — é o único que pega as regras de `'use server'`.
- `git add` com caminhos **explícitos**.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0137_alertas_explicacao.sql` (criar) | a coluna, o parâmetro nas 3 funções, a explicação no aviso aos outros |
| `supabase/tests/alertas_explicacao_test.sql` (criar) | os casos da 0137 |
| `src/modules/alertas/domain/mensagens.ts` (modificar) | a explicação na linha de "resolvido por" |
| `src/modules/alertas/infra/discord.ts` (modificar) | o botão: `⚠️ Resolver`, fora do verde |
| `src/modules/alertas/application/webhook-discord.ts` (modificar) | clique abre o modal; o envio do modal resolve |
| `src/modules/alertas/application/alertas-actions.ts` (modificar) | a action leva a explicação |
| a tela de alertas (modificar) | botão amarelo "Resolver" + caixa de texto |

---

### Task 1: o banco guarda a explicação

**Arquivos:**
- Criar: `supabase/migrations/0137_alertas_explicacao.sql`
- Criar: `supabase/tests/alertas_explicacao_test.sql`
- Modificar: `supabase/tests/rodar-alertas-test.sh` (carregar a 0137 depois da 0136)

**Interfaces:**
- Consome: `alerta_resolver_interno(uuid, uuid, boolean)`, `alerta_resolver(uuid, uuid)` e
  `alerta_resolver_admin(uuid)` — as três na 0113, com a `_interno` **recriada pela 0136**
  (0136:518). **Parta da versão da 0136, não da 0113.**
- Produz: as três com um parâmetro `p_explicacao text` ao fim, e a coluna
  `alerta_ocorrencias.explicacao`.

**Contexto que você precisa:** as três portas (tela, Discord, Telegram) chegam na `_interno` por
dois invólucros — `alerta_resolver` (destinatário) e `alerta_resolver_admin` (gestor). É por isso
que o parâmetro entra **nela**: nenhuma porta escapa.

A `_interno` já monta o aviso de "resolvido por" para os outros destinatários (o `insert into
alerta_envios` por volta de 0113:696). **É nesse `dados` que a explicação precisa entrar**, senão
ela fica guardada e ninguém lê.

- [ ] **Passo 1: escreva os testes que falham**

Crie `supabase/tests/alertas_explicacao_test.sql` cobrindo:
- resolver **com** explicação grava a coluna e ela aparece no `dados` do envio de "resolvido";
- resolver **sem** explicação (string vazia e `null`) resolve igual, e o `dados` **não** ganha uma
  chave com texto vazio pendurado;
- a explicação sobrevive ao caminho do **admin** (`alerta_resolver_admin`) e ao do
  **destinatário** (`alerta_resolver`);
- resolver uma ocorrência **já resolvida** não sobrescreve a explicação da primeira vez.

Siga a forma de `supabase/tests/alertas_op_posicoes_test.sql`.

⚠️ **Use `is distinct from`, nunca `<>`, ao comparar `jsonb`.** Chave ausente faz o valor virar
NULL, `NULL <> x` é NULL, e o `if` **não dispara** — a mutação que apaga a chave passa batida.
Isso aconteceu de verdade na 0136 e o teste só pegou depois da troca.

- [ ] **Passo 2: faça o runner carregar a 0137**

Em `supabase/tests/rodar-alertas-test.sh`, acrescente a 0137 logo depois da 0136, no mesmo molde.

- [ ] **Passo 3: rode e veja falhar**

Run: `supabase/tests/rodar-alertas-test.sh`
Esperado: FALHA com `column "explicacao" does not exist` ou `function ... does not exist`.

- [ ] **Passo 4: escreva a 0137**

A migração faz, nesta ordem:

1. `alter table public.alerta_ocorrencias add column if not exists explicacao text not null default '';`
   — com comentário dizendo **por que vazio é o padrão**: é opcional, e toda ocorrência resolvida
   antes desta mudança não tem explicação nenhuma.
2. Recria `alerta_resolver_interno` **a partir da versão da 0136**, com `p_explicacao text default ''`
   ao fim: grava no `update` que marca a ocorrência como resolvida, e inclui no `dados` do envio de
   "resolvido" — **só quando não for vazia**.
3. Recria os dois invólucros com o parâmetro novo, repassando.
4. `revoke`/`grant` de **todas** as assinaturas novas, e `drop function if exists` das antigas
   (⚠️ **sem o drop, as duas assinaturas coexistem** e uma chamada sem o parâmetro cai na antiga,
   que não grava nada — a explicação sumiria em silêncio).
5. `notify pgrst, 'reload schema';` na última linha.

**No cabeçalho, declare as diferenças** contra a versão da 0136, para a revisão conferir por
`diff -u`.

- [ ] **Passo 5: rode e veja passar**

Run: `supabase/tests/rodar-alertas-test.sh`
Esperado: `ALERTAS SQL OK`, exit 0.

- [ ] **Passo 6: reaplique**

Rode o script de novo. Esperado: passa igual (só `NOTICE ... already exists, skipping`).

- [ ] **Passo 7: convenções e commit**

```bash
grep -c '\$\$' supabase/migrations/0137_alertas_explicacao.sql   # tem que dar 0
tail -1 supabase/migrations/0137_alertas_explicacao.sql          # notify pgrst
git add supabase/migrations/0137_alertas_explicacao.sql supabase/tests/alertas_explicacao_test.sql supabase/tests/rodar-alertas-test.sh
git commit -m "alertas(0137): quem resolve pode dizer o que fez, e os outros ficam sabendo"
```

---

### Task 2: o Discord abre a caixa de texto

**Arquivos:**
- Modificar: `src/modules/alertas/infra/discord.ts:25-45` (o botão)
- Modificar: `src/modules/alertas/application/webhook-discord.ts`
- Teste: o teste que já existe do `webhook-discord`

**Interfaces:**
- Consome: `montarCallbackResolver` / `lerCallbackResolver` de `../domain/codigos`, e
  `deps.repo.resolver(ocorrenciaId, usuarioId)` — que ganha a explicação como 3º argumento.

**Contexto que você precisa:**

Hoje, `webhook-discord.ts` trata `INTERACAO_COMPONENTE` (o clique no botão) **resolvendo na hora**
e respondendo com `type 7` (edita a mensagem clicada, tirando o botão).

Com o modal vira **duas** interações:
1. **clique no botão** → responder com **`type: 9`** (abrir modal), **sem resolver nada ainda**;
2. **envio do modal** (um tipo de interação novo para este arquivo) → ler o texto, resolver, e
   responder com o mesmo `type 7` de hoje.

O `custom_id` do modal precisa **carregar o id da ocorrência** até a segunda interação — é o único
caminho por onde ele atravessa. Reaproveite o `montarCallbackResolver`/`lerCallbackResolver`.

⚠️ **O Discord exige resposta em 3 segundos** (há constantes no arquivo que já tratam isso) e o
`type 9` **não aceita** `flags` nem conteúdo — só o modal.

⚠️ **O botão:** hoje é `style: 3` (verde), `✅`, `'Resolvido'`. Vira `⚠️`, `'Resolver'`, e **sai do
verde** — use `style: 2` (cinza). **Não existe amarelo no Discord**: os estilos são azul, cinza,
verde e vermelho. O amarelo que o usuário pediu é carregado pelo emoji.

- [ ] **Passo 1: escreva os testes que falham**

No teste do `webhook-discord`, cubra:
- clique no botão responde `type: 9` e **não** chama `repo.resolver`;
- o envio do modal chama `repo.resolver` **com o texto digitado**;
- o envio do modal **com texto vazio** resolve igual (é opcional);
- o envio do modal responde `type: 7`, edita a mensagem e tira o botão, como hoje;
- conta não vinculada continua recusando, nos dois momentos.

- [ ] **Passo 2: rode e veja falhar**

Run: `npx vitest run src/modules/alertas --exclude "**/.claude/**" --maxWorkers=2`

- [ ] **Passo 3: implemente**

O botão em `discord.ts`, e os dois ramos em `webhook-discord.ts`. **Não mexa no que já funciona:**
o `efemera()`, o vínculo por comando, o `removerBotoesDaOcorrencia` e o adiantamento do aviso aos
outros ficam como estão.

- [ ] **Passo 4: rode e veja passar**

Run: `npx vitest run src/modules/alertas --exclude "**/.claude/**" --maxWorkers=2`

- [ ] **Passo 5: dentes**

Numa CÓPIA, troque o `type: 9` por resolver direto (como era antes) e confirme que o teste do
modal falha. Reporte a falha observada.

- [ ] **Passo 6: commit**

```bash
git add src/modules/alertas/infra/discord.ts src/modules/alertas/application/webhook-discord.ts src/modules/alertas/application/__tests__/
git commit -m "alertas: o botão do Discord pergunta o que foi feito antes de resolver"
```

---

### Task 3: a tela pede a explicação, e o botão deixa de parecer conclusão

**Arquivos:**
- Modificar: `src/modules/alertas/application/alertas-actions.ts:166` (`resolverOcorrenciaAction`)
- Modificar: `src/modules/alertas/domain/mensagens.ts` (a linha de "resolvido por")
- Modificar: a tela que lista as ocorrências (ache por `resolverOcorrenciaAction`)

**Interfaces:**
- Consome: `resolverOcorrenciaAction(id, explicacao)` — a assinatura ganha o 2º parâmetro.

**Contexto que você precisa:**

Na tela, **o amarelo existe de verdade** (diferente do Discord). O botão fica **amarelo, com ponto
de exclamação, escrito "Resolver"** — como o usuário descreveu.

**UX travada do projeto:** telas de bipe usam painel fixo grande; telas de gestor usam `toast`
(o `Toaster` global é `bottom-center`). Esta é de gestor.

A caixa de texto segue o padrão de diálogo que o repositório já usa — procure um `ConfirmDialog`
ou equivalente antes de montar um do zero.

- [ ] **Passo 1: escreva os testes que falham**

Cubra: o botão mostra "Resolver" (não "Resolvido") · clicar abre a caixa · confirmar com texto
chama a action com o texto · confirmar **vazio** também resolve · a linha de "resolvido por"
mostra a explicação quando há, e **não fica com rabo** quando não há.

- [ ] **Passo 2: rode e veja falhar**

Run: `npx vitest run src/modules/alertas "src/app/(app)" --exclude "**/.claude/**" --maxWorkers=2`

(Ajuste o segundo caminho para a pasta da tela, quando você a localizar.)

- [ ] **Passo 3: implemente**

A action, a frase e a tela.

- [ ] **Passo 4: rode e veja passar, com build**

```bash
npx vitest run src/modules/alertas "src/app/(app)" --exclude "**/.claude/**" --maxWorkers=2
npx tsc --noEmit
npx next build
```

- [ ] **Passo 5: commit**

```bash
git add src/modules/alertas src/app
git commit -m "alertas: resolver pela tela também pergunta o que foi feito"
```

---

## Depois das três tarefas

1. Revisão da branch com `superpowers:requesting-code-review`, com atenção ao `diff -u` das três
   funções recriadas contra a versão da 0136.
2. **Conferir a numeração da 0137** contra o que já tiver mergeado.
3. Smoke: resolver pela tela com e sem texto · resolver pelo Discord com e sem texto · conferir que
   **os outros destinatários recebem a explicação** · e que o Telegram continua resolvendo como
   hoje (sem perguntar — é o caso opcional, e está dentro do combinado).
