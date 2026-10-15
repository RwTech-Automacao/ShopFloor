# Aviso de fim de EMB — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando todos os processos de uma EMB chegam ao fim do fluxo, mandar por e-mail, Discord e Telegram a lista das divergências de quantidade daquela EMB com as justificativas de cada uma (ou a marca de que ninguém justificou) — e, quando a EMB fecha sem nenhuma divergência, avisar que ela terminou e que terminou **sem divergência** —, como um tipo de regra do módulo de Alertas.

**Architecture:** Nada de sistema de notificação novo. A feature entra em três camadas do módulo de Alertas que já roda em produção: (1) `alerta_regras` ganha a coluna `modulo`, a tela de Alertas passa a existir em duas rotas (`/configuracoes/sf-alertas` e `/configuracoes/rec-alertas`) servidas pelo **mesmo componente**, que recebe `modulo` por prop, e o RBAC sai de graça do mecanismo declarativo do menu; (2) um `TipoRegra` novo, `'emb'`, avaliado no cron de 5 minutos, com uma marca de "já avisei" por `(regra, EMB)` na tabela `alerta_emb_avisada`; (3) `Canal` ganha `'email'`, entregue por SMTP, com o endereço vindo de `usuarios.email`.

**Tech Stack:** Next.js 16 (App Router, Server Components + server actions), TypeScript, Supabase/Postgres (RLS + funções `security definer` + fila `alerta_envios`), Vitest + @testing-library/react, Tailwind v4, nodemailer (dependência nova, só no servidor), harness SQL em Docker (`supabase/tests/`).

**Spec (fonte da verdade):** `docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md`

---

## ⚠️ Corrigido em 14/10/2026 — a decisão 5 da spec foi revertida pelo usuário

A versão original deste plano (09/10) carregava a decisão 5 **antiga**: *"EMB que fecha sem nenhuma
divergência não manda nada"*. O usuário reverteu antes da implementação começar:

> **Toda EMB que fecha manda mensagem.** Com divergência, a mensagem lista as divergências e as
> justificativas. Sem divergência, ela avisa que a EMB terminou **e que terminou sem divergência**.

A spec está corrigida no lugar — ver o bloco "⚠️ **CORRIGIDO EM 14/10/2026**" dela e os itens 4 e 5
das listas do fim. Este plano foi corrigido no lugar também, nos 15 lugares abaixo; nenhuma frase
da versão antiga ficou de pé:

| Onde | O que mudou |
|---|---|
| Goal | a EMB limpa passa a mandar |
| Estrutura de arquivos, tabela dos testes SQL | o caso 4 deixou de ser "EMB limpa não manda" |
| "Decisões de desenho", item 5 | era *"EMB limpa também recebe a marca (sem enviar)"*; virou *"a marca tem um critério só: algo entrou na fila"* |
| Pedaço 2, apresentação | o conteúdo inclui o aviso de EMB limpa |
| Task 4, Interfaces (contrato do `dados`) | fica escrito que a EMB limpa enfileira com `divergencias: []` |
| Task 4, mapa dos testes (cabeçalho do arquivo de teste) | a linha do T4 |
| Task 4, teste T4 | era "não manda e recebe a marca"; virou "manda a mensagem de EMB limpa e recebe a marca", com o `dados` conferido |
| Task 4, cabeçalho da 0150 | o comentário dizia que EMB limpa não manda nada |
| Task 4, Step 5 (comentário da coluna `divergencias` da marca) | a auditoria não responde mais "por que esta EMB não gerou mensagem?" — toda EMB fechada gera |
| Task 4, Step 7 (bloco de diferenças declaradas) | a marca tinha DOIS casos; agora tem UM |
| Task 4, Step 7 (laço do `alerta_avaliar`) | o `if jsonb_array_length(v_divs) > 0` que **pulava** a EMB limpa saiu; o `dados` e o fan-out agora valem para toda EMB fechada, e a gravação da marca virou `if v_emb_n > 0` |
| Task 4, Step 10 (mensagem de commit) | duas frases |
| Task 5, `textoEmb` (contrato, docstring, implementação) + teste | ganha a mensagem própria da EMB limpa (antes a lista vazia só devolvia o cabeçalho, como defesa de um caso que o banco nunca enfileirava) |
| Task 6, texto da tela | dizia ao gestor que EMB sem divergência não manda nada |
| Autorrevisão (cobertura da spec) | as três linhas que citavam a decisão antiga |

**Efeito colateral bom, já registrado na spec:** a decisão **dissolve a pergunta da marca de "já
avisei"**. Se toda EMB fechada manda mensagem, toda EMB fechada (e com alguém alcançável) recebe a
marca — não existe mais o caso ambíguo de uma EMB que fecha, não manda nada, e depois ganha uma
divergência por uma edição de quantidade.

⚠️ **Para quem for implementar:** se encontrar neste plano, no código ou num teste qualquer frase
dizendo que EMB sem divergência não manda nada, é a decisão antiga ressurgindo — **pare e confira a
spec**. Este repositório já teve um defeito em produção causado por um documento que continuou
afirmando o que deixou de ser verdade.

---

## Global Constraints

Valem para **todas** as tarefas. Os requisitos de cada tarefa incluem esta seção implicitamente.

- **Idioma:** tudo em português do Brasil — código, nomes de variáveis, comentários, mensagens de commit, textos de UI e de mensagem enviada.
- **Migrações:** idempotentes (`add column if not exists`, `create table if not exists`, `create or replace function`, `drop constraint if exists` **antes** de `add constraint`, `drop policy if exists` antes de `create policy`). Corpo de função delimitado com `$func$` — **nunca** dois cifrões, nem dentro de comentário (o SQL Editor do Supabase rejeita o arquivo inteiro). Toda migração termina com `notify pgrst, 'reload schema';` (uma vez, na última linha). Cabeçalho explicando **o quê** e **o porquê**, no estilo da `0141_alertas_resumo_diario.sql`, incluindo as duas linhas de como aplicar (SQL Editor e `psql -1 -v ON_ERROR_STOP=1 -f`).
- **Numeração das migrações:** a próxima livre é **0149** (0145–0148 já existem em branches abertas). Este plano usa **0149**, **0150** e **0151**, uma por pedaço.
- **`create or replace` não troca função de assinatura diferente.** Toda vez que uma função ganha parâmetro, o `drop function if exists <assinatura antiga>` vem **depois** do `create` (padrão da 0141): sem isso a velha e a nova coexistem e a chamada curta fica ambígua (`function ... is not unique`).
- **Harness SQL:** toda migração nova entra em `supabase/tests/rodar-alertas-test.sh`, aplicada **duas vezes** com `-1 -v ON_ERROR_STOP=1` (prova de idempotência) antes de rodar o arquivo de teste dela.
- **Vitest:** sempre `npx vitest run --maxWorkers=2`. Sem `--maxWorkers=2` o processo morre com exit 137 (a máquina tem 4 núcleos). **Não existe `--reporter=basic`** nesta versão — não passe essa flag.
- **TDD:** cada tarefa escreve o teste, roda e **vê falhar**, implementa o mínimo, roda e **vê passar**, commita.
- **`git add` sempre com caminhos explícitos.** Nunca `git add -A`, nunca `git add .`.
- **Nada de `'use server'` exportando valor que não seja função.** Tipos e interfaces podem (são apagados na compilação); `const`, objetos e arrays **não**.
- **Branch:** `feat/alertas-fim-de-emb`, no worktree `/home/rwtech/Área de trabalho/ShopFloor-emb`. Não fazer push; não mergear.
- **Mensagem de commit:** em português, terminando com a linha `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Permissão (RBAC):** a régua é `podeNoModulo(perfil, <modulo da regra>, 'administrar')` no app e `tem_permissao(<modulo>, 'administrar')` / `usuario_tem_permissao(<usuario>, <modulo>, 'administrar')` no banco. **Nunca** `'shopfloor'` fixo em caminho novo.
- **Lançamento escondido:** `ALERTAS_LIBERADO_PARA` continua valendo para **as duas** rotas (é a mesma feature escondida). Nada de variável nova.
- **Texto de mensagem:** teto único de `LIMITE_MENSAGEM = 2000` caracteres UTF-16 para todos os canais, inclusive e-mail (o Discord **recusa** a mensagem inteira acima disso; o texto é o mesmo nos três canais, decisão da 0123). Corte sempre por `cortarUtf16` / `listaComCorte`.

---

## Estrutura de arquivos

### Migrações (novas)

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0149_alertas_modulo.sql` | `alerta_regras.modulo` + `alerta_envios.modulo` (retroativas para `'shopfloor'`), checks, trigger `MODULO_FIXO`, RLS por módulo, `alerta_destinatarios(p_modulo)`, `alerta_listar_ocorrencias(..., p_modulo)`, permissão **por módulo** no fan-out (`alerta_avaliar`, `alerta_resolver_interno`, `alerta_reservar_envios`). |
| `supabase/migrations/0150_alertas_fim_de_emb.sql` | Tipo de regra `'emb'`: checks por tipo, `postos` vazio permitido só nele, `rec_embs_fechadas`, `rec_emb_divergencias`, tabela `alerta_emb_avisada`, 5º ramo do cursor + bloco próprio no laço do `alerta_avaliar`, tipo de envio `'emb'`. |
| `supabase/migrations/0151_alertas_canal_email.sql` | Canal `'email'`: checks de canal, endereço de pessoa vindo de `usuarios.email` no fan-out e no `alerta_reservar_envios`, `alerta_destinatarios` devolve `email_ok`. |

### Testes SQL (novos)

| Arquivo | Responsabilidade |
|---|---|
| `supabase/tests/alertas_modulo_test.sql` | Caso 6 e caso 7 no banco: regra de um módulo não aparece no outro; quem administra só o Recebimento lê/grava as regras dele e não as do ShopFloor. |
| `supabase/tests/alertas_emb_test.sql` | Casos 1–5: EMB aberta não manda; EMB fechada manda; segunda rodada não manda (a marca); EMB limpa manda a mensagem de EMB limpa; EMB fechada por reprova manda. |
| `supabase/tests/alertas_email_test.sql` | Fan-out de e-mail sem `alerta_contas`; endereço vindo de `usuarios.email`; responsável sem e-mail fica fora. |

### TypeScript (novos)

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/alertas/domain/modulo.ts` | `ModuloAlerta`, `MODULOS_ALERTA`, `ehModuloAlerta`, `TIPOS_REGRA_POR_MODULO`, `ROTA_ALERTAS`. Regra pura, sem banco. |
| `src/modules/alertas/domain/emb.ts` | `DivergenciaEmb` (o item divergente como a mensagem precisa dele) e `textoEmb` (a mensagem do fim de EMB). |
| `src/modules/alertas/infra/email.ts` | Cliente SMTP (`criarEmail`) com a mesma forma dos clientes de Telegram/Discord. |
| `src/modules/alertas/ui/*` | A tela compartilhada pelas duas rotas (movida de `src/app/(app)/configuracoes/sf-alertas/`). |
| `src/app/(app)/configuracoes/rec-alertas/page.tsx` | A rota do Recebimento: carrega só o que é do Recebimento e passa `modulo="recebimento"`. |

### TypeScript (modificados)

`src/modules/alertas/domain/tipos.ts` · `domain/regra.ts` · `domain/envio.ts` · `domain/mensagens.ts` · `domain/postos-regra.ts` · `application/liberacao.ts` · `application/alertas-actions.ts` · `application/enviar-alertas.ts` · `infra/canais.ts` · `infra/fabrica.ts` · `infra/regras-repository.ts` · `infra/repositorio-servico.ts` · `src/shared/ui/app-shell.tsx` · `src/app/(app)/configuracoes/sf-alertas/page.tsx` · `.env.example` · `package.json`.

### Por que a tela compartilhada sai da pasta da rota

Hoje os componentes da tela moram em `src/app/(app)/configuracoes/sf-alertas/`. Com duas rotas, a pasta de **uma** rota não pode ser a casa da tela da **outra** (o `rec-alertas/page.tsx` importaria `../sf-alertas/alertas-tela`, e qualquer leitor concluiria que a tela do Recebimento é um apêndice da do ShopFloor). A tela passa a morar em `src/modules/alertas/ui/`, e as duas `page.tsx` ficam com três linhas cada: carregar os dados do módulo e montar `<AlertasTela modulo={...} />`. É a primeira pasta `ui/` de um módulo neste projeto — é o que a decisão 2 da spec pede (um componente, duas rotas) e está documentado no cabeçalho do arquivo.

### Como o componente sabe qual módulo está servindo (e por que nenhuma lista vaza)

Este é o ponto do caso de aceitação 6. São **quatro** camadas, não uma:

1. **A prop.** Cada `page.tsx` passa `modulo="shopfloor"` ou `modulo="recebimento"` para `AlertasTela`, e a prop desce inteira para `RegrasLista`, `RegraDialog`, `RegraForm`, `OcorrenciasLista` e `TipoEscolha`. Nenhum componente deriva o módulo do `usePathname()` — pathname é frágil e invisível para os testes.
2. **A consulta.** `listarRegras(modulo)` filtra `.eq('modulo', modulo)` no servidor. A tela nunca recebe a regra do outro módulo, então não há como mostrá-la.
3. **O RLS.** As três policies de `alerta_regras` passam a ser por módulo (`tem_permissao(modulo, 'administrar')`, escrita em duas pernas para o planejador manter o `InitPlan`). Quem administra só o Recebimento **não enxerga** linha de ShopFloor nem forçando a consulta.
4. **A action.** Toda server action recebe `modulo` e revalida `podeNoModulo(sessao.perfil, modulo, 'administrar')` + o tipo da regra pertencer àquele módulo (`TIPOS_REGRA_POR_MODULO`). Um `modulo` forjado no cliente só consegue o que a pessoa já podia fazer; e, na gravação, o banco ainda tem o check `modulo × tipo` e o trigger `MODULO_FIXO`.

Camadas 2 e 3 são independentes de propósito: a 2 erra mostrando lista vazia, a 3 erra negando. Nenhuma das duas erra mostrando a regra do vizinho.

---

## Decisões de desenho que o plano fecha (e que a spec não detalhou)

A spec travou 8 decisões; nenhuma é reaberta aqui. Estas são consequências dela que precisavam de forma concreta — estão registradas para o revisor conferir, não para rediscutir:

1. **Responsável = quem administra o MÓDULO da regra.** A spec diz "igual às regras do ShopFloor — escolhidos na própria regra... podendo ser as pessoas responsáveis pelo Recebimento" (decisão 6). Hoje `alerta_destinatarios` e o fan-out exigem `shopfloor.administrar` fixo. Passam a exigir a permissão do **módulo da regra**.
2. **`alerta_envios.modulo`.** A linha da fila de uma regra de fim de EMB nasce **sem ocorrência** (como o resumo diário), então o `alerta_reservar_envios` não tem como descobrir o módulo pela ocorrência. O módulo é **congelado na linha**, no mesmo espírito do `destino_externo_id` da 0123. Sem isso o e-mail do Recebimento ficaria pendente 24 h e expiraria **em silêncio**.
3. **A marca de "já avisei" é uma tabela, não uma coluna.** O resumo diário guarda uma data por regra (`resumo_enviado_em`) porque o evento é "o dia". Aqui o evento é "esta EMB", e são muitas por regra: `alerta_emb_avisada (regra_id, emb)`. É o **mesmo mecanismo** (estado gravado no banco, na mesma transação do enfileiramento, só depois de enfileirar) na forma que o grão exige.
4. **Piso `rg.criado_em`.** Na primeira rodada, *todas* as EMBs históricas já fechadas atenderiam ao gatilho e sairia uma avalanche. Só entram as EMBs cuja última finalização é **igual ou posterior à criação da regra** — a mesma ideia do `criado_em` que o resto do módulo já usa. Mais um teto de 50 EMBs por rodada, como cinto e suspensório.
   > **Atualização 15/10/2026:** o piso sozinho não cobria regra reativada depois de semanas nem regra sem ninguém alcançável por dias (a marca só nasce quando algo entra na fila — tudo fechado desde a criação avisava de uma vez). Foi acrescentado um **teto de idade de 3 dias** (`v_teto_idade`, na 0150 e na cópia da 0151): EMB fechada há mais que isso não avisa e não é marcada.
5. **A marca de "já avisei" tem um critério só: algo entrou na fila.** A decisão 5 da spec (corrigida em 14/10/2026) é que **toda EMB que fecha manda mensagem** — sem divergência, dizendo que fechou limpa. Isso **dissolve** a pergunta que este item existia para responder: como toda EMB fechada enfileira, toda EMB fechada recebe a marca, e o critério volta a ser exatamente o do resumo diário (gravar depois de enfileirar, e só se algo foi enfileirado). EMB **com ninguém alcançável** — responsável sem conta vinculada — continua **sem** marca e volta na próxima rodada, agora com ou sem divergência. ⚠️ A versão de 09/10 deste item dizia o contrário: *"EMB limpa também recebe a marca"*, **mesmo sem enviar nada**, porque partia da decisão antiga de que a EMB limpa não mandava mensagem. Essa exceção não existe mais. ⚠️ Consequência a conferir no smoke: uma regra cujos responsáveis nunca vincularam conta nunca marca nada, e o log do `raise log` passa a sair também para EMB limpa (é o mesmo rastro, com `divergencias = 0`).
6. **A regra de fim de EMB não tem janela: ela guarda `janela_tipo = 'op'` com `janela_valor` nulo.** É o padrão explícito que a spec manda seguir ("o resumo diário já abriu esse caminho... força `janelaTipo = 'intervalos'` mesmo que o formulário mande outra coisa"). O ramo `'op'` dos dois checks de `janela_valor` já aceita valor nulo, então **nenhum** deles é mexido — acrescentar um 5º `janela_tipo` obrigaria a reescrever os dois checks e o `JanelaTipo` do domínio por um valor que ninguém mede. A coluna "Janela" da lista mostra a frase própria **"Quando a EMB fecha"** (`resumoJanelaRegra`), nunca o valor cru.
7. **O assunto do e-mail é a primeira linha do texto.** `PortaCanal.enviar` entrega um texto só, igual para os três canais (0123). O cliente de e-mail parte o texto na primeira quebra de linha: a primeira linha vira o assunto, o resto vira o corpo. Zero mudança de assinatura, zero texto específico de canal.
8. **`nodemailer` como cliente SMTP.** Não há cliente SMTP no projeto. Escrever um à mão (STARTTLS, AUTH, dot-stuffing, codificação de cabeçalho) é muito mais código sem teste do que vale. ⚠️ **Antes de começar o Pedaço 3, confirmar no servidor as credenciais SMTP do GoTrue** (a própria spec pede isso).
9. **Escopo mantido pequeno de propósito:** `alerta_resolver_admin` e `alerta_resolver` (webhook do botão "Resolvido") continuam exigindo `shopfloor.administrar`. Nenhuma regra do Recebimento abre ocorrência, então esses caminhos nunca veem uma — YAGNI, com o motivo escrito no cabeçalho da 0149.

---

# PEDAÇO 1 — Alertas do Recebimento

Entregável do pedaço: a tela de Alertas existe em duas rotas, cada uma listando só as regras do seu
módulo, com o RBAC saindo do mecanismo declarativo do menu. **Ainda sem tipo de regra próprio do
Recebimento** — é o que a spec manda entregar primeiro.

---

### Task 1: Migração 0149 — a regra (e a linha da fila) ganham módulo

**Files:**
- Create: `supabase/migrations/0149_alertas_modulo.sql`
- Create: `supabase/tests/alertas_modulo_test.sql`
- Modify: `supabase/tests/rodar-alertas-test.sh` (acrescentar o bloco da 0149 no fim, antes do `echo "ALERTAS SQL OK"`)

**Interfaces:**
- Consumes: nada (primeira tarefa).
- Produces, para as tarefas seguintes:
  - `public.alerta_regras.modulo text not null default 'shopfloor'` — valores `'shopfloor'` | `'recebimento'`.
  - `public.alerta_envios.modulo text not null default 'shopfloor'` — o módulo **congelado** no enfileiramento.
  - `public.alerta_destinatarios(p_modulo text default 'shopfloor')` → `table (usuario_id uuid, nome text, email text, telegram boolean, discord boolean)`.
  - `public.alerta_listar_ocorrencias(p_de timestamptz, p_ate timestamptz, p_estado text default '', p_modulo text default 'shopfloor')` → as 25 colunas de hoje, sem acréscimo.
  - `raise exception 'MODULO_FIXO'` quando um update tenta mudar `alerta_regras.modulo`.
  - `public.alerta_avaliar(p_canal_discord text, p_blocos jsonb, p_resumos jsonb)` — mesma assinatura, agora com `rg.modulo` no cursor e `t.modulo` na permissão do fan-out.

- [ ] **Step 1: Ler as três fontes antes de escrever uma linha**

Leia, nesta ordem, e não comece sem ter lido:
1. `supabase/migrations/0141_alertas_resumo_diario.sql` inteira — é o modelo de cabeçalho, de ordem
   dos checks, de "⚠️ FUNÇÃO EM PRODUÇÃO QUE ESTE TRECHO RECRIA, E AS ÚNICAS DIFERENÇAS DECLARADAS"
   e do `drop function` depois do `create`. **O corpo do `alerta_avaliar` que esta migração recria é
   o da 0141** (é a versão viva).
2. `supabase/migrations/0113_alertas.sql` linhas 75–118 (tabela `alerta_regras` e as três policies)
   e 175–200 (tabela `alerta_envios`).
3. `supabase/migrations/0137_alertas_explicacao.sql` linhas 232–283 (`alerta_listar_ocorrencias`
   viva) e 100–170 (`alerta_resolver_interno` viva) · `supabase/migrations/0123_alertas_canal.sql`
   linhas 360–431 (`alerta_reservar_envios` viva) · `supabase/migrations/0115_alertas_tipos.sql`
   linhas 902–931 (`alerta_destinatarios` viva).

- [ ] **Step 2: Escrever o teste SQL, que ainda vai falhar**

Crie `supabase/tests/alertas_modulo_test.sql`. Ele roda **depois** de `alertas_resumo_test.sql`, na
mesma base, com a 0149 aplicada por cima de tudo. Começa desativando as regras dos testes
anteriores, como o arquivo do resumo faz.

```sql
-- Testes SQL da 0149 (módulo da regra de alerta). Rodar com supabase/tests/rodar-alertas-test.sh:
-- DEPOIS de alertas_resumo_test.sql, na mesma base, com a 0149 por cima de tudo.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE: o caso de aceitação 6 da spec ("a regra do Recebimento NÃO
-- aparece na tela do ShopFloor, e vice-versa") e o 7 ("quem administra só o Recebimento consegue
-- usar") são RLS e permissão — nenhum teste de vitest os enxerga. A tela filtra por módulo na
-- consulta, mas é o RLS que impede o vazamento de verdade.
--
-- O mapa dos testes:
--   T0  esquema: as colunas nasceram com 'shopfloor' RETROATIVO nas linhas que já existiam;
--       as assinaturas novas são UMA só (as antigas sumiram);
--   T1  o check modulo x tipo recusa regra de Recebimento (nenhum tipo é dela ainda, na 0149);
--   T2  MODULO_FIXO: update que muda o módulo é recusado;
--   T3  ⚠️ RLS: quem administra só o ShopFloor vê as regras de 'shopfloor' e NÃO vê as de
--       'recebimento' (caso 6); quem administra só o Recebimento vê o contrário (casos 6 e 7);
--   T4  alerta_destinatarios(p_modulo): a lista do Recebimento traz quem administra o
--       Recebimento e NÃO traz quem só administra o ShopFloor;
--   T5  alerta_listar_ocorrencias(..., p_modulo): só as ocorrências das regras daquele módulo, e
--       exige a permissão DAQUELE módulo;
--   T6  ⚠️ a fila congela o módulo: a linha enfileirada por uma regra de 'shopfloor' nasce com
--       modulo = 'shopfloor', e alerta_reservar_envios confere a permissão DESSA coluna;
--   T7  os tipos antigos continuam avaliando e enfileirando normalmente (nada regrediu).
-- (A idempotência da 0149 é do runner, por construção: ela é aplicada duas vezes.)

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- As regras dos testes anteriores saem do caminho e a fila antiga é dada por desistida.
update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- T0: as colunas e as assinaturas ----------
do $t$
begin
  -- Retroativo: NENHUMA regra que já existia pode ter ficado sem módulo.
  if exists (select 1 from public.alerta_regras where modulo is distinct from 'shopfloor') then
    raise exception 'T0 FALHOU: regra antiga sem modulo = shopfloor';
  end if;
  if exists (select 1 from public.alerta_envios where modulo is distinct from 'shopfloor') then
    raise exception 'T0 FALHOU: envio antigo sem modulo = shopfloor';
  end if;
  -- Uma assinatura só de cada função que ganhou parâmetro (a antiga tem de ter sumido).
  if (select count(*) from pg_proc where proname = 'alerta_destinatarios'
        and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'T0 FALHOU: alerta_destinatarios tem assinatura duplicada';
  end if;
  if (select count(*) from pg_proc where proname = 'alerta_listar_ocorrencias'
        and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'T0 FALHOU: alerta_listar_ocorrencias tem assinatura duplicada';
  end if;
end $t$;
\echo 'T0 (colunas retroativas e assinaturas unicas): ok'
```

Depois de T0, o arquivo cria dois usuários de teste e as regras, e segue com T1–T7. Escreva assim —
é o código completo, não um esboço:

```sql
-- ---------- massa: dois administradores de um módulo só ----------
-- Beto administra SÓ o Recebimento; Carla administra SÓ o ShopFloor. Ana (do teste da 0115)
-- administra o ShopFloor e tem conta nos dois canais.
insert into public.perfis (id, nome) values
  ('00000000-0000-0000-0000-0000000000b0', 'Gestor Recebimento'),
  ('00000000-0000-0000-0000-0000000000c0', 'Gestor ShopFloor')
on conflict (id) do nothing;
insert into public.perfil_permissao (perfil_id, modulo, permissao) values
  ('00000000-0000-0000-0000-0000000000b0', 'recebimento', 'administrar'),
  ('00000000-0000-0000-0000-0000000000c0', 'shopfloor',   'administrar')
on conflict do nothing;
insert into public.usuarios (id, nome, email, ativo, perfil_id) values
  ('00000000-0000-0000-0000-0000000000b1', 'Beto Recebimento', 'beto@x', true,
   '00000000-0000-0000-0000-0000000000b0'),
  ('00000000-0000-0000-0000-0000000000c1', 'Carla ShopFloor',  'carla@x', true,
   '00000000-0000-0000-0000-0000000000c0')
on conflict (id) do nothing;
insert into public.alerta_contas (usuario_id, canal, externo_id) values
  ('00000000-0000-0000-0000-0000000000b1', 'telegram', 'TG-BETO'),
  ('00000000-0000-0000-0000-0000000000c1', 'telegram', 'TG-CARLA')
on conflict (usuario_id, canal) do nothing;

-- Uma regra de cada módulo. A de Recebimento entra à força (nenhum tipo é dela na 0149): o teste
-- T1 prova que o check recusa pelo caminho normal, e aqui o insert desliga o check só para montar
-- a massa do T3/T4/T5 — é a única linha do arquivo que mexe em constraint.
insert into public.alerta_regras
  (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
   canais, destinatarios, ativa, criado_por)
values ('SF modulo', 'aprovacao', 'shopfloor', array['Teste'], 90, 'tempo', 60, 5,
        array['telegram'], array['00000000-0000-0000-0000-000000000001']::uuid[], true,
        '00000000-0000-0000-0000-000000000001');

alter table public.alerta_regras drop constraint alerta_regras_modulo_tipo;
insert into public.alerta_regras
  (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
   canais, destinatarios, ativa, criado_por)
values ('REC modulo', 'aprovacao', 'recebimento', array['Teste'], 90, 'tempo', 60, 5,
        array['telegram'], array['00000000-0000-0000-0000-0000000000b1']::uuid[], true,
        '00000000-0000-0000-0000-000000000001');
alter table public.alerta_regras add constraint alerta_regras_modulo_tipo check (coalesce(
  case modulo
    when 'shopfloor'   then tipo in ('aprovacao', 'tempo', 'defeito', 'resumo')
    when 'recebimento' then false
  end, false));
```

```sql
-- ---------- T1: o check modulo x tipo ----------
do $t$
begin
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
       canais, destinatarios, ativa, criado_por)
    values ('REC invalida', 'aprovacao', 'recebimento', array['Teste'], 90, 'tempo', 60, 5,
            array['telegram'], array['00000000-0000-0000-0000-0000000000b1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: o check deixou passar regra de recebimento com tipo do shopfloor';
  exception when check_violation then null;
  end;
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
       canais, destinatarios, ativa, criado_por)
    values ('Modulo inexistente', 'aprovacao', 'financeiro', array['Teste'], 90, 'tempo', 60, 5,
            array['telegram'], array['00000000-0000-0000-0000-000000000001']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T1 FALHOU: o check aceitou um modulo que nao existe';
  exception when check_violation then null;
  end;
end $t$;
\echo 'T1 (check modulo x tipo): ok'

-- ---------- T2: MODULO_FIXO ----------
do $t$
begin
  begin
    update public.alerta_regras set modulo = 'recebimento' where nome = 'SF modulo';
    raise exception 'T2 FALHOU: o modulo da regra mudou';
  exception when others then
    if sqlerrm not like '%MODULO_FIXO%' then raise; end if;
  end;
end $t$;
\echo 'T2 (MODULO_FIXO): ok'

-- ---------- T3: o RLS não deixa a lista vazar (casos 6 e 7) ----------
-- `set role authenticated` + teste.uid/teste.perms: é assim que o RLS é medido de verdade (como
-- superusuário as policies nem são avaliadas — a lição da 0096).
do $t$
declare v_sf int; v_rec int;
begin
  -- Carla: só ShopFloor.
  perform set_config('teste.uid', '00000000-0000-0000-0000-0000000000c1', false);
  perform set_config('teste.perms', 'shopfloor.administrar', false);
  set local role authenticated;
  select count(*) filter (where modulo = 'shopfloor'),
         count(*) filter (where modulo = 'recebimento')
    into v_sf, v_rec from public.alerta_regras;
  reset role;
  if v_sf = 0 or v_rec <> 0 then
    raise exception 'T3 FALHOU (shopfloor): sf=% rec=% (esperado sf>0 e rec=0)', v_sf, v_rec;
  end if;

  -- Beto: só Recebimento.
  perform set_config('teste.uid', '00000000-0000-0000-0000-0000000000b1', false);
  perform set_config('teste.perms', 'recebimento.administrar', false);
  set local role authenticated;
  select count(*) filter (where modulo = 'shopfloor'),
         count(*) filter (where modulo = 'recebimento')
    into v_sf, v_rec from public.alerta_regras;
  reset role;
  if v_rec <> 1 or v_sf <> 0 then
    raise exception 'T3 FALHOU (recebimento): sf=% rec=% (esperado sf=0 e rec=1)', v_sf, v_rec;
  end if;
end $t$;
select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
\echo 'T3 (RLS por modulo: a lista nao vaza): ok'
```

```sql
-- ---------- T4: alerta_destinatarios(p_modulo) ----------
do $t$
declare v_tem_beto boolean; v_tem_carla boolean;
begin
  perform set_config('teste.perms', 'recebimento.administrar', false);
  select bool_or(usuario_id = '00000000-0000-0000-0000-0000000000b1'),
         bool_or(usuario_id = '00000000-0000-0000-0000-0000000000c1')
    into v_tem_beto, v_tem_carla
    from public.alerta_destinatarios('recebimento');
  if not coalesce(v_tem_beto, false) or coalesce(v_tem_carla, false) then
    raise exception 'T4 FALHOU: a lista do Recebimento trouxe beto=% carla=%', v_tem_beto, v_tem_carla;
  end if;
  -- Sem a permissão DAQUELE módulo, a função recusa.
  perform set_config('teste.perms', 'shopfloor.administrar', false);
  begin
    perform * from public.alerta_destinatarios('recebimento');
    raise exception 'T4 FALHOU: quem nao administra o Recebimento leu a lista dele';
  exception when others then
    if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if;
  end;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
\echo 'T4 (alerta_destinatarios por modulo): ok'

-- ---------- T5: alerta_listar_ocorrencias(..., p_modulo) ----------
-- A ocorrência nasce na regra de shopfloor; a lista do Recebimento não pode trazê-la.
insert into public.alerta_ocorrencias
  (regra_id, posto, estado, taxa_abertura, taxa_ultima, valor_abertura, valor_ultimo, amostras)
select id, 'Teste', 'aberta', 80, 80, 80, 80, 10 from public.alerta_regras where nome = 'SF modulo';
do $t$
declare v_n int;
begin
  perform set_config('teste.perms', 'recebimento.administrar', false);
  select count(*) into v_n
    from public.alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day',
                                          '', 'recebimento');
  if v_n <> 0 then raise exception 'T5 FALHOU: a lista do Recebimento trouxe % ocorrencia(s) do ShopFloor', v_n; end if;

  perform set_config('teste.perms', 'shopfloor.administrar', false);
  select count(*) into v_n
    from public.alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day',
                                          '', 'shopfloor');
  if v_n < 1 then raise exception 'T5 FALHOU: a lista do ShopFloor perdeu a ocorrencia dele'; end if;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
\echo 'T5 (alerta_listar_ocorrencias por modulo): ok'
```

```sql
-- ---------- T6: a fila congela o módulo ----------
-- Enfileira à mão (o caminho real é testado em T7) e prova que (a) a coluna nasce com o módulo da
-- regra e (b) a reserva confere a permissão DESSA coluna, não 'shopfloor' fixo.
do $t$
declare v_regra uuid; v_envio uuid; v_n int;
begin
  select id into v_regra from public.alerta_regras where nome = 'REC modulo';
  insert into public.alerta_envios
    (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
  values (null, '00000000-0000-0000-0000-0000000000b1', 'telegram', 'resumo', 'recebimento',
          jsonb_build_object('regra_nome', 'REC modulo'), false, 'usuario')
  returning id into v_envio;

  set local role service_role;
  select count(*) into v_n from public.alerta_reservar_envios(array['telegram'], 100)
   where id = v_envio;
  reset role;
  -- Beto administra o Recebimento (não o ShopFloor): com a régua antiga a linha NUNCA sairia.
  if v_n <> 1 then
    raise exception 'T6 FALHOU: a linha de recebimento nao foi reservada (a regua ainda e shopfloor?)';
  end if;
end $t$;
\echo 'T6 (modulo congelado na fila e conferido na reserva): ok'

-- ---------- T7: nada regrediu nos tipos antigos ----------
-- A regra de aprovação do T3 (SF modulo) continua abrindo/insistindo normalmente e a linha nova da
-- fila nasce com modulo = 'shopfloor'.
do $t$
declare v_res jsonb; v_n int;
begin
  insert into public.sf_registros (data_hora, posto, pmo, op, status)
  select now() - interval '1 minute', 'Teste', 'PMOA', '1000', 'reprovado'
    from generate_series(1, 10);
  set local role service_role;
  v_res := public.alerta_avaliar();
  reset role;
  if (v_res->>'ocupado')::boolean then raise exception 'T7 FALHOU: avaliacao ocupada'; end if;
  select count(*) into v_n
    from public.alerta_envios e
    join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
    join public.alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'SF modulo' and e.modulo = 'shopfloor';
  if v_n < 1 then raise exception 'T7 FALHOU: a regra de aprovacao nao enfileirou nada com modulo'; end if;
end $t$;
\echo 'T7 (tipos antigos intactos): ok'

-- Os helpers deste arquivo não sobrevivem a ele (os próximos testes criam os seus).
\echo '0149 (modulo da regra): ok'
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Primeiro acrescente o bloco da 0149 ao runner, no fim de `supabase/tests/rodar-alertas-test.sh`,
**antes** do `echo "ALERTAS SQL OK"`:

```bash
# ---------- 0149: módulo da regra (Alertas do Recebimento) ----------
# Duas aplicações seguidas, cada uma como transação única (-1), provam a idempotência e a ordem dos
# checks. Vem DEPOIS do teste do resumo: a 0149 recria o alerta_avaliar sobre o corpo da 0141.
docker cp supabase/migrations/0149_alertas_modulo.sql "$NOME":/tmp/0149.sql
docker cp supabase/tests/alertas_modulo_test.sql "$NOME":/tmp/teste_modulo.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0149.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0149.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_modulo.sql
echo "0149 (módulo da regra): ok"
```

Run: `supabase/tests/rodar-alertas-test.sh`
Expected: FALHA no `docker cp` da 0149 — `no such file or directory`, porque a migração ainda não
existe. É esse o vermelho que se quer ver antes de escrever o SQL.

- [ ] **Step 4: Escrever a migração 0149 — cabeçalho e colunas**

Crie `supabase/migrations/0149_alertas_modulo.sql`. Cabeçalho no estilo da 0141 (o quê, o porquê,
as duas formas de aplicar, o aviso de ordem de deploy, as convenções) e, em seguida, as colunas:

```sql
-- ---------- as duas colunas de módulo ----------
-- A regra passa a dizer de que MÓDULO ela é. As linhas que já existem são todas do ShopFloor, e é
-- o `not null default 'shopfloor'` que as preenche retroativamente (a spec, decisão 2).
alter table public.alerta_regras
  add column if not exists modulo text not null default 'shopfloor';

-- ⚠️ O MÓDULO TAMBÉM VAI PARA A LINHA DA FILA, e não é redundância: a linha de uma regra de fim de
-- EMB nasce SEM ocorrência (como a do resumo diário, 0141), então o alerta_reservar_envios não tem
-- como descobrir o módulo pela ocorrência. Congelado aqui, no mesmo espírito do destino_externo_id
-- da 0123. Sem esta coluna, a régua de permissão da reserva continuaria sendo 'shopfloor' fixo e a
-- linha de um responsável do Recebimento NUNCA seria reservada: ficaria pendente, sem contar
-- tentativa nem falha, e sairia da fila sozinha depois de 24 h — em silêncio.
alter table public.alerta_envios
  add column if not exists modulo text not null default 'shopfloor';

alter table public.alerta_regras drop constraint if exists alerta_regras_modulo_valido;
alter table public.alerta_regras add constraint alerta_regras_modulo_valido
  check (modulo in ('shopfloor', 'recebimento'));

alter table public.alerta_envios drop constraint if exists alerta_envios_modulo_valido;
alter table public.alerta_envios add constraint alerta_envios_modulo_valido
  check (modulo in ('shopfloor', 'recebimento'));

-- Módulo x tipo: cada tipo de regra pertence a UM módulo. Na 0149 nenhum tipo é do Recebimento
-- ainda (é a 0150 que traz o 'emb'), então o ramo dele é `false` de propósito: a tela do
-- Recebimento existe e lista (vazia), e não há como criar regra lá até o tipo existir. É o que a
-- spec manda entregar primeiro ("a tela existe, ainda sem tipo de regra próprio").
-- coalesce(..., false): sem ele, um módulo fora da lista daria NULL, e check com NULL PASSA.
alter table public.alerta_regras drop constraint if exists alerta_regras_modulo_tipo;
alter table public.alerta_regras add constraint alerta_regras_modulo_tipo check (coalesce(
  case modulo
    when 'shopfloor'   then tipo in ('aprovacao', 'tempo', 'defeito', 'resumo')
    when 'recebimento' then false
  end, false));

comment on column public.alerta_regras.modulo is
  'Módulo a que a regra pertence (shopfloor | recebimento). Decide em qual das duas telas de Alertas ela aparece, qual permissão o RLS exige e qual permissão o responsável precisa ter. Não muda depois de criada (trigger MODULO_FIXO).';
comment on column public.alerta_envios.modulo is
  'Módulo da regra que enfileirou esta linha, CONGELADO no enfileiramento. É por ele que a reserva confere a permissão do responsável — a linha pode não ter ocorrência (resumo diário, fim de EMB), e aí não há de onde derivar o módulo.';
```

- [ ] **Step 5: Escrever o trigger MODULO_FIXO**

Mesmo desenho do `alerta_regras_tipo_fixo` da 0115 (trigger, não policy: a policy de update não
enxerga a linha antiga):

```sql
-- O módulo não muda depois de criado, pelo mesmo motivo do tipo: a regra mudaria de tela, de
-- permissão e de conjunto de responsáveis de uma vez, e as ocorrências e os envios dela ficariam
-- apontando para o módulo errado. Trigger, não policy: a policy de update não vê a linha antiga.
create or replace function public.alerta_regras_modulo_fixo()
returns trigger
language plpgsql
as $func$
begin
  if new.modulo is distinct from old.modulo then
    raise exception 'MODULO_FIXO';
  end if;
  return new;
end
$func$;

-- Função de trigger: ninguém chama direto (o Postgres só confere EXECUTE ao CRIAR o trigger, não
-- ao disparar), então sai de todo mundo.
revoke all on function public.alerta_regras_modulo_fixo()
  from public, anon, authenticated, service_role;

drop trigger if exists alerta_regras_modulo_fixo on public.alerta_regras;
create trigger alerta_regras_modulo_fixo
  before update on public.alerta_regras
  for each row execute function public.alerta_regras_modulo_fixo();
```

- [ ] **Step 6: Escrever as três policies por módulo**

```sql
-- ---------- RLS por módulo (o caso 6 e o caso 7 da spec) ----------
-- ⚠️ ESCRITO EM DUAS PERNAS, UMA POR MÓDULO, E NÃO `tem_permissao(modulo, 'administrar')`.
-- `(select tem_permissao('shopfloor','administrar'))` não depende da linha, então o planejador o
-- resolve UMA vez, como InitPlan — é exatamente o que a 0096 consertou (a função era chamada linha
-- a linha, 27.664 vezes, e deixou todas as telas 133x mais lentas). Passando a coluna `modulo`
-- como argumento, a chamada volta a depender da linha e o InitPlan se perde.
-- Quem acrescentar um terceiro módulo: acrescente uma perna, não troque por um argumento.
drop policy if exists alerta_regras_select_admin on public.alerta_regras;
create policy alerta_regras_select_admin on public.alerta_regras
  for select using (
       (modulo = 'shopfloor'   and (select tem_permissao('shopfloor', 'administrar')))
    or (modulo = 'recebimento' and (select tem_permissao('recebimento', 'administrar'))));

drop policy if exists alerta_regras_insert_admin on public.alerta_regras;
create policy alerta_regras_insert_admin on public.alerta_regras
  for insert with check (
    excluida_em is null
    and ((modulo = 'shopfloor'   and (select tem_permissao('shopfloor', 'administrar')))
      or (modulo = 'recebimento' and (select tem_permissao('recebimento', 'administrar')))));

-- Sem policy de DELETE, como na 0113: a exclusão é lógica (excluida_em).
drop policy if exists alerta_regras_update_admin on public.alerta_regras;
create policy alerta_regras_update_admin on public.alerta_regras
  for update using (
    excluida_em is null
    and ((modulo = 'shopfloor'   and (select tem_permissao('shopfloor', 'administrar')))
      or (modulo = 'recebimento' and (select tem_permissao('recebimento', 'administrar')))))
  with check (
       (modulo = 'shopfloor'   and (select tem_permissao('shopfloor', 'administrar')))
    or (modulo = 'recebimento' and (select tem_permissao('recebimento', 'administrar'))));
```

⚠️ `alerta_ocorrencias` e `alerta_envios` mantêm as policies de leitura em `shopfloor.administrar`:
nenhuma regra do Recebimento abre ocorrência (o fim de EMB não abre, como o resumo diário não
abre), e quem precisa da lista por módulo usa `alerta_listar_ocorrencias(..., p_modulo)`, que é
`security definer` e tem a régua própria. Escreva esse parágrafo como comentário no arquivo — é a
decisão 9 da seção de desenho, e um revisor vai procurá-la.

- [ ] **Step 7: Recriar `alerta_destinatarios` com `p_modulo`**

```sql
-- ---------- alerta_destinatarios(p_modulo): quem a tela oferece ----------
-- Igual à da 0115, com UMA diferença: a permissão exigida é a do MÓDULO da regra, nos dois lugares
-- (de quem CHAMA e de quem é LISTADO). É isso que faz a lista do Recebimento oferecer gente do
-- Recebimento (spec, decisão 6) em vez de gente do ShopFloor.
create or replace function public.alerta_destinatarios(p_modulo text default 'shopfloor')
returns table (usuario_id uuid, nome text, email text, telegram boolean, discord boolean)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_modulo text := btrim(coalesce(p_modulo, ''));
begin
  if v_modulo not in ('shopfloor', 'recebimento') then raise exception 'MODULO_INVALIDO'; end if;
  if not tem_permissao(v_modulo, 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    select u.id,
           coalesce(nullif(btrim(u.nome), ''), u.email),
           u.email,
           exists (select 1 from alerta_contas c where c.usuario_id = u.id and c.canal = 'telegram'),
           exists (select 1 from alerta_contas c where c.usuario_id = u.id and c.canal = 'discord')
      from usuarios u
     where u.ativo
       and public.usuario_tem_permissao(u.id, v_modulo, 'administrar')
     order by lower(coalesce(nullif(btrim(u.nome), ''), u.email));
end
$func$;

revoke all on function public.alerta_destinatarios(text) from public, anon;
grant execute on function public.alerta_destinatarios(text) to authenticated, service_role;

-- A assinatura SEM parâmetro sai de cena: `create or replace` não substitui função de assinatura
-- diferente, e com as duas no ar a chamada curta ficaria ambígua ("function ... is not unique").
drop function if exists public.alerta_destinatarios();
```

- [ ] **Step 8: Recriar `alerta_listar_ocorrencias` com `p_modulo`**

Copie o corpo vivo (0137, linhas 232–283) e aplique **duas** diferenças, nada mais: o parâmetro
novo no fim com default, e a régua + o filtro por módulo.

```sql
create or replace function public.alerta_listar_ocorrencias(
  p_de timestamptz, p_ate timestamptz, p_estado text default '', p_modulo text default 'shopfloor'
)
returns table (
  id uuid, regra_id uuid, regra_nome text, posto text, pmo text, op text, estado text,
  taxa_abertura numeric, taxa_ultima numeric, aprovados int, reprovados int,
  aberta_em timestamptz, resolvida_por_nome text, resolvida_em timestamptz,
  normalizada_em timestamptz, envios_ok int, envios_falha int,
  regra_tipo text, defeito text, valor_abertura numeric, valor_ultimo numeric, amostras int,
  reaberta_em timestamptz, reaberturas int, explicacao text
)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_modulo text := btrim(coalesce(p_modulo, ''));
begin
  if v_modulo not in ('shopfloor', 'recebimento') then raise exception 'MODULO_INVALIDO'; end if;
  -- A régua é a do MÓDULO pedido: quem administra só o Recebimento abre a tela dele e a lista
  -- carrega (vazia, enquanto nenhum tipo do Recebimento abrir ocorrência) em vez de estourar.
  if not tem_permissao(v_modulo, 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    -- ... o MESMO corpo da 0137, com UMA linha acrescentada ao where:
    --       and rg.modulo = v_modulo
    -- (o `join alerta_regras rg on rg.id = oc.regra_id` já está lá)
    select oc.id, oc.regra_id, ... ;
end
$func$;

revoke all on function public.alerta_listar_ocorrencias(timestamptz, timestamptz, text, text)
  from public, anon;
grant execute on function public.alerta_listar_ocorrencias(timestamptz, timestamptz, text, text)
  to authenticated, service_role;

drop function if exists public.alerta_listar_ocorrencias(timestamptz, timestamptz, text);
```

⚠️ Ao escrever, **copie o corpo inteiro da 0137 em vez de reconstruí-lo de memória** (são 25
colunas e dois `left join lateral` de contagem de envios) e acrescente `and rg.modulo = v_modulo`
ao `where`. O `select ...` reticente acima é o único lugar do plano com reticências: é instrução
para copiar, não para inventar.

- [ ] **Step 9: Recriar `alerta_avaliar`, `alerta_resolver_interno` e `alerta_reservar_envios`**

Escreva, antes do `create`, o bloco de diferenças declaradas, no formato da 0141:

```sql
-- ---------------------------------------------------------------------------------------------
-- ⚠️ FUNÇÕES EM PRODUÇÃO QUE ESTE TRECHO RECRIA, E AS ÚNICAS DIFERENÇAS DECLARADAS
--
-- public.alerta_avaliar(text, jsonb, jsonb) — a versão viva é a da 0141 — 3 diferenças:
--   1. `rg.modulo` entra como coluna do cursor, nos QUATRO ramos do `union all` (nos três que já
--      existiam e no do resumo). Nos ramos antigos ela é só carregada, não muda nada;
--   2. no fan-out de PESSOAS do caminho da ocorrência, `usuario_tem_permissao(c.usuario_id,
--      'shopfloor', 'administrar')` vira `usuario_tem_permissao(c.usuario_id, t.modulo,
--      'administrar')`, e o insert passa a gravar `modulo = t.modulo`;
--   3. o mesmo no fan-out do RESUMO (as duas filas dele), e as linhas de CANAL também gravam
--      `modulo = t.modulo`.
--   NADA MAIS muda: a trava advisory, o encerramento por regra desativada, o mínimo de bipes, o
--   v_abaixo, o `select ... for update`, abrir / normalizar / insistir / reabrir, o bloco_reportado,
--   o `dados`, o bloco do resumo e a guarda contra reenvio ficam byte a byte iguais. A assinatura
--   NÃO muda, então não há `drop function` aqui.
--
-- public.alerta_resolver_interno(uuid, uuid, boolean) — a versão viva é a da 0137 — 2 diferenças:
--   1. `usuario_tem_permissao(c.usuario_id, 'shopfloor', 'administrar')` vira
--      `usuario_tem_permissao(c.usuario_id, r.modulo, 'administrar')` (a variável `r` já é a regra);
--   2. o insert do aviso "resolvido por" grava `modulo = r.modulo`.
--
-- public.alerta_reservar_envios(text[], int, uuid) — a versão viva é a da 0123 — 1 diferença:
--   1. no ramo `when 'usuario'` do `case e.destino_tipo`,
--      `usuario_tem_permissao(e.usuario_id, 'shopfloor', 'administrar')` vira
--      `usuario_tem_permissao(e.usuario_id, e.modulo, 'administrar')`.
--   O retorno NÃO ganha coluna (o app não precisa do módulo para entregar), então a assinatura
--   fica igual e não há `drop function`.
--
-- ⚠️ POR QUE A PERMISSÃO DO RESPONSÁVEL MUDA DE MÓDULO: hoje um responsável precisa administrar o
-- ShopFloor para receber qualquer alerta e para poder encerrá-lo. Numa regra do Recebimento isso
-- deixaria a regra sem nenhum responsável possível — a decisão 6 da spec diz que os responsáveis
-- são "as pessoas responsáveis pelo Recebimento". A régua passa a ser a do módulo DA REGRA, nos
-- três lugares onde ela aparece.
-- ---------------------------------------------------------------------------------------------
```

Depois recrie as três funções, cada uma com os `revoke`/`grant` que ela já tinha. Em seguida, a
última linha do arquivo:

```sql
-- ⚠️ O cache de esquema do PostgREST NÃO recarrega sozinho: sem isto, as RPCs continuam batendo
-- nas assinaturas antigas (que já não existem). Uma vez só, no fim do arquivo.
notify pgrst, 'reload schema';
```

- [ ] **Step 10: Rodar o teste SQL e ver passar**

Run: `supabase/tests/rodar-alertas-test.sh`
Expected: todos os blocos imprimem `ok`, inclusive `T0`–`T7` e as duas aplicações da 0149, e a
última linha é `ALERTAS SQL OK`.

Se algum `T` falhar, **não** relaxe o teste: o teste é a tradução do caso de aceitação. Conserte a
migração.

- [ ] **Step 11: Sabotar para provar que o teste pega**

Troque, só na memória do container, `e.modulo` de volta por `'shopfloor'` no
`alerta_reservar_envios` e rode `alertas_modulo_test.sql` de novo:

O `trap` do runner remove o container no fim, então a sabotagem é feita numa **cópia da migração**,
num container próprio, pelo caminho mais curto possível:

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
# A cópia sabotada: a régua da reserva volta a ser 'shopfloor' fixo.
sed "s/usuario_tem_permissao(e.usuario_id, e.modulo, 'administrar')/usuario_tem_permissao(e.usuario_id, 'shopfloor', 'administrar')/" \
  supabase/migrations/0149_alertas_modulo.sql > /tmp/0149-sabotada.sql
# Confira que o sed casou (1 ocorrência trocada):
diff supabase/migrations/0149_alertas_modulo.sql /tmp/0149-sabotada.sql | head
# Rode o runner com a cópia no lugar da original, só nesta rodada:
cp supabase/migrations/0149_alertas_modulo.sql /tmp/0149-boa.sql
cp /tmp/0149-sabotada.sql supabase/migrations/0149_alertas_modulo.sql
supabase/tests/rodar-alertas-test.sh ; echo "saida: $?"
cp /tmp/0149-boa.sql supabase/migrations/0149_alertas_modulo.sql
```

Expected: o runner **falha** em `T6 FALHOU: a linha de recebimento nao foi reservada (a regua ainda
e shopfloor?)` e `saida: 1`.

Se o runner **passar** sabotado, T6 não está medindo nada: conserte o teste antes de seguir. Ao
fim, confirme que a migração voltou ao original (`git diff --stat supabase/migrations/0149_alertas_modulo.sql`
não deve mostrar nada depois do commit da Step 12).

- [ ] **Step 12: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
git add supabase/migrations/0149_alertas_modulo.sql supabase/tests/alertas_modulo_test.sql supabase/tests/rodar-alertas-test.sh
git commit -m "feat(alertas): regra e fila ganham modulo, com RLS e responsaveis por modulo

A regra de alerta passa a dizer de que modulo e (shopfloor | recebimento), retroativa
para 'shopfloor' nas linhas que ja existiam. As tres policies de alerta_regras, a lista
de responsaveis, a lista de ocorrencias e a regua de permissao do fan-out e da reserva
passam a usar o modulo DA REGRA em vez de 'shopfloor' fixo.

alerta_envios tambem guarda o modulo, congelado no enfileiramento: a linha de uma regra
sem ocorrencia (resumo diario, e o fim de EMB que vem a seguir) nao tem de onde derivar
o modulo na hora da reserva.

Spec: docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md (decisoes 2 e 6)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: O módulo no domínio, no repositório e nas actions

**Files:**
- Create: `src/modules/alertas/domain/modulo.ts`
- Create: `src/modules/alertas/domain/__tests__/modulo.test.ts`
- Create: `src/modules/alertas/infra/__tests__/regras-repository-modulo.test.ts`
- Modify: `src/modules/alertas/domain/regra.ts` (`EntradaRegra`, `RegraValida`, `validarRegra`)
- Modify: `src/modules/alertas/domain/erros.ts` (dois códigos novos)
- Modify: `src/modules/alertas/infra/regras-repository.ts` (`CAMPOS_REGRA`, `LinhaRegra`, `paraRegra`, `paraLinha`, `listarRegras`, `listarDestinatarios`, `listarOcorrencias`)
- Modify: `src/modules/alertas/application/liberacao.ts` (`alertasDisponiveis`)
- Modify: `src/modules/alertas/application/alertas-actions.ts` (todas as actions passam a receber `modulo`)
- Modify: `src/modules/alertas/application/__tests__/alertas-actions.test.ts`
- Modify: `src/modules/alertas/domain/__tests__/regra.test.ts`
- Modify: `src/modules/alertas/application/__tests__/liberacao.test.ts`

**Interfaces:**
- Consumes (Task 1): as colunas `alerta_regras.modulo` / `alerta_envios.modulo`,
  `alerta_destinatarios(p_modulo)`, `alerta_listar_ocorrencias(p_de, p_ate, p_estado, p_modulo)`.
- Produces, para a Task 3 e para o Pedaço 2:
  ```ts
  // src/modules/alertas/domain/modulo.ts
  export type ModuloAlerta = 'shopfloor' | 'recebimento'
  export const MODULOS_ALERTA: readonly ModuloAlerta[]
  export function ehModuloAlerta(valor: unknown): valor is ModuloAlerta
  export const NOME_MODULO_ALERTA: Record<ModuloAlerta, string>
  export const TIPOS_REGRA_POR_MODULO: Record<ModuloAlerta, readonly TipoRegra[]>
  export function tipoPertenceAoModulo(tipo: TipoRegra, modulo: ModuloAlerta): boolean
  export const ROTA_ALERTAS: Record<ModuloAlerta, string>
  ```
  - `RegraValida.modulo: ModuloAlerta` e `EntradaRegra.modulo?: string` (ausente = `'shopfloor'`,
    para as chamadas de antes desta mudança).
  - `listarRegras(modulo: ModuloAlerta): Promise<RegraAlerta[]>`
  - `listarDestinatarios(modulo: ModuloAlerta): Promise<DestinatarioDisponivel[]>`
  - `listarOcorrencias(modulo: ModuloAlerta, f: FiltroOcorrencias): Promise<OcorrenciaLinha[]>`
  - `RegraAlerta.modulo: ModuloAlerta`
  - Actions: `salvarRegraAction(modulo, id, entrada)` · `excluirRegraAction(modulo, id)` ·
    `alternarRegraAtivaAction(modulo, id, ativa)` · `previaRegraAction(modulo, entrada)` ·
    `listarOcorrenciasAction(modulo, filtro)` · `resolverOcorrenciaAction(modulo, id, explicacao?)` ·
    `avaliarAgoraAction(modulo)`. **O `modulo` é sempre o 1º parâmetro.**
  - `alertasDisponiveis(sessao)` passa a ser verdadeiro para quem administra **qualquer** módulo com
    alertas.

- [ ] **Step 1: Escrever o teste do domínio do módulo**

Crie `src/modules/alertas/domain/__tests__/modulo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  MODULOS_ALERTA,
  NOME_MODULO_ALERTA,
  ROTA_ALERTAS,
  TIPOS_REGRA_POR_MODULO,
  ehModuloAlerta,
  tipoPertenceAoModulo,
} from '../modulo'
import { TIPOS_REGRA } from '../tipos'

describe('módulo da regra de alerta', () => {
  it('reconhece só os dois módulos que têm alertas', () => {
    expect(ehModuloAlerta('shopfloor')).toBe(true)
    expect(ehModuloAlerta('recebimento')).toBe(true)
    expect(ehModuloAlerta('setup')).toBe(false)
    expect(ehModuloAlerta('sistema')).toBe(false)
    expect(ehModuloAlerta(undefined)).toBe(false)
  })

  it('tem nome e rota para cada módulo', () => {
    for (const m of MODULOS_ALERTA) {
      expect(NOME_MODULO_ALERTA[m]).not.toBe('')
      expect(ROTA_ALERTAS[m].startsWith('/configuracoes/')).toBe(true)
    }
    // As duas rotas são DIFERENTES: é o que faz o RBAC do menu funcionar por módulo.
    expect(ROTA_ALERTAS.shopfloor).not.toBe(ROTA_ALERTAS.recebimento)
  })

  it('cada tipo de regra pertence a exatamente um módulo', () => {
    const vistos = MODULOS_ALERTA.flatMap((m) => [...TIPOS_REGRA_POR_MODULO[m]])
    expect([...vistos].sort()).toEqual([...TIPOS_REGRA].sort())
    expect(new Set(vistos).size).toBe(vistos.length)
  })

  it('os quatro tipos de hoje são do ShopFloor', () => {
    expect(TIPOS_REGRA_POR_MODULO.shopfloor).toEqual(['aprovacao', 'tempo', 'defeito', 'resumo'])
  })

  it('tipoPertenceAoModulo recusa o tipo do outro módulo', () => {
    expect(tipoPertenceAoModulo('aprovacao', 'shopfloor')).toBe(true)
    expect(tipoPertenceAoModulo('aprovacao', 'recebimento')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/domain/__tests__/modulo.test.ts`
Expected: FAIL — `Failed to resolve import "../modulo"`.

- [ ] **Step 3: Escrever `domain/modulo.ts`**

```ts
import { TIPOS_REGRA, type TipoRegra } from './tipos'

/**
 * Os módulos que têm alertas. NÃO é o `Modulo` do RBAC (`auth/domain/perfil`), que tem quatro
 * valores: aqui só entram os módulos com tela de Alertas, e é por isso que o tipo é próprio — um
 * `modulo: 'setup'` numa regra não quer dizer nada e não deve nem compilar.
 *
 * ⚠️ Os valores são os MESMOS do `Modulo` do RBAC de propósito: eles vão direto para
 * `podeNoModulo(perfil, modulo, 'administrar')` e para `tem_permissao(modulo, 'administrar')` no
 * banco. Renomear um aqui quebraria a permissão em silêncio.
 */
export type ModuloAlerta = 'shopfloor' | 'recebimento'

export const MODULOS_ALERTA: readonly ModuloAlerta[] = ['shopfloor', 'recebimento']

export function ehModuloAlerta(valor: unknown): valor is ModuloAlerta {
  return valor === 'shopfloor' || valor === 'recebimento'
}

/** Como o módulo é chamado na tela (cabeçalho da página, mensagens de erro). */
export const NOME_MODULO_ALERTA: Record<ModuloAlerta, string> = {
  shopfloor: 'Fluxo de Processos',
  recebimento: 'Recebimento',
}

/**
 * Quais tipos de regra cada módulo oferece. É daqui que sai a escolha de tipo (os cartões) e a
 * recusa do servidor quando o tipo não é do módulo: uma regra de "Taxa de aprovação" no Recebimento
 * mediria postos que o Recebimento não tem.
 *
 * ⚠️ Cada tipo pertence a UM módulo só, e o teste de `modulo.test.ts` cobra a cobertura completa de
 * `TIPOS_REGRA`: tipo novo sem módulo derruba o teste em vez de aparecer nas duas telas.
 */
export const TIPOS_REGRA_POR_MODULO: Record<ModuloAlerta, readonly TipoRegra[]> = {
  shopfloor: ['aprovacao', 'tempo', 'defeito', 'resumo'],
  recebimento: [],
}

export function tipoPertenceAoModulo(tipo: TipoRegra, modulo: ModuloAlerta): boolean {
  return TIPOS_REGRA_POR_MODULO[modulo].includes(tipo)
}

/**
 * A rota da tela de Alertas de cada módulo. Duas rotas, um componente (spec, decisão 2): é a rota
 * que carrega o `modulo` e o RBAC do menu, não o componente.
 */
export const ROTA_ALERTAS: Record<ModuloAlerta, string> = {
  shopfloor: '/configuracoes/sf-alertas',
  recebimento: '/configuracoes/rec-alertas',
}

// Mantém o import de TIPOS_REGRA em uso mesmo que o mapa acima mude: o teste é quem o consome.
void TIPOS_REGRA
```

⚠️ Tire o `void TIPOS_REGRA` se o `TIPOS_REGRA` não for usado no arquivo final — ele está aqui só
para o lint não reclamar de import morto; se você não importar `TIPOS_REGRA`, apague as duas linhas.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/domain/__tests__/modulo.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Escrever o teste do `validarRegra` com módulo**

Acrescente a `src/modules/alertas/domain/__tests__/regra.test.ts` (o arquivo já existe; siga o
estilo dele e reaproveite o helper de entrada válida que ele tiver):

```ts
describe('módulo da regra', () => {
  it('ausente vale shopfloor (as chamadas de antes do módulo)', () => {
    const r = validarRegra(entradaValida({ modulo: undefined }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valor.modulo).toBe('shopfloor')
  })

  it('recusa módulo desconhecido', () => {
    const r = validarRegra(entradaValida({ modulo: 'financeiro' }))
    expect(r).toEqual({ ok: false, erro: 'Escolha o módulo da regra.' })
  })

  it('recusa o tipo que não é do módulo', () => {
    const r = validarRegra(entradaValida({ modulo: 'recebimento', tipo: 'aprovacao' }))
    expect(r).toEqual({ ok: false, erro: 'Este tipo de regra não existe no Recebimento.' })
  })
})
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/domain/__tests__/regra.test.ts`
Expected: FAIL nos três — `modulo` ainda não existe em `EntradaRegra`/`RegraValida` (erro de tipo e
de asserção).

- [ ] **Step 7: Implementar o módulo em `domain/regra.ts`**

Três mudanças, nesta ordem:

```ts
// no topo, junto dos outros imports de domínio
import { NOME_MODULO_ALERTA, ehModuloAlerta, tipoPertenceAoModulo, type ModuloAlerta } from './modulo'
```

Em `EntradaRegra`, logo antes de `tipo`:

```ts
  /** Ausente = 'shopfloor' (chamadas de antes de a regra ter módulo). */
  modulo?: string
```

Em `RegraValida`, como primeiro campo:

```ts
  modulo: ModuloAlerta
```

E em `validarRegra`, **antes** da leitura do tipo (o módulo decide quais tipos existem, então vem
primeiro):

```ts
  const moduloBruto =
    e.modulo === undefined || e.modulo === null || e.modulo === '' ? 'shopfloor' : e.modulo
  if (!ehModuloAlerta(moduloBruto)) return erro('Escolha o módulo da regra.')
  const modulo: ModuloAlerta = moduloBruto
```

Logo depois de `const tipo: TipoRegra = tipoBruto`:

```ts
  // O tipo tem de ser um dos que o módulo oferece. Sem isto, o cliente mandaria uma regra de taxa
  // de aprovação para o Recebimento — e ela mediria postos que o Recebimento não tem.
  if (!tipoPertenceAoModulo(tipo, modulo)) {
    return erro(`Este tipo de regra não existe no ${NOME_MODULO_ALERTA[modulo]}.`)
  }
```

E `modulo` entra no objeto devolvido em `{ ok: true, valor: { modulo, tipo, nome, ... } }`.

⚠️ `validarPrevia` chama `validarRegra` com `tipo: e.tipo` e sem módulo. Como a prévia só existe nos
tipos do ShopFloor, o default `'shopfloor'` já faz o certo — não acrescente `modulo` a
`EntradaPrevia`.

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/domain/__tests__/`
Expected: PASS em todos os arquivos (os testes antigos de `regra.test.ts` continuam passando porque
`modulo` ausente vale `'shopfloor'`).

- [ ] **Step 9: Commitar o domínio**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
git add src/modules/alertas/domain/modulo.ts src/modules/alertas/domain/__tests__/modulo.test.ts src/modules/alertas/domain/regra.ts src/modules/alertas/domain/__tests__/regra.test.ts
git commit -m "feat(alertas): a regra passa a ter modulo no dominio

ModuloAlerta, TIPOS_REGRA_POR_MODULO (cada tipo pertence a um modulo so) e as duas
rotas da tela. validarRegra recusa modulo desconhecido e tipo que nao e do modulo;
modulo ausente vale 'shopfloor', para as chamadas de antes desta mudanca.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Escrever o teste do repositório**

Crie `src/modules/alertas/infra/__tests__/regras-repository-modulo.test.ts`. Siga o estilo de
`regras-repository-tipos.test.ts` (que já monta um cliente Supabase de mentira com `vi.mock` de
`@/shared/lib/supabase/server`); o ponto do teste é **provar os filtros**, não o mapeamento:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const eq = vi.fn()
const is = vi.fn()
const order = vi.fn()
const select = vi.fn()
const from = vi.fn()
const rpc = vi.fn()

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ from, rpc }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  // Encadeamento do supabase-js: from().select().eq().is().order() devolve { data, error }.
  const cadeia = { select, eq, is, order, in: vi.fn() }
  select.mockReturnValue(cadeia)
  eq.mockReturnValue(cadeia)
  is.mockReturnValue(cadeia)
  order.mockResolvedValue({ data: [], error: null })
  from.mockReturnValue(cadeia)
  rpc.mockResolvedValue({ data: [], error: null })
})

describe('listarRegras por módulo', () => {
  it('filtra pela coluna modulo no servidor', async () => {
    const { listarRegras } = await import('../regras-repository')
    await listarRegras('recebimento')
    expect(eq).toHaveBeenCalledWith('modulo', 'recebimento')
  })

  it('pede a coluna modulo ao banco', async () => {
    const { listarRegras } = await import('../regras-repository')
    await listarRegras('shopfloor')
    expect(String(select.mock.calls[0]![0])).toContain('modulo')
  })
})

describe('as RPCs levam o módulo', () => {
  it('alerta_destinatarios recebe p_modulo', async () => {
    const { listarDestinatarios } = await import('../regras-repository')
    await listarDestinatarios('recebimento')
    expect(rpc).toHaveBeenCalledWith('alerta_destinatarios', { p_modulo: 'recebimento' })
  })

  it('alerta_listar_ocorrencias recebe p_modulo', async () => {
    const { listarOcorrencias } = await import('../regras-repository')
    await listarOcorrencias('recebimento', { de: '2026-10-01', ate: '2026-10-09', estado: '' })
    const args = rpc.mock.calls.find((c) => c[0] === 'alerta_listar_ocorrencias')![1] as Record<string, unknown>
    expect(args.p_modulo).toBe('recebimento')
  })
})
```

- [ ] **Step 11: Rodar e ver falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/infra/__tests__/regras-repository-modulo.test.ts`
Expected: FAIL — `listarRegras` ainda não aceita parâmetro e nenhuma das RPCs manda `p_modulo`.

- [ ] **Step 12: Implementar no `infra/regras-repository.ts`**

```ts
// 1. o import
import { ehModuloAlerta, type ModuloAlerta } from '../domain/modulo'

// 2. a coluna na projeção (primeiro campo depois do id, para o diff ficar legível)
const CAMPOS_REGRA =
  'id, modulo, tipo, nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes, ' +
  'limite_tempo_seg, limite_ocorrencias, pausa_max_min, pmos, lembrete_min, hora_resumo, canais, ' +
  'destinatarios, avisar_pessoas, avisar_canal, ativa, atualizado_em'

// 3. a coluna na LinhaRegra
interface LinhaRegra {
  id: string
  modulo: string
  // ...o resto como está
}

// 4. em paraRegra, junto do tipo:
    // Módulo desconhecido (banco mais novo que o app) cai em 'shopfloor', como o tipo cai em
    // 'aprovacao': a lista mostra a regra em vez de quebrar.
    modulo: ehModuloAlerta(l.modulo) ? l.modulo : 'shopfloor',

// 5. em paraLinha, SÓ no insert (como o tipo): o módulo não muda depois de criado (MODULO_FIXO).
function paraLinha(r: RegraValida, comTipo: boolean): Record<string, unknown> {
  const linha: Record<string, unknown> = { /* ...igual */ }
  if (comTipo) {
    linha.tipo = r.tipo
    linha.modulo = r.modulo
  }
  return linha
}
```

E as três consultas:

```ts
/**
 * As regras DE UM MÓDULO. O filtro `.eq('modulo', modulo)` é a primeira das duas barreiras do caso
 * 6 da spec; a segunda é o RLS por módulo da 0149, que nega mesmo se este filtro sumir. As duas
 * são independentes de propósito: este erra mostrando lista vazia, o RLS erra negando — nenhum dos
 * dois erra mostrando a regra do outro módulo.
 */
export async function listarRegras(modulo: ModuloAlerta): Promise<RegraAlerta[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb
    .from('alerta_regras')
    .select(CAMPOS_REGRA)
    .eq('modulo', modulo)
    .is('excluida_em', null)
    .order('nome')
  if (error) throw error
  // ...o resto como está
}

export async function listarDestinatarios(modulo: ModuloAlerta): Promise<DestinatarioDisponivel[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_destinatarios', { p_modulo: modulo })
  // ...o resto como está
}

export async function listarOcorrencias(
  modulo: ModuloAlerta,
  f: FiltroOcorrencias,
): Promise<OcorrenciaLinha[]> {
  const periodo = periodoOcorrencias(f.de, f.ate)
  if (!periodo) return []
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_listar_ocorrencias', {
    p_de: periodo.de,
    p_ate: periodo.ate,
    p_estado: f.estado,
    p_modulo: modulo,
  })
  // ...o resto como está
}
```

- [ ] **Step 13: Rodar e ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/infra/__tests__/`
Expected: PASS. Se `regras-repository.test.ts` ou `regras-repository-tipos.test.ts` quebrarem por
causa da assinatura nova, **ajuste a chamada no teste** (passe `'shopfloor'`) — não volte a
assinatura.

- [ ] **Step 14: Escrever o teste da liberação por módulo**

Acrescente a `src/modules/alertas/application/__tests__/liberacao.test.ts`:

```ts
describe('alertasDisponiveis em mais de um módulo', () => {
  const perfilCom = (modulo: 'shopfloor' | 'recebimento') =>
    ({ porModulo: { [modulo]: { administrar: true } } }) as never

  it('libera quem administra só o Recebimento', () => {
    expect(alertasDisponiveis({ email: 'beto@x', perfil: perfilCom('recebimento') })).toBe(true)
  })

  it('libera quem administra só o ShopFloor', () => {
    expect(alertasDisponiveis({ email: 'carla@x', perfil: perfilCom('shopfloor') })).toBe(true)
  })

  it('não libera quem não administra nenhum dos dois (caso 7 da spec)', () => {
    expect(alertasDisponiveis({ email: 'zé@x', perfil: { porModulo: { setup: { administrar: true } } } as never })).toBe(false)
  })
})
```

- [ ] **Step 15: Rodar, ver falhar, implementar `liberacao.ts`, ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/application/__tests__/liberacao.test.ts`
Expected: FAIL no primeiro teste (hoje exige `shopfloor`).

Implemente:

```ts
import { MODULOS_ALERTA } from '../domain/modulo'

/**
 * Pode usar os Alertas (menu, Meu perfil e vínculo Telegram/Discord)? Quem administra QUALQUER
 * módulo com alertas — são essas as pessoas que podem ser responsáveis — e, em produção, está na
 * liberação acima. Sem o admin, a pessoa conseguiria vincular a conta mas nunca receberia nada.
 *
 * ⚠️ Era `'shopfloor'` fixo. Com as regras do Recebimento (spec, decisão 6), quem administra só o
 * Recebimento tem de poder vincular o Telegram/Discord em Meu perfil — senão é escolhido como
 * responsável e não recebe nada, sem nenhum aviso.
 */
export function alertasDisponiveis(
  sessao: { email: string | null | undefined; perfil: Parameters<typeof podeNoModulo>[0] } | null,
): boolean {
  if (!sessao) return false
  const admin = MODULOS_ALERTA.some((m) => podeNoModulo(sessao.perfil, m, 'administrar'))
  return admin && alertasLiberados(sessao.email)
}
```

Run de novo: PASS.

- [ ] **Step 16: Escrever o teste das actions com módulo**

Acrescente a `src/modules/alertas/application/__tests__/alertas-actions.test.ts` (o arquivo já
mocka `getSessao` e o repositório; reaproveite os mocks dele):

```ts
describe('as actions respeitam o módulo', () => {
  it('nega quem não administra o módulo pedido', async () => {
    getSessao.mockResolvedValue({ usuarioId: 'u1', email: 'beto@x', perfil: { porModulo: { recebimento: { administrar: true } } } })
    const r = await salvarRegraAction('shopfloor', null, entradaValida())
    expect(r).toEqual({ ok: false, erro: 'Você não tem permissão para configurar alertas.' })
  })

  it('aceita quem administra o módulo pedido', async () => {
    getSessao.mockResolvedValue({ usuarioId: 'u1', email: 'beto@x', perfil: { porModulo: { recebimento: { administrar: true } } } })
    inserirRegra.mockResolvedValue({ ok: true, id: 'g9' })
    const r = await salvarRegraAction('recebimento', null, entradaValida({ modulo: 'recebimento', tipo: 'aprovacao' }))
    // O tipo não é do Recebimento: a validação do domínio recusa ANTES de ir ao banco.
    expect(r.ok).toBe(false)
    expect(inserirRegra).not.toHaveBeenCalled()
  })

  it('recusa módulo forjado que não existe', async () => {
    getSessao.mockResolvedValue({ usuarioId: 'u1', email: 'a@x', perfil: { porModulo: { shopfloor: { administrar: true } } } })
    const r = await salvarRegraAction('financeiro' as never, null, entradaValida())
    expect(r).toEqual({ ok: false, erro: 'Você não tem permissão para configurar alertas.' })
  })

  it('revalida a rota DO MÓDULO, não a do ShopFloor', async () => {
    getSessao.mockResolvedValue({ usuarioId: 'u1', email: 'a@x', perfil: { porModulo: { shopfloor: { administrar: true } } } })
    inserirRegra.mockResolvedValue({ ok: true, id: 'g9' })
    await salvarRegraAction('shopfloor', null, entradaValida())
    expect(revalidatePath).toHaveBeenCalledWith('/configuracoes/sf-alertas')
  })
})
```

- [ ] **Step 17: Rodar e ver falhar, implementar as actions, ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/application/__tests__/alertas-actions.test.ts`
Expected: FAIL — as actions ainda não recebem `modulo`.

Em `alertas-actions.ts`: `ROTA` sai, o `gestor` passa a receber o módulo, e **todas** as actions
ganham `modulo: ModuloAlerta` como **primeiro** parâmetro:

```ts
import { ROTA_ALERTAS, ehModuloAlerta, type ModuloAlerta } from '../domain/modulo'

/**
 * Além da permissão `<modulo>.administrar`, respeita o lançamento escondido dos Alertas
 * (ALERTAS_LIBERADO_PARA): fora da lista liberada, a ação some mesmo pra quem tem permissão.
 *
 * ⚠️ O `modulo` vem do CLIENTE (é a prop da tela), e por isso é conferido duas vezes: aqui, se não
 * é um módulo conhecido, a ação nega com a mensagem genérica; e logo a seguir, pela permissão
 * daquele módulo. Um módulo forjado não dá acesso a nada que a pessoa já não tivesse.
 */
async function gestor(
  modulo: ModuloAlerta,
): Promise<{ ok: true; usuarioId: string } | { ok: false; erro: string }> {
  if (!ehModuloAlerta(modulo)) return { ok: false, erro: SEM_PERMISSAO }
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, modulo, 'administrar')) {
    return { ok: false, erro: SEM_PERMISSAO }
  }
  if (!alertasLiberados(sessao.email)) return { ok: false, erro: RECURSO_INDISPONIVEL }
  return { ok: true, usuarioId: sessao.usuarioId }
}

export async function salvarRegraAction(
  modulo: ModuloAlerta,
  id: string | null,
  entrada: EntradaRegra,
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  try {
    const g = await gestor(modulo)
    if (!g.ok) return { ok: false, erro: g.erro }

    // O módulo é o da ROTA, nunca o que o formulário mandar: é o que impede uma tela de gravar
    // regra no módulo do vizinho.
    const v = validarRegra({ ...entrada, modulo }, { canalConfigurado: canalDiscordConfigurado() })
    if (!v.ok) return { ok: false, erro: v.erro }
    // ...o resto como está, trocando `revalidatePath(ROTA)` por `revalidatePath(ROTA_ALERTAS[modulo])`
  } catch (e) { /* ...igual */ }
}
```

Aplique o mesmo padrão em `excluirRegraAction`, `alternarRegraAtivaAction`, `previaRegraAction`,
`listarOcorrenciasAction` (que passa `modulo` para `listarOcorrencias`), `resolverOcorrenciaAction`
e `avaliarAgoraAction`. Em `listarOcorrenciasAction`:

```ts
export async function listarOcorrenciasAction(
  modulo: ModuloAlerta,
  filtro: FiltroOcorrencias,
): Promise<{ ok: true; ocorrencias: OcorrenciaLinha[] } | { ok: false; erro: string }> {
  const g = await gestor(modulo)
  if (!g.ok) return { ok: false, erro: g.erro }
  try {
    return { ok: true, ocorrencias: await listarOcorrencias(modulo, filtro) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar as ocorrências agora.' }
  }
}
```

⚠️ `avaliarAgoraAction(modulo)` avalia **todas** as regras de todos os módulos (o `alerta_avaliar` é
um só). O `modulo` ali é só a régua de permissão e a rota a revalidar. Escreva isso como comentário
na action — senão alguém vai achar que o botão avalia só o módulo da tela.

- [ ] **Step 18: Acrescentar os dois códigos de erro**

Em `src/modules/alertas/domain/erros.ts`, dentro de `MENSAGENS`:

```ts
  MODULO_FIXO: 'O módulo da regra não muda depois de criado.',
  MODULO_INVALIDO: 'Módulo inválido.',
```

- [ ] **Step 19: Rodar a suíte inteira do módulo e ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas`
Expected: PASS em tudo. Conserte as chamadas nos testes antigos que não compilam (passe
`'shopfloor'` como primeiro argumento); não mude a assinatura para acomodá-los.

- [ ] **Step 20: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
git add src/modules/alertas/domain/erros.ts src/modules/alertas/infra/regras-repository.ts src/modules/alertas/infra/__tests__/regras-repository-modulo.test.ts src/modules/alertas/application/liberacao.ts src/modules/alertas/application/alertas-actions.ts src/modules/alertas/application/__tests__/liberacao.test.ts src/modules/alertas/application/__tests__/alertas-actions.test.ts
git commit -m "feat(alertas): repositorio e actions passam a trabalhar por modulo

listarRegras/listarDestinatarios/listarOcorrencias recebem o modulo; o filtro .eq
('modulo', ...) e a primeira das duas barreiras do caso 6 (a outra e o RLS da 0149).
Toda server action recebe o modulo como primeiro parametro, revalida a permissao
DAQUELE modulo e revalida a rota dele. alertasDisponiveis passa a valer para quem
administra qualquer modulo com alertas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Uma tela, duas rotas

**Files:**
- Create (movendo com `git mv`, de `src/app/(app)/configuracoes/sf-alertas/` para `src/modules/alertas/ui/`):
  `alertas-tela.tsx` · `regras-lista.tsx` · `regra-dialog.tsx` · `regra-form.tsx` · `tipo-escolha.tsx` ·
  `ocorrencias-lista.tsx` · `intervalos-editor.tsx` · `pmos-selecao.tsx` · `explica.tsx` ·
  `__tests__/` (os 7 arquivos de teste)
- Create: `src/app/(app)/configuracoes/rec-alertas/page.tsx`
- Create: `src/modules/alertas/ui/__tests__/alertas-tela-modulo.test.tsx`
- Modify: `src/app/(app)/configuracoes/sf-alertas/page.tsx` (passa a só carregar e montar)
- Modify: `src/shared/ui/app-shell.tsx` (item de menu novo em `CONFIG_RECEBIMENTO`)
- Modify: todos os `import` relativos dos arquivos movidos (`./regra-form` continua valendo; o que
  muda são os imports **para** eles)

**Interfaces:**
- Consumes (Task 2): `ModuloAlerta`, `ROTA_ALERTAS`, `TIPOS_REGRA_POR_MODULO`,
  `NOME_MODULO_ALERTA`, `listarRegras(modulo)`, `listarDestinatarios(modulo)`,
  `listarOcorrencias(modulo, f)`, as actions com `modulo` como 1º parâmetro.
- Produces, para o Pedaço 2:
  - `AlertasTela` com a prop `modulo: ModuloAlerta`, repassada para `RegrasLista` →
    `RegraDialog` → `RegraForm` e `TipoEscolha`.
  - `TipoEscolha` com as props `modulo: ModuloAlerta` e `onEscolher: (tipo: TipoRegra) => void`;
    renderiza só `TIPOS_REGRA_POR_MODULO[modulo]`.
  - `RegraForm` com a prop `modulo: ModuloAlerta` (usada no `entrada()` e no `salvarRegraAction`).
  - Caminho de import público: `@/modules/alertas/ui/alertas-tela`.

- [ ] **Step 1: Escrever o teste da tela por módulo (antes de mover nada)**

Crie `src/modules/alertas/ui/__tests__/alertas-tela-modulo.test.tsx`. Ele monta a tela duas vezes,
uma por módulo, e prova o caso 6 do lado do cliente: a lista mostra o que recebeu, e **o módulo
desce até a chamada da action**.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { RegraAlerta } from '@/modules/alertas/domain/regra'
import { AlertasTela } from '../alertas-tela'

const avaliarAgoraAction = vi.fn()
const alternarRegraAtivaAction = vi.fn()
const listarOcorrenciasAction = vi.fn()
const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  avaliarAgoraAction: (...a: unknown[]) => avaliarAgoraAction(...a),
  alternarRegraAtivaAction: (...a: unknown[]) => alternarRegraAtivaAction(...a),
  listarOcorrenciasAction: (...a: unknown[]) => listarOcorrenciasAction(...a),
  resolverOcorrenciaAction: vi.fn(),
  excluirRegraAction: vi.fn(),
  salvarRegraAction: vi.fn(),
  previaRegraAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const FILTRO = { de: '2026-10-01', ate: '2026-10-09', estado: '' as const }

function regra(o: Partial<RegraAlerta>): RegraAlerta {
  return {
    id: 'g1', modulo: 'shopfloor', tipo: 'aprovacao', nome: 'Teste abaixo de 90',
    postos: ['Teste'], taxaMinima: 90, janelaTipo: 'tempo', janelaValor: 60, minimoBipes: 20,
    limiteTempoSeg: null, limiteOcorrencias: null, pausaMaxMin: null, lembreteMin: null,
    intervalos: [], horaResumo: null, canais: ['telegram'], destinatarios: ['u1'],
    avisarPessoas: true, avisarCanal: false, pmos: [], ativa: true,
    atualizadoEm: '2026-10-09T12:00:00Z', ...o,
  }
}

function montar(modulo: 'shopfloor' | 'recebimento', regras: RegraAlerta[]) {
  render(
    <AlertasTela
      modulo={modulo}
      regras={regras}
      postos={modulo === 'shopfloor' ? [{ chave: 'Teste', temStatus: true, coletaDefeito: true }] : []}
      pmos={[]}
      destinatarios={[{ usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: true }]}
      configurados={{ telegram: true, discord: true }}
      canalConfigurado
      ocorrenciasIniciais={[]}
      filtroInicial={FILTRO}
    />,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('a tela de Alertas servindo dois módulos', () => {
  it('mostra as regras que recebeu, e só elas (caso 6)', () => {
    montar('recebimento', [regra({ id: 'g2', modulo: 'recebimento', nome: 'Fim de EMB' })])
    expect(screen.getByText('Fim de EMB')).toBeInTheDocument()
    expect(screen.queryByText('Teste abaixo de 90')).not.toBeInTheDocument()
  })

  it('leva o módulo da tela em toda action', async () => {
    alternarRegraAtivaAction.mockResolvedValue({ ok: true })
    avaliarAgoraAction.mockResolvedValue({ ok: true, resumo: { avaliadas: 0, enfileirados: 0, enviados: 0, falhas: 0, ocupado: false } })
    montar('recebimento', [regra({ id: 'g2', modulo: 'recebimento', nome: 'Fim de EMB' })])

    fireEvent.click(screen.getByRole('button', { name: /avaliar agora/i }))
    await waitFor(() => expect(avaliarAgoraAction).toHaveBeenCalledWith('recebimento'))

    fireEvent.click(screen.getAllByRole('switch')[0]!)
    await waitFor(() => expect(alternarRegraAtivaAction).toHaveBeenCalledWith('recebimento', 'g2', false))
  })

  it('carrega as ocorrências do módulo da tela', async () => {
    listarOcorrenciasAction.mockResolvedValue({ ok: true, ocorrencias: [] })
    montar('recebimento', [])
    fireEvent.click(screen.getByRole('button', { name: 'Ocorrências' }))
    await waitFor(() => expect(listarOcorrenciasAction).toHaveBeenCalledWith('recebimento', expect.anything()))
  })

  it('no Recebimento, enquanto não há tipo de regra, não oferece Nova regra', () => {
    montar('recebimento', [])
    expect(screen.getByRole('button', { name: /nova regra/i })).toBeDisabled()
    expect(screen.getByText(/nenhum tipo de regra/i)).toBeInTheDocument()
  })

  it('no ShopFloor, Nova regra continua disponível', () => {
    montar('shopfloor', [])
    expect(screen.getByRole('button', { name: /nova regra/i })).not.toBeDisabled()
  })
})
```

⚠️ O quarto e o quinto teste são o que mantém a tela honesta no Pedaço 1 (a tela existe, sem tipo
próprio) e vão **mudar de sinal** no Pedaço 2 (Task 6), quando `'emb'` entrar em
`TIPOS_REGRA_POR_MODULO.recebimento`. Isso está previsto: a Task 6 troca o quarto teste por um que
afirma o contrário, e é bom que ele seja um teste e não um silêncio.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/ui/__tests__/alertas-tela-modulo.test.tsx`
Expected: FAIL — `Failed to resolve import "../alertas-tela"` (a pasta `ui/` ainda não existe).

- [ ] **Step 3: Mover a tela para o módulo**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
mkdir -p src/modules/alertas/ui
git mv "src/app/(app)/configuracoes/sf-alertas/alertas-tela.tsx"      src/modules/alertas/ui/alertas-tela.tsx
git mv "src/app/(app)/configuracoes/sf-alertas/regras-lista.tsx"      src/modules/alertas/ui/regras-lista.tsx
git mv "src/app/(app)/configuracoes/sf-alertas/regra-dialog.tsx"      src/modules/alertas/ui/regra-dialog.tsx
git mv "src/app/(app)/configuracoes/sf-alertas/regra-form.tsx"        src/modules/alertas/ui/regra-form.tsx
git mv "src/app/(app)/configuracoes/sf-alertas/tipo-escolha.tsx"      src/modules/alertas/ui/tipo-escolha.tsx
git mv "src/app/(app)/configuracoes/sf-alertas/ocorrencias-lista.tsx" src/modules/alertas/ui/ocorrencias-lista.tsx
git mv "src/app/(app)/configuracoes/sf-alertas/intervalos-editor.tsx" src/modules/alertas/ui/intervalos-editor.tsx
git mv "src/app/(app)/configuracoes/sf-alertas/pmos-selecao.tsx"      src/modules/alertas/ui/pmos-selecao.tsx
git mv "src/app/(app)/configuracoes/sf-alertas/explica.tsx"           src/modules/alertas/ui/explica.tsx
git mv "src/app/(app)/configuracoes/sf-alertas/__tests__"             src/modules/alertas/ui/__tests__
```

Os imports **entre** os arquivos movidos são relativos (`./regra-form`, `./explica`) e continuam
valendo. Os imports com `@/` também. Confira que nada ficou apontando para a pasta antiga:

```bash
grep -rn "configuracoes/sf-alertas" src/ --include=*.ts --include=*.tsx
```

Expected: só `src/app/(app)/configuracoes/sf-alertas/page.tsx` (que é o que a Step 6 reescreve) e
nenhum `import`.

Escreva, no topo de `src/modules/alertas/ui/alertas-tela.tsx`, o comentário que explica a pasta:

```tsx
/**
 * A tela de Alertas. Mora no MÓDULO, e não na pasta de uma rota, porque ela serve DUAS rotas
 * (`/configuracoes/sf-alertas` e `/configuracoes/rec-alertas`, spec de 2026-10-09, decisão 2): a
 * pasta de uma rota não pode ser a casa da tela da outra.
 *
 * O que a tela sabe do módulo vem SÓ da prop `modulo` — nunca do `usePathname()`. É ela que decide
 * quais tipos de regra existem, para qual rota as actions revalidam e qual permissão o servidor
 * confere. As duas `page.tsx` carregam o que é do módulo delas e montam este componente.
 */
```

- [ ] **Step 4: Passar `modulo` por toda a árvore**

`alertas-tela.tsx`:

```tsx
import type { ModuloAlerta } from '@/modules/alertas/domain/modulo'

export function AlertasTela({
  modulo,
  regras,
  // ...o resto como está
}: {
  /** Qual módulo esta instância da tela está servindo. Desce inteira até o formulário. */
  modulo: ModuloAlerta
  regras: RegraAlerta[]
  // ...o resto como está
}) {
  // ...
  function avaliarAgora() {
    startTransition(async () => {
      const r = await avaliarAgoraAction(modulo)
      // ...o resto como está
    })
  }
  // ...
      {aba === 'regras' ? (
        <RegrasLista
          modulo={modulo}
          regras={regras}
          // ...o resto como está
        />
      ) : (
        <OcorrenciasLista
          modulo={modulo}
          ocorrenciasIniciais={ocorrenciasIniciais}
          filtroInicial={filtroInicial}
          recarregar={recarga}
        />
      )}
```

`regras-lista.tsx`: ganha `modulo: ModuloAlerta` nas props, passa para `RegraDialog` e usa nas três
actions (`alternarRegraAtivaAction(modulo, regra.id, ativa)`, `excluirRegraAction(modulo, regra.id)`).
E o botão "Nova regra" fica desabilitado quando o módulo não tem tipo nenhum:

```tsx
import { TIPOS_REGRA_POR_MODULO } from '@/modules/alertas/domain/modulo'

  // Enquanto o módulo não tiver nenhum tipo de regra, "Nova regra" abriria um diálogo com zero
  // cartões para escolher — um beco sem saída. Melhor o botão desligado e a frase do porquê.
  const semTipos = TIPOS_REGRA_POR_MODULO[modulo].length === 0

      <div className="flex items-center justify-end gap-3">
        {semTipos && (
          <p className="text-sm text-muted-foreground">
            Nenhum tipo de regra disponível neste módulo ainda.
          </p>
        )}
        <Button
          className="bg-enterplak hover:bg-enterplak-700"
          disabled={semTipos}
          onClick={() => setDialogo({ aberto: true, regra: null })}
        >
          <PlusIcon /> Nova regra
        </Button>
      </div>
```

`regra-dialog.tsx`: `PropsRegra` ganha `modulo: ModuloAlerta`; `RegraConteudo` passa
`modulo={modulo}` para `TipoEscolha` e para `RegraForm`.

`tipo-escolha.tsx`:

```tsx
import { TIPOS_REGRA_POR_MODULO, type ModuloAlerta } from '@/modules/alertas/domain/modulo'

/** Regra nova começa aqui: um cartão por tipo DO MÓDULO (título + uma frase). O tipo não muda depois. */
export function TipoEscolha({
  modulo,
  onEscolher,
}: {
  modulo: ModuloAlerta
  onEscolher: (tipo: TipoRegra) => void
}) {
  const tipos = TIPOS_REGRA_POR_MODULO[modulo]
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {tipos.map((t) => (
        // ...o mesmo cartão de hoje
      ))}
    </div>
  )
}
```

⚠️ A grade era `sm:grid-cols-3` para três cartões; com quatro (ShopFloor) ela já estava apertada.
`sm:grid-cols-2` acomoda 4 e 1 sem cartão órfão esticado.

`regra-form.tsx`: ganha `modulo: ModuloAlerta` nas props, põe `modulo` no objeto de `entrada()` e
chama `salvarRegraAction(modulo, regra?.id ?? null, dados)` e `previaRegraAction(modulo, {...})`.

`ocorrencias-lista.tsx`: ganha `modulo: ModuloAlerta` e passa nas duas actions
(`listarOcorrenciasAction(modulo, filtro)`, `resolverOcorrenciaAction(modulo, id, explicacao)`).

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas`
Expected: PASS. Os 7 arquivos de teste movidos vão exigir a prop `modulo` nos `render(...)` —
acrescente `modulo="shopfloor"` em cada um (é o módulo que eles já testavam).

- [ ] **Step 6: Reescrever a página do ShopFloor e criar a do Recebimento**

`src/app/(app)/configuracoes/sf-alertas/page.tsx` — mesma lógica de hoje, com o `modulo` e o
`import` novo:

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { PERFIL_PADRAO } from '@/modules/shopfloor/domain/perfil-posto'
import { listarPostos, mapaPostoPerfil } from '@/modules/shopfloor/infra/postos-repository'
import { alertasLiberados } from '@/modules/alertas/application/liberacao'
import { filtroOcorrenciasPadrao } from '@/modules/alertas/domain/ocorrencia'
import { postoRegraDe } from '@/modules/alertas/domain/postos-regra'
import { canaisConfigurados, canalDiscordConfigurado } from '@/modules/alertas/infra/canais'
import {
  listarDestinatarios,
  listarOcorrencias,
  listarPmosAlerta,
  listarRegras,
} from '@/modules/alertas/infra/regras-repository'
import { AlertasTela } from '@/modules/alertas/ui/alertas-tela'

export default async function AlertasShopFloorPage() {
  const sessao = await getSessao()
  if (
    !sessao ||
    !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar') ||
    !alertasLiberados(sessao.email)
  ) {
    return <SemPermissao descricao="Você não tem permissão para configurar alertas." />
  }

  const filtro = filtroOcorrenciasPadrao(new Date())
  const [regras, postos, perfis, pmos, destinatarios, ocorrencias] = await Promise.all([
    listarRegras('shopfloor'),
    listarPostos(),
    mapaPostoPerfil(),
    listarPmosAlerta(),
    listarDestinatarios('shopfloor'),
    listarOcorrencias('shopfloor', filtro),
  ])

  const postosRegra = postos.map((chave) => postoRegraDe(chave, perfis[chave] ?? PERFIL_PADRAO))

  return (
    <AlertasTela
      modulo="shopfloor"
      regras={regras}
      postos={postosRegra}
      pmos={pmos}
      destinatarios={destinatarios}
      configurados={canaisConfigurados()}
      canalConfigurado={canalDiscordConfigurado()}
      ocorrenciasIniciais={ocorrencias}
      filtroInicial={filtro}
    />
  )
}
```

Crie `src/app/(app)/configuracoes/rec-alertas/page.tsx`:

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { alertasLiberados } from '@/modules/alertas/application/liberacao'
import { filtroOcorrenciasPadrao } from '@/modules/alertas/domain/ocorrencia'
import { canaisConfigurados, canalDiscordConfigurado } from '@/modules/alertas/infra/canais'
import {
  listarDestinatarios,
  listarOcorrencias,
  listarRegras,
} from '@/modules/alertas/infra/regras-repository'
import { AlertasTela } from '@/modules/alertas/ui/alertas-tela'

/**
 * Alertas do Recebimento — a MESMA tela do ShopFloor, montada com `modulo="recebimento"`
 * (spec de 2026-10-09, decisão 2). O que muda é só o que esta página carrega:
 *
 * ⚠️ NÃO chama `listarPostos`/`mapaPostoPerfil`/`listarPmosAlerta`, e isso não é economia: posto e
 * PMO são do ShopFloor. `alerta_pmos()` levanta SEM_PERMISSAO para quem não administra o ShopFloor,
 * e `sf_postos` é lido por RLS de ShopFloor — chamar qualquer um dos três aqui faria a tela do
 * Recebimento estourar (ou vir vazia) na mão de quem administra só o Recebimento, que é exatamente
 * a pessoa do caso de aceitação 7. Os tipos de regra do Recebimento não usam posto nem PMO.
 */
export default async function AlertasRecebimentoPage() {
  const sessao = await getSessao()
  if (
    !sessao ||
    !podeNoModulo(sessao.perfil, 'recebimento', 'administrar') ||
    !alertasLiberados(sessao.email)
  ) {
    return <SemPermissao descricao="Você não tem permissão para configurar alertas." />
  }

  const filtro = filtroOcorrenciasPadrao(new Date())
  const [regras, destinatarios, ocorrencias] = await Promise.all([
    listarRegras('recebimento'),
    listarDestinatarios('recebimento'),
    listarOcorrencias('recebimento', filtro),
  ])

  return (
    <AlertasTela
      modulo="recebimento"
      regras={regras}
      postos={[]}
      pmos={[]}
      destinatarios={destinatarios}
      configurados={canaisConfigurados()}
      canalConfigurado={canalDiscordConfigurado()}
      ocorrenciasIniciais={ocorrencias}
      filtroInicial={filtro}
    />
  )
}
```

- [ ] **Step 7: Acrescentar o item de menu**

Em `src/shared/ui/app-shell.tsx`, no array `CONFIG_RECEBIMENTO` (linha ~110), como **último** item
(os Alertas vêm depois das configurações de dado):

```tsx
  { chave: 'rec-alertas', rotulo: 'Alertas', href: '/configuracoes/rec-alertas', icone: BellRing, modulo: 'recebimento', perm: 'administrar' },
```

`BellRing` já está importado (é o ícone do `sf-alertas`). E o lançamento escondido vale para os
dois itens — troque o filtro da linha ~199–202 por:

```tsx
  // Lançamento escondido dos Alertas: vale para os DOIS itens (é a mesma feature escondida).
  const ehAlertas = (chave: string) => chave === 'sf-alertas' || chave === 'rec-alertas'
  const configRec = podeConfig
    ? CONFIG_RECEBIMENTO.filter(pode).filter((i) => !ehAlertas(i.chave) || alertasLiberado)
    : []
  const configSf = podeConfig
    ? CONFIG_SHOPFLOOR.filter(pode).filter((i) => !ehAlertas(i.chave) || alertasLiberado)
    : []
```

⚠️ Nada mais no `app-shell` precisa mudar: `CONFIG_TODOS` já espalha `CONFIG_RECEBIMENTO`, então o
título da página, o accordion aberto e o item ativo saem de graça. É isso que a spec quer dizer com
"a permissão sai de graça pelo mecanismo que já existe".

- [ ] **Step 8: Conferir o build e a suíte inteira**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
npx tsc --noEmit
npx vitest run --maxWorkers=2
npx next build
```

Expected: `tsc` sem erro; vitest com tudo verde; `next build` concluindo com as duas rotas
`/configuracoes/sf-alertas` e `/configuracoes/rec-alertas` na listagem.
⚠️ Se o `next build` reclamar de symlink, veja a nota do projeto: em worktree ele roda com
`cp -al` (hard link), não com symlink.

- [ ] **Step 9: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
git add src/modules/alertas/ui src/app/\(app\)/configuracoes/sf-alertas/page.tsx src/app/\(app\)/configuracoes/rec-alertas/page.tsx src/shared/ui/app-shell.tsx
git commit -m "feat(alertas): a tela existe em duas rotas, com o mesmo componente

A tela sai da pasta da rota e passa a morar em src/modules/alertas/ui: ela serve duas
rotas agora, e a pasta de uma rota nao pode ser a casa da tela da outra. O modulo desce
por prop (nunca pelo pathname) ate o formulario e ate cada action.

A rota do Recebimento carrega SO o que e do Recebimento: nao chama listarPostos nem
alerta_pmos, que exigem permissao de ShopFloor e estourariam na mao de quem administra
so o Recebimento. O item de menu e uma linha declarativa com modulo: 'recebimento', e o
RBAC sai de graca do mecanismo que ja existe.

Spec: docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md (decisao 2, casos 6 e 7)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Fim do Pedaço 1.** Entregável: duas rotas, uma tela, listas separadas, RBAC por módulo. A tela do
Recebimento ainda não oferece tipo de regra — é o Pedaço 2.

---

# PEDAÇO 2 — Tipo de regra "Fim de EMB"

Entregável do pedaço: a feature **funciona**, por Discord e Telegram. O gatilho (todos os processos
da EMB terminais), o conteúdo (as divergências e suas justificativas — ou o aviso de que a EMB
fechou sem nenhuma divergência) e a marca de "já avisei".

---

### Task 4: Migração 0150 — o gatilho, o conteúdo e a marca

**Files:**
- Create: `supabase/migrations/0150_alertas_fim_de_emb.sql`
- Create: `supabase/tests/alertas_emb_test.sql`
- Modify: `supabase/tests/_stubs.sql` (stubs de `processos_recebimento` e `configuracao_campos`)
- Modify: `supabase/tests/rodar-alertas-test.sh` (bloco da 0150 no fim)

**Interfaces:**
- Consumes (Task 1): `alerta_regras.modulo`, `alerta_envios.modulo`, o corpo do `alerta_avaliar` da 0149.
- Produces:
  - `alerta_regras.tipo` aceita `'emb'`; `modulo = 'recebimento'` aceita `tipo = 'emb'`.
  - `alerta_envios.tipo` aceita `'emb'`.
  - `public.alerta_emb_avisada (regra_id uuid, emb text, avisada_em timestamptz, divergencias int, enviados int)`, PK `(regra_id, emb)`.
  - `public.rec_embs_fechadas(p_desde timestamptz)` → `table (emb text, fechada_em timestamptz)`.
  - `public.rec_emb_divergencias(p_emb text)` → `table (numero bigint, item text, descricao text, quantidade_pedido numeric, quantidade_recebida numeric, divergencia text, justificativa text, justificada_por_nome text, justificada_em timestamptz)`.
  - O `dados` da linha de fila de tipo `'emb'`, que a Task 5 lê em `textoDoEnvio`:
    ```json
    { "regra_tipo": "emb", "regra_nome": "...", "emb": "EMB390",
      "fechada_em": "<timestamptz>", "agora": "<timestamptz>",
      "divergencias": [ { "numero": 1234, "item": "CAP-001", "descricao": "CAPACITOR X",
                          "quantidade_pedido": 500, "quantidade_recebida": 490,
                          "divergencia": "-10", "justificativa": "...",
                          "justificada_por_nome": "Ana Gestora" } ] }
    ```
    ⚠️ Na EMB que fecha **sem nenhuma divergência**, a linha de fila existe do mesmo jeito e
    `"divergencias"` é a lista **vazia** (`[]`) — nunca ausente. É assim que a Task 5 distingue
    "EMB limpa" (mensagem própria) de "dado corrompido" (lança). Decisão 5 da spec, corrigida em
    14/10/2026.

- [ ] **Step 1: Ler as fontes**

1. `supabase/migrations/0124_recebimento_fluxo_registros.sql` linhas 1–160 — `rec_divergente`,
   `rec_etapa_por_resultado`, `rec_etapa_por_status` e a forma de uma função `rec_*`.
2. `supabase/migrations/0142_divergencia_justificativa.sql` inteira — as quatro colunas de
   justificativa.
3. `src/modules/recebimento/domain/etapa-processo.ts` (`temDivergencia`, `etapaPorStatus`) e
   `src/modules/recebimento/domain/divergencia.ts` (`estadoDaDivergencia`) — as regras que o SQL
   espelha.
4. `supabase/migrations/0141_alertas_resumo_diario.sql` linhas 360–500 — o **bloco do resumo no
   topo do laço** é o molde exato do bloco do fim de EMB.

- [ ] **Step 2: Acrescentar os stubs do Recebimento ao harness**

O `_stubs.sql` do harness de alertas não tem `processos_recebimento` — e a 0150 lê essa tabela.
Acrescente, no fim de `supabase/tests/_stubs.sql`, antes dos `grant` finais:

```sql
-- ---------- Recebimento (0124/0142): o fim de EMB da 0150 lê estas duas ----------
-- Só as colunas que a 0150 usa. Reduzido de propósito: o teste do Fluxo do Recebimento
-- (recebimento_fluxo_test.sql) tem o stub completo; aqui o que importa é EMB, status, divergência
-- e justificativa.
create table public.configuracao_campos (
  campo text primary key,
  grupo text not null
);

create sequence public.processos_numero_seq;
create table public.processos_recebimento (
  id                               uuid primary key default gen_random_uuid(),
  numero                           bigint not null default nextval('public.processos_numero_seq') unique,
  numero_emb                       text,
  status                           text not null default 'aberto',
  codigo_material                  text,
  descricao_material               text,
  quantidade_pedido                numeric,
  quantidade_recebida              numeric,
  divergencia                      text,
  resultado                        text,
  divergencia_justificativa        text not null default '',
  divergencia_justificada_por      uuid references public.usuarios(id),
  divergencia_justificada_em       timestamptz,
  divergencia_justificada_por_nome text not null default '',
  finalizado_em                    timestamptz,
  created_at                       timestamptz not null default now()
);

grant select on public.processos_recebimento, public.configuracao_campos
  to anon, authenticated, service_role;
```

⚠️ `_stubs.sql` é compartilhado pelo harness de alertas. O acréscimo é aditivo: nenhum teste
existente lê essas tabelas, e nenhuma migração de alertas anterior à 0150 as referencia.

- [ ] **Step 3: Escrever o teste SQL do fim de EMB, que vai falhar**

Crie `supabase/tests/alertas_emb_test.sql`. **Os cinco primeiros casos de aceitação da spec são
estes testes, um a um** — é o arquivo mais importante do pedaço.

```sql
-- Testes SQL da 0150 (tipo de regra 'emb': aviso de fim de EMB). Rodar com
-- supabase/tests/rodar-alertas-test.sh: DEPOIS de alertas_modulo_test.sql, na mesma base, com a
-- 0150 por cima de tudo.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE: a 0150 recria o alerta_avaliar, que roda de 5 em 5 minutos em
-- produção, e os dois defeitos mais caros dela são SQL puro, invisíveis para o vitest:
--   (a) o aviso sair DUAS vezes para a mesma EMB (a marca de "já avisei"), e
--   (b) a primeira rodada em produção mandar um aviso de TODA EMB historicamente fechada
--       (o piso rg.criado_em).
--
-- O mapa dos testes — os números batem com os casos de aceitação da spec:
--   T0  esquema: tipo 'emb' aceito, postos vazio aceito SÓ nele, tabela da marca, grants;
--   T1  (caso 1) EMB com 3 itens, 2 ainda na Qualidade: NÃO manda nada, NÃO grava marca;
--   T2  (caso 2) o último item chega ao Almoxarifado: SAI a mensagem, com as divergências e as
--       justificativas, e a marca é gravada;
--   T3  (caso 3) ⚠️ a MESMA EMB na rodada seguinte: ZERO linhas novas na fila;
--   T4  (caso 4) EMB que fecha SEM divergência: MANDA a mensagem de EMB limpa (lista vazia no
--       `dados`) e a marca É gravada — decisão 5 corrigida em 14/10/2026;
--   T5  (caso 5) EMB cujo último item foi REPROVADO na Qualidade: MANDA (reprovado também é fim);
--   T6  ⚠️ o piso rg.criado_em: EMB fechada ANTES de a regra existir não manda nada;
--   T7  ⚠️ divergência com ninguém alcançável: nada na fila e a marca NÃO é gravada (volta depois);
--   T8  ⚠️ o fim de EMB não encosta no caminho da ocorrência: alerta_ocorrencias não ganha linha,
--       e `avaliadas` não sobe por causa dele;
--   T9  o filtro por EMB não vaza: a divergência da EMB vizinha não entra na mensagem;
--   T10 os tipos antigos continuam avaliando na MESMA rodada.
-- (A idempotência da 0150 é do runner: ela é aplicada duas vezes.)

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);

-- As regras dos testes anteriores saem do caminho e a fila antiga é dada por desistida.
update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- helpers ----------
-- Beto administra o Recebimento e tem conta no Telegram (vem do teste da 0149).
create function public.teste_regra_emb(
  p_nome text,
  p_destinatarios uuid[] default array['00000000-0000-0000-0000-0000000000b1']::uuid[],
  p_criado_em timestamptz default now() - interval '1 hour'
) returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, modulo, postos, janela_tipo, janela_valor, canais, destinatarios,
     avisar_pessoas, avisar_canal, ativa, criado_por, criado_em)
  values (p_nome, 'emb', 'recebimento', '{}'::text[], 'op', null, array['telegram'],
          p_destinatarios, true, false, true, '00000000-0000-0000-0000-000000000001', p_criado_em)
  returning id
$f$;

-- Um item de EMB. p_status: 'aberto' | 'em_conferencia' | 'Aprovado' | 'Reprovado'.
create function public.teste_item_emb(
  p_emb text, p_item text, p_status text,
  p_pedido numeric default 500, p_recebido numeric default 500,
  p_justificativa text default '', p_quem text default ''
) returns bigint language sql as $f$
  insert into public.processos_recebimento
    (numero_emb, codigo_material, descricao_material, quantidade_pedido, quantidade_recebida,
     divergencia, status, resultado, divergencia_justificativa, divergencia_justificada_por_nome,
     divergencia_justificada_em, created_at, finalizado_em)
  values (p_emb, p_item, 'CAPACITOR ' || p_item, p_pedido, p_recebido,
          -- O campo é CALCULADO pelo sistema e guardado como texto (0124/0147).
          (p_recebido - p_pedido)::text,
          p_status,
          case when p_status in ('Aprovado', 'Reprovado') then p_status end,
          p_justificativa, p_quem,
          case when p_justificativa <> '' then now() end,
          now() - interval '2 days',
          case when p_status in ('Aprovado', 'Reprovado') then now() - interval '1 minute' end)
  returning numero
$f$;

-- Quantas linhas de fila de tipo 'emb' esta regra já tem para esta EMB.
create function public.teste_envios_emb(p_regra text, p_emb text) returns int language sql as $f$
  select count(*)::int from public.alerta_envios
   where tipo = 'emb' and dados->>'regra_nome' = p_regra and dados->>'emb' = upper(btrim(p_emb))
$f$;

-- A marca existe?
create function public.teste_marca_emb(p_regra text, p_emb text) returns boolean language sql as $f$
  select exists (
    select 1 from public.alerta_emb_avisada a
      join public.alerta_regras rg on rg.id = a.regra_id
     where rg.nome = p_regra and a.emb = upper(btrim(p_emb)))
$f$;

-- Roda uma avaliação como o cron roda.
create function public.teste_avaliar() returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  v := public.alerta_avaliar();
  if (v->>'ocupado')::boolean then raise exception 'avaliacao ocupada'; end if;
  return v;
end $f$;
```

Agora os testes. Escreva **todos** — cada um é um caso de aceitação:

```sql
-- ---------- T0: esquema ----------
do $t$
begin
  if not exists (select 1 from pg_class where relname = 'alerta_emb_avisada'
                   and relnamespace = 'public'::regnamespace) then
    raise exception 'T0 FALHOU: alerta_emb_avisada nao existe';
  end if;
  -- postos vazio: só no tipo 'emb'.
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes,
       canais, destinatarios, ativa, criado_por)
    values ('SF sem posto', 'aprovacao', 'shopfloor', '{}'::text[], 90, 'tempo', 60, 5,
            array['telegram'], array['00000000-0000-0000-0000-000000000001']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T0 FALHOU: regra de aprovacao sem posto foi aceita';
  exception when check_violation then null;
  end;
  -- E o 'emb' não aceita posto nenhum (campo que não é dele).
  begin
    insert into public.alerta_regras
      (nome, tipo, modulo, postos, janela_tipo, canais, destinatarios, ativa, criado_por)
    values ('EMB com posto', 'emb', 'recebimento', array['Teste'], 'op', array['telegram'],
            array['00000000-0000-0000-0000-0000000000b1']::uuid[], true,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'T0 FALHOU: regra de fim de EMB com posto foi aceita';
  exception when check_violation then null;
  end;
end $t$;
\echo 'T0 (esquema do fim de EMB): ok'

-- ---------- T1 (caso 1): EMB aberta não manda nada ----------
select public.teste_regra_emb('Fim de EMB');
select public.teste_item_emb('EMB100', 'CAP-1', 'Aprovado', 500, 490);
select public.teste_item_emb('EMB100', 'CAP-2', 'em_conferencia');
select public.teste_item_emb('EMB100', 'CAP-3', 'em_conferencia');
do $t$
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Fim de EMB', 'EMB100') <> 0 then
    raise exception 'T1 FALHOU: EMB com itens na Qualidade mandou aviso';
  end if;
  if public.teste_marca_emb('Fim de EMB', 'EMB100') then
    raise exception 'T1 FALHOU: EMB aberta recebeu marca';
  end if;
end $t$;
\echo 'T1 (caso 1: EMB aberta nao manda): ok'

-- ---------- T2 (caso 2): o último item fecha a EMB e o aviso sai ----------
update public.processos_recebimento
   set status = 'Aprovado', resultado = 'Aprovado', finalizado_em = now() - interval '1 minute'
 where numero_emb = 'EMB100' and status = 'em_conferencia';
-- Uma das divergências tem justificativa, a outra não: é o par que a mensagem precisa mostrar.
update public.processos_recebimento
   set divergencia_justificativa = 'Fornecedor avisou falta; saldo entra na proxima NF.',
       divergencia_justificada_por_nome = 'Ana Gestora', divergencia_justificada_em = now()
 where numero_emb = 'EMB100' and codigo_material = 'CAP-1';
update public.processos_recebimento
   set quantidade_recebida = 505, divergencia = '5'
 where numero_emb = 'EMB100' and codigo_material = 'CAP-3';
do $t$
declare v_dados jsonb; v_divs jsonb;
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Fim de EMB', 'EMB100') <> 1 then
    raise exception 'T2 FALHOU: esperava 1 linha de fila (Beto x telegram), achei %',
      public.teste_envios_emb('Fim de EMB', 'EMB100');
  end if;
  select dados into v_dados from public.alerta_envios
   where tipo = 'emb' and dados->>'emb' = 'EMB100' limit 1;
  v_divs := v_dados->'divergencias';
  if jsonb_array_length(v_divs) <> 2 then
    raise exception 'T2 FALHOU: esperava 2 divergencias, achei %', jsonb_array_length(v_divs);
  end if;
  -- Só as DIVERGENTES entram: CAP-2 (500/500) ficou fora.
  if exists (select 1 from jsonb_array_elements(v_divs) d where d->>'item' = 'CAP-2') then
    raise exception 'T2 FALHOU: item sem divergencia entrou na mensagem';
  end if;
  -- A justificativa viaja junto; a que ninguem escreveu vem vazia (quem decide o texto e o TS).
  if (select d->>'justificativa' from jsonb_array_elements(v_divs) d where d->>'item' = 'CAP-1')
     not like 'Fornecedor avisou%' then
    raise exception 'T2 FALHOU: a justificativa do CAP-1 nao chegou no dados';
  end if;
  if coalesce((select d->>'justificativa' from jsonb_array_elements(v_divs) d
                where d->>'item' = 'CAP-3'), '') <> '' then
    raise exception 'T2 FALHOU: CAP-3 nao justificado chegou com texto';
  end if;
  if not public.teste_marca_emb('Fim de EMB', 'EMB100') then
    raise exception 'T2 FALHOU: a marca nao foi gravada depois de enfileirar';
  end if;
end $t$;
\echo 'T2 (caso 2: EMB fechada manda as divergencias e as justificativas): ok'

-- ---------- T3 (caso 3): a rodada seguinte não manda de novo ----------
do $t$
declare v_antes int;
begin
  v_antes := public.teste_envios_emb('Fim de EMB', 'EMB100');
  set local role service_role;
  perform public.teste_avaliar();
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Fim de EMB', 'EMB100') <> v_antes then
    raise exception 'T3 FALHOU: a marca nao impediu o reenvio (% -> %)',
      v_antes, public.teste_envios_emb('Fim de EMB', 'EMB100');
  end if;
end $t$;
\echo 'T3 (caso 3: a marca impede o reenvio): ok'

-- ---------- T4 (caso 4): EMB limpa MANDA a mensagem de EMB limpa, e recebe a marca ----------
-- ⚠️ DECISAO REVERTIDA EM 14/10/2026: ate 09/10 este teste exigia o CONTRARIO (EMB sem divergencia
-- nao mandava nada e so recebia a marca). Hoje toda EMB que fecha manda mensagem; sem divergencia,
-- a lista vai VAZIA e o texto diz que fechou limpa. Se este teste voltar a exigir silencio, e a
-- decisao antiga ressurgindo — confira a spec antes de "consertar" a migracao.
select public.teste_item_emb('EMB200', 'RES-1', 'Aprovado', 100, 100);
select public.teste_item_emb('EMB200', 'RES-2', 'Aprovado', 200, 200);
do $t$
declare v_dados jsonb;
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Fim de EMB', 'EMB200') <> 1 then
    raise exception 'T4 FALHOU: EMB limpa nao mandou aviso (esperava 1 linha, achei %)',
      public.teste_envios_emb('Fim de EMB', 'EMB200');
  end if;
  select dados into v_dados from public.alerta_envios
   where tipo = 'emb' and dados->>'emb' = 'EMB200' limit 1;
  -- A lista vem VAZIA, e nao ausente: quem escolhe a frase da EMB limpa e o TS (domain/emb.ts), e
  -- ele precisa distinguir "nenhuma divergencia" de "dado corrompido".
  if v_dados->'divergencias' is null then
    raise exception 'T4 FALHOU: o dados da EMB limpa saiu sem a chave divergencias';
  end if;
  if jsonb_array_length(v_dados->'divergencias') <> 0 then
    raise exception 'T4 FALHOU: EMB limpa mandou divergencia (%)', v_dados->'divergencias';
  end if;
  -- A marca segue a MESMA regra de todo mundo: gravada depois de enfileirar.
  if not public.teste_marca_emb('Fim de EMB', 'EMB200') then
    raise exception 'T4 FALHOU: EMB limpa ficou sem marca e vai ser reavaliada para sempre';
  end if;
  -- E o contador da auditoria anota ZERO divergencia, que e o que responde depois "por que esta
  -- EMB mandou uma mensagem sem lista?".
  if (select a.divergencias from public.alerta_emb_avisada a
        join public.alerta_regras r on r.id = a.regra_id
       where r.nome = 'Fim de EMB' and a.emb = 'EMB200') <> 0 then
    raise exception 'T4 FALHOU: a marca da EMB limpa anotou divergencia';
  end if;
end $t$;
\echo 'T4 (caso 4: EMB limpa manda a mensagem de EMB limpa e recebe marca): ok'

-- ---------- T5 (caso 5): reprovado também é fim ----------
select public.teste_item_emb('EMB300', 'IND-1', 'Reprovado', 50, 45);
do $t$
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Fim de EMB', 'EMB300') <> 1 then
    raise exception 'T5 FALHOU: EMB fechada por reprova nao mandou aviso';
  end if;
end $t$;
\echo 'T5 (caso 5: reprovado tambem e fim): ok'

-- ---------- T6: o piso rg.criado_em ----------
-- Uma EMB fechada ANTES de a regra nascer não pode mandar nada: é isso que impede a avalanche na
-- primeira rodada em produção.
select public.teste_item_emb('EMB900', 'OLD-1', 'Aprovado', 10, 9);
update public.processos_recebimento
   set finalizado_em = now() - interval '90 days', created_at = now() - interval '91 days'
 where numero_emb = 'EMB900';
select public.teste_regra_emb('Fim de EMB nova', array['00000000-0000-0000-0000-0000000000b1']::uuid[], now());
do $t$
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('Fim de EMB nova', 'EMB900') <> 0 then
    raise exception 'T6 FALHOU: EMB fechada antes da regra mandou aviso (a avalanche volta)';
  end if;
end $t$;
\echo 'T6 (piso criado_em: EMB historica nao manda): ok'

-- ---------- T7: há divergência mas ninguém alcançável ----------
-- Regra cujo responsável não tem conta vinculada: nada vai para a fila E a marca NÃO é gravada —
-- quando a pessoa vincular a conta ainda hoje, o aviso sai.
insert into public.usuarios (id, nome, email, ativo, perfil_id) values
  ('00000000-0000-0000-0000-0000000000b2', 'Dora Sem Conta', 'dora@x', true,
   '00000000-0000-0000-0000-0000000000b0')
on conflict (id) do nothing;
select public.teste_regra_emb('EMB sem alcance', array['00000000-0000-0000-0000-0000000000b2']::uuid[]);
select public.teste_item_emb('EMB400', 'DIV-1', 'Aprovado', 80, 70);
do $t$
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  if public.teste_envios_emb('EMB sem alcance', 'EMB400') <> 0 then
    raise exception 'T7 FALHOU: enfileirou para quem nao tem conta';
  end if;
  if public.teste_marca_emb('EMB sem alcance', 'EMB400') then
    raise exception 'T7 FALHOU: marcou sem enviar — o aviso nunca mais sairia';
  end if;
end $t$;
\echo 'T7 (divergencia sem ninguem alcancavel: nao marca): ok'

-- ---------- T8: o fim de EMB não encosta no caminho da ocorrência ----------
do $t$
declare v_oc_antes int; v_oc_depois int; v_res jsonb;
begin
  select count(*) into v_oc_antes from public.alerta_ocorrencias;
  select public.teste_item_emb('EMB500', 'X-1', 'Aprovado', 10, 8);
  set local role service_role;
  v_res := public.teste_avaliar();
  reset role;
  select count(*) into v_oc_depois from public.alerta_ocorrencias;
  if v_oc_depois <> v_oc_antes then
    raise exception 'T8 FALHOU: o fim de EMB abriu ocorrencia (% -> %)', v_oc_antes, v_oc_depois;
  end if;
  -- `avaliadas` continua sendo "itens de posto avaliados": numa rodada só de EMB ele é 0 com
  -- `enfileirados > 0`, e isso NÃO é contradição (mesma nota da 0141).
  if (v_res->>'avaliadas')::int <> 0 then
    raise exception 'T8 FALHOU: avaliadas subiu por causa do fim de EMB (%)', v_res->>'avaliadas';
  end if;
  if exists (select 1 from public.alerta_envios where tipo = 'emb' and com_botao) then
    raise exception 'T8 FALHOU: linha de fim de EMB nasceu com botao Resolvido';
  end if;
  if exists (select 1 from public.alerta_envios where tipo = 'emb' and ocorrencia_id is not null) then
    raise exception 'T8 FALHOU: linha de fim de EMB nasceu com ocorrencia';
  end if;
end $t$;
\echo 'T8 (o fim de EMB nao vira ocorrencia): ok'

-- ---------- T9: o filtro por EMB não vaza ----------
select public.teste_item_emb('EMB600', 'A-1', 'Aprovado', 10, 7);
select public.teste_item_emb('EMB601', 'B-1', 'Aprovado', 10, 3);
do $t$
declare v_divs jsonb;
begin
  set local role service_role;
  perform public.teste_avaliar();
  reset role;
  select dados->'divergencias' into v_divs from public.alerta_envios
   where tipo = 'emb' and dados->>'emb' = 'EMB600' limit 1;
  if jsonb_array_length(coalesce(v_divs, '[]'::jsonb)) <> 1 then
    raise exception 'T9 FALHOU: a mensagem da EMB600 trouxe % divergencias',
      jsonb_array_length(coalesce(v_divs, '[]'::jsonb));
  end if;
  if exists (select 1 from jsonb_array_elements(v_divs) d where d->>'item' = 'B-1') then
    raise exception 'T9 FALHOU: a divergencia da EMB vizinha entrou';
  end if;
end $t$;
\echo 'T9 (o filtro por EMB nao vaza): ok'

-- ---------- T10: os tipos antigos continuam na mesma rodada ----------
do $t$
declare v_res jsonb; v_n int;
begin
  update public.alerta_regras set ativa = true where nome = 'SF modulo';
  insert into public.sf_registros (data_hora, posto, pmo, op, status)
  select now() - interval '1 minute', 'Teste', 'PMOA', '1000', 'reprovado'
    from generate_series(1, 10);
  select public.teste_item_emb('EMB700', 'C-1', 'Aprovado', 10, 6);
  set local role service_role;
  v_res := public.teste_avaliar();
  reset role;
  if (v_res->>'avaliadas')::int < 1 then
    raise exception 'T10 FALHOU: a regra de aprovacao deixou de ser avaliada';
  end if;
  if public.teste_envios_emb('Fim de EMB', 'EMB700') <> 1 then
    raise exception 'T10 FALHOU: o fim de EMB nao saiu na mesma rodada';
  end if;
end $t$;
\echo 'T10 (tipos antigos intactos): ok'

drop function public.teste_regra_emb(text, uuid[], timestamptz);
drop function public.teste_item_emb(text, text, text, numeric, numeric, text, text);
drop function public.teste_envios_emb(text, text);
drop function public.teste_marca_emb(text, text);
drop function public.teste_avaliar();
\echo '0150 (fim de EMB): ok'
```

- [ ] **Step 4: Acrescentar o bloco da 0150 ao runner e ver falhar**

No fim de `supabase/tests/rodar-alertas-test.sh`, antes do `echo "ALERTAS SQL OK"`:

```bash
# ---------- 0150: tipo de regra 'emb' (aviso de fim de EMB) ----------
# Recria o alerta_avaliar sobre o corpo da 0149, com um QUINTO ramo no cursor e um bloco próprio no
# topo do laço. É o teste dela que prova a marca de "já avisei" (o aviso não pode sair duas vezes)
# e o piso criado_em (a primeira rodada não pode avisar toda EMB histórica).
docker cp supabase/migrations/0150_alertas_fim_de_emb.sql "$NOME":/tmp/0150.sql
docker cp supabase/tests/alertas_emb_test.sql "$NOME":/tmp/teste_emb.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0150.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0150.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_emb.sql
echo "0150 (fim de EMB): ok"
```

Run: `supabase/tests/rodar-alertas-test.sh`
Expected: FALHA no `docker cp` da 0150 (arquivo inexistente).

- [ ] **Step 5: Escrever a 0150 — cabeçalho, checks e a tabela da marca**

```sql
-- =============================================================
-- ALERTAS — AVISO DE FIM DE EMB
-- Spec: docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md
--
-- Aplica POR CIMA da 0113/0115/0123/0139/0141/0149 (nenhuma é editada). Idempotente.
--
-- Um tipo de regra novo, 'emb', do módulo RECEBIMENTO: quando TODOS os processos de uma EMB chegam
-- ao fim do fluxo (Almoxarifado ou Reprovado na Qualidade — as duas saídas terminais), sai UMA
-- mensagem com as divergências de quantidade daquela EMB e, em cada uma, a justificativa ou o vazio
-- de quem não justificou. EMB sem nenhuma divergência TAMBÉM manda: a mensagem diz que a EMB
-- fechou e que fechou SEM divergência (decisão 5 da spec, corrigida em 14/10/2026 — a versão
-- original dizia que EMB limpa não mandava nada). Quem escreve a frase é o TS, não esta migração:
-- aqui a EMB limpa enfileira com `divergencias` VAZIA.
--
-- Não abre ocorrência, não tem botão "Resolvido", não insiste e não normaliza — igual ao resumo
-- diário da 0141, de quem este trecho é cópia estrutural.
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0150_alertas_fim_de_emb.sql
--
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app (o app novo manda tipo 'emb', que o banco velho
-- recusa). E DEPOIS da 0149, que é quem cria a coluna `modulo`.
--
-- ⚠️ A REGRA DE FIM DE EMB NÃO TEM POSTO E NÃO TEM JANELA. Ela guarda `postos = '{}'` (o check de
-- `cardinality(postos) > 0` da 0113 é reescrito aqui para abrir exceção SÓ a ela) e
-- `janela_tipo = 'op'` com `janela_valor` nulo. O 'op' é um VALOR DE FACHADA, escolhido porque o
-- ramo dele dos dois checks de janela_valor já aceita valor nulo — assim nenhum dos dois é mexido
-- (um 5º janela_tipo obrigaria a reescrever os dois e o JanelaTipo do domínio por uma grandeza que
-- ninguém mede). Quem lê a regra NUNCA vê esse valor: a coluna "Janela" da lista mostra a frase
-- própria "Quando a EMB fecha" (resumoJanelaRegra, em src/modules/alertas/domain/regra.ts). É o
-- mesmo caminho que o resumo diário abriu ao forçar 'intervalos' e mostrar a hora.
--
-- ⚠️ O PISO rg.criado_em NÃO É DETALHE: sem ele, na PRIMEIRA rodada depois do deploy toda EMB
-- historicamente fechada atenderia ao gatilho e sairia uma avalanche de avisos. Só entram as EMBs
-- cuja última finalização é >= criado_em da regra. Mais um teto de EMBS_POR_RODADA por rodada.
--
-- Convenções (as mesmas da 0113): corpo de função com $func$ (o SQL Editor não aceita dois
-- cifrões, nem em comentário); grants e revokes explícitos; notify pgrst na última linha.
-- =============================================================

-- ---------- o tipo 'emb' ----------
alter table public.alerta_regras drop constraint if exists alerta_regras_tipo_valido;
alter table public.alerta_regras add constraint alerta_regras_tipo_valido
  check (tipo in ('aprovacao', 'tempo', 'defeito', 'resumo', 'emb'));

-- Módulo x tipo (da 0149): agora o Recebimento tem um tipo.
alter table public.alerta_regras drop constraint if exists alerta_regras_modulo_tipo;
alter table public.alerta_regras add constraint alerta_regras_modulo_tipo check (coalesce(
  case modulo
    when 'shopfloor'   then tipo in ('aprovacao', 'tempo', 'defeito', 'resumo')
    when 'recebimento' then tipo in ('emb')
  end, false));

-- Os quatro ramos antigos são IGUAIS aos da 0141; o 'emb' é o único acréscimo. Ele não usa NENHUM
-- campo de medida: nem taxa, nem janela em minutos, nem bipes, nem lembrete, nem limite, nem hora.
alter table public.alerta_regras drop constraint if exists alerta_regras_campos_por_tipo;
alter table public.alerta_regras add constraint alerta_regras_campos_por_tipo check (coalesce(
  case tipo
    when 'aprovacao' then
          taxa_minima is not null and minimo_bipes is not null
      and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null
    when 'tempo' then
          janela_tipo in ('tempo', 'op')
      and limite_tempo_seg between 1 and 3600
      and minimo_bipes is not null
      and (pausa_max_min is null or pausa_max_min between 1 and 240)
      and (pausa_max_min is null or limite_tempo_seg < pausa_max_min * 60)
      and taxa_minima is null and limite_ocorrencias is null
    when 'defeito' then
          janela_tipo = 'tempo'
      and limite_ocorrencias >= 2
      and taxa_minima is null and minimo_bipes is null
      and limite_tempo_seg is null and pausa_max_min is null
    when 'resumo' then
          janela_tipo = 'intervalos'
      and janela_valor is null
      and taxa_minima is null and minimo_bipes is null and lembrete_min is null
      and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null
    when 'emb' then
          janela_tipo = 'op'
      and janela_valor is null
      and cardinality(postos) = 0
      and coalesce(cardinality(pmos), 0) = 0
      and taxa_minima is null and minimo_bipes is null and lembrete_min is null
      and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null
      and hora_resumo is null
  end, false));

-- ---------- `postos` vazio: SÓ no fim de EMB ----------
-- O check de coluna da 0113 (`cardinality(postos) > 0`) tem UMA coluna na expressão, então o
-- Postgres lhe deu nome automático (alerta_regras_postos_check ou parecido). Acha-se pela
-- definição. O novo tem nome próprio, que o loop poupa.
-- ORDEM: o novo entra ANTES de o antigo cair (se o novo falhar numa linha legada, o velho continua
-- no lugar). Mesmo padrão da 0141 com o janela_valor.
alter table public.alerta_regras drop constraint if exists alerta_regras_postos_por_tipo;
alter table public.alerta_regras add constraint alerta_regras_postos_por_tipo
  check ((tipo = 'emb' and cardinality(postos) = 0)
         or (tipo <> 'emb' and cardinality(postos) > 0));

do $func$
declare
  v_nome text;
begin
  for v_nome in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.alerta_regras'::regclass
       and c.contype = 'c'
       and c.conname <> 'alerta_regras_postos_por_tipo'
       and pg_get_constraintdef(c.oid) like '%cardinality(postos) > 0%'
  loop
    execute format('alter table public.alerta_regras drop constraint %I', v_nome);
  end loop;
end
$func$;

-- ---------- o tipo de envio 'emb' ----------
-- Nasce SEM ocorrência (ocorrencia_id nulo, que a coluna permite desde a 0113) e SEM botão. Tipo
-- próprio, para a fila e o texto não o confundirem com alerta, lembrete, resolvido ou resumo.
alter table public.alerta_envios drop constraint if exists alerta_envios_tipo_check;
alter table public.alerta_envios
  add constraint alerta_envios_tipo_check
  check (tipo in ('alerta', 'lembrete', 'resolvido', 'normalizou', 'teste', 'resumo', 'emb'));

-- ---------- a marca de "já avisei" ----------
-- ⚠️ POR QUE UMA TABELA, E NÃO UMA COLUNA COMO O resumo_enviado_em DA 0141: o resumo guarda UMA
-- data por regra porque o evento dele é "o dia". Aqui o evento é "esta EMB", e são muitas por
-- regra. É o MESMO mecanismo (estado gravado no banco, na mesma transação do enfileiramento, só
-- depois de enfileirar) na forma que o grão exige.
--
-- ⚠️ CONSEQUÊNCIA DE REABRIR, ESCRITA DE PROPÓSITO (spec): se um processo de uma EMB já avisada
-- voltar atrás, a EMB deixa de estar fechada; quando fechar de novo, ela NÃO avisa de novo — a
-- marca já está aqui. O aviso é "a EMB fechou", não "a EMB mudou".
create table if not exists public.alerta_emb_avisada (
  regra_id     uuid not null references public.alerta_regras(id) on delete cascade,
  -- Sempre em MAIÚSCULA e aparada: é como rec_embs_fechadas devolve, e é o que faz 'emb390' e
  -- ' EMB390 ' serem a MESMA EMB para a marca (o Recebimento compara EMB assim desde a 0124).
  emb          text not null check (btrim(emb) <> '' and emb = upper(btrim(emb))),
  avisada_em   timestamptz not null default now(),
  -- Para a auditoria responder "quantas divergências esta EMB tinha e para quantas pessoas a
  -- mensagem saiu?" sem reconstituir nada. `divergencias = 0` é a EMB que fechou limpa — e que
  -- TAMBÉM mandou mensagem (decisão 5 da spec, corrigida em 14/10/2026).
  divergencias int not null default 0 check (divergencias >= 0),
  enviados     int not null default 0 check (enviados >= 0),
  primary key (regra_id, emb)
);
alter table public.alerta_emb_avisada enable row level security;

drop policy if exists alerta_emb_avisada_select_admin on public.alerta_emb_avisada;
create policy alerta_emb_avisada_select_admin on public.alerta_emb_avisada
  for select using ((select tem_permissao('recebimento', 'administrar')));

revoke all on public.alerta_emb_avisada from public, anon;
grant select on public.alerta_emb_avisada to authenticated;
grant select, insert, update, delete on public.alerta_emb_avisada to service_role;

comment on table public.alerta_emb_avisada is
  'A marca de "já avisei" do aviso de fim de EMB: uma linha por (regra, EMB). Escrita SÓ pelo banco, dentro da alerta_avaliar, depois de enfileirar. Duas fontes nela = aviso duas vezes.';
```

- [ ] **Step 6: Escrever as duas funções de leitura do Recebimento**

```sql
-- ---------- o GATILHO: quais EMBs estão fechadas ----------
-- Uma EMB está fechada quando tem pelo menos 1 processo e TODOS eles estão num terminal. Terminal =
-- rec_etapa_por_status() em ('almoxarifado', 'reprovado'): o item reprovado também terminou, só que
-- pelo outro lado (spec: "não é 'saiu da Qualidade'").
--
-- `fechada_em` é a última finalização da EMB. coalesce(finalizado_em, created_at) porque o
-- histórico antigo tem terminal sem finalizado_em; cair no created_at joga a EMB para TRÁS no
-- tempo, então ela fica abaixo do piso e NÃO avisa — erra para o lado de calar, não de inundar.
--
-- ⚠️ p_desde é o PISO (o criado_em da regra). Sem ele, a primeira rodada em produção avisaria toda
-- EMB historicamente fechada.
--
-- Função INTERNA: só a alerta_avaliar (security definer, do owner) a chama. Sem tem_permissao
-- próprio e revogada de todos — ninguém a alcança de fora.
create or replace function public.rec_embs_fechadas(p_desde timestamptz)
returns table (emb text, fechada_em timestamptz)
language sql
stable
security definer
set search_path = public
as $func$
  select upper(btrim(p.numero_emb)) as emb,
         max(coalesce(p.finalizado_em, p.created_at)) as fechada_em
    from public.processos_recebimento p
   where coalesce(btrim(p.numero_emb), '') <> ''
   group by upper(btrim(p.numero_emb))
  having bool_and(public.rec_etapa_por_status(p.status) in ('almoxarifado', 'reprovado'))
     and max(coalesce(p.finalizado_em, p.created_at)) >= p_desde
$func$;

revoke all on function public.rec_embs_fechadas(timestamptz)
  from public, anon, authenticated, service_role;

-- ---------- o CONTEÚDO: as divergências de uma EMB, com as justificativas ----------
-- Só os itens que CARREGAM a marca de divergência (rec_divergente: vazio = não conferido, não é
-- divergência; zero = sem divergência; texto que não é número = sem divergência). A justificativa
-- vem como está: VAZIA quando ninguém justificou — é justamente a que precisa de ação, e quem
-- escolhe a palavra para o vazio é o TS (domain/emb.ts), não o SQL.
create or replace function public.rec_emb_divergencias(p_emb text)
returns table (
  numero bigint, item text, descricao text,
  quantidade_pedido numeric, quantidade_recebida numeric, divergencia text,
  justificativa text, justificada_por_nome text, justificada_em timestamptz
)
language sql
stable
security definer
set search_path = public
as $func$
  select p.numero,
         coalesce(p.codigo_material, ''),
         coalesce(p.descricao_material, ''),
         p.quantidade_pedido,
         p.quantidade_recebida,
         coalesce(p.divergencia, ''),
         coalesce(p.divergencia_justificativa, ''),
         coalesce(p.divergencia_justificada_por_nome, ''),
         p.divergencia_justificada_em
    from public.processos_recebimento p
   where upper(btrim(coalesce(p.numero_emb, ''))) = upper(btrim(coalesce(p_emb, '')))
     and public.rec_divergente(p.divergencia)
   order by p.numero
$func$;

revoke all on function public.rec_emb_divergencias(text)
  from public, anon, authenticated, service_role;
```

- [ ] **Step 7: Recriar `alerta_avaliar` com o 5º ramo e o bloco do fim de EMB**

Escreva o bloco de diferenças declaradas antes do `create`:

```sql
-- ---------------------------------------------------------------------------------------------
-- ⚠️ FUNÇÃO EM PRODUÇÃO QUE ESTE TRECHO RECRIA, E AS ÚNICAS DIFERENÇAS DECLARADAS
--
-- public.alerta_avaliar(text, jsonb, jsonb) — a versão viva é a da 0149 — 4 diferenças:
--   1. variáveis novas (v_emb record, v_divs jsonb, v_emb_n int), só do fim de EMB;
--   2. um QUINTO ramo no `union all` do cursor: uma linha por regra de fim de EMB ativa, com
--      avaliavel = false e valor/limite nulos;
--   3. UM bloco no topo do laço, `if t.tipo = 'emb' then ... continue; end if;`, DEPOIS do bloco
--      do resumo;
--   4. a constante EMBS_POR_RODADA (50) escrita no `limit` desse bloco.
--   NADA MAIS muda: a trava advisory, o encerramento por regra desativada, os quatro ramos
--   anteriores do cursor, o bloco do resumo, o mínimo de bipes, o v_abaixo, o
--   `select ... for update`, abrir / normalizar / insistir / reabrir, o bloco_reportado, o `dados`
--   e as duas filas ficam byte a byte iguais. A assinatura NÃO muda: sem `drop function`.
--
-- ⚠️ POR QUE UMA SAÍDA ÚNICA NO TOPO, E NÃO `t.tipo not in ('resumo','emb')` ESPALHADO: é a mesma
-- razão escrita na 0141. O caminho da ocorrência tem seis passos numa função de ~450 linhas sem
-- teste de unidade; uma condição em cada um seria seis chances de esquecer uma, e esquecer não dá
-- erro — dá ocorrência fantasma de EMB, botão "Resolvido" num aviso de EMB ou o aviso reenviado a
-- cada 5 minutos. A linha do cursor ainda sai com avaliavel = false: se o bloco do topo for
-- removido por engano, a primeira guarda do caminho antigo pula a linha em vez de abrir ocorrência.
--
-- ⚠️ A MARCA (alerta_emb_avisada) É GRAVADA EM UM LUGAR SÓ, e por UM critério só: algo entrou na
--   fila. Ninguém alcançável (responsável sem conta vinculada) NÃO grava: quando a pessoa vincular
--   a conta, o aviso sai; o custo de esperar é uma consulta a cada 5 min, e não há envio duplicado.
--   É exatamente o critério do resumo diário, sem exceção nenhuma.
--   ⚠️ CORRIGIDO EM 14/10/2026: havia aqui um segundo caso — "a EMB fechou sem nenhuma divergência"
--   —, necessário porque a EMB limpa não mandava mensagem e precisava ser marcada de algum jeito.
--   Com a decisão 5 corrigida (toda EMB que fecha manda mensagem), esse caso DESAPARECEU: toda EMB
--   fechada enfileira, logo toda EMB fechada e alcançável recebe a marca pelo caminho normal.
-- ---------------------------------------------------------------------------------------------
```

As variáveis novas, junto das do resumo:

```sql
  -- Só o fim de EMB usa estas (ver o bloco no topo do laço).
  v_emb          record;
  v_divs         jsonb;
  v_emb_n        int;
```

O 5º ramo do cursor, depois do ramo do resumo:

```sql
        union all
        -- Fim de EMB (0150): UMA linha por regra, nunca uma por EMB — quem abre as EMBs é o bloco
        -- do topo do laço (como no resumo diário). Toda regra de fim de EMB ATIVA entra: não há
        -- mapa vindo do app aqui, porque não há conta de fuso nenhuma nesta feature (o gatilho é
        -- "todos os processos terminais", não um horário).
        -- ⚠️ `avaliavel = false`, `valor`/`limite` nulos: cinto E suspensório, igual ao resumo.
        select rg.id, rg.nome, rg.tipo, rg.modulo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.avisar_pessoas, rg.avisar_canal, rg.criado_em,
               null::text, null::text, null::text, null::text,
               0, 0,
               0,
               false,
               null::numeric,
               null::numeric,
               '{}'::text[], '[]'::jsonb,
               null::timestamptz, null::timestamptz
          from public.alerta_regras rg
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'emb'
```

⚠️ A ordem das colunas tem de bater **exatamente** com a dos outros quatro ramos (o `union all` é
posicional). Conte as colunas do ramo da aprovação antes de escrever este, e não confie na memória.
`rg.modulo` entrou na 0149 como 4ª coluna — confirme a posição no arquivo da 0149.

O bloco no laço, **depois** do bloco do resumo e antes do `v_avaliadas := v_avaliadas + 1;`:

```sql
    -- ⚠️ O FIM DE EMB (0150) SAI POR AQUI E POR MAIS LUGAR NENHUM (ver o aviso do cabeçalho).
    -- Também não conta em `avaliadas`, que continua sendo "itens de posto avaliados": numa rodada
    -- só de fim de EMB o retorno traz `avaliadas: 0` com `enfileirados > 0`, e isso NÃO é
    -- contradição.
    if t.tipo = 'emb' then
      for v_emb in
        -- O PISO é o criado_em DA REGRA (ver o cabeçalho): EMB fechada antes de a regra existir
        -- não avisa. O teto de 50 por rodada é cinto e suspensório — com 200 pendentes, saem em
        -- quatro rodadas (20 min) em vez de 200 mensagens de uma vez. Mais antigas primeiro.
        select f.emb, f.fechada_em
          from public.rec_embs_fechadas(t.criado_em) f
         where not exists (select 1
                             from public.alerta_emb_avisada a
                            where a.regra_id = t.regra_id and a.emb = f.emb)
         order by f.fechada_em, f.emb
         limit 50
      loop
        -- SÓ as divergências, com a justificativa de cada uma (decisão 4 da spec). Quem decide o
        -- texto do "ninguém justificou" é o TS: aqui a justificativa vazia viaja vazia.
        select coalesce(jsonb_agg(jsonb_build_object(
                          'numero',              d.numero,
                          'item',                d.item,
                          'descricao',           d.descricao,
                          'quantidade_pedido',   d.quantidade_pedido,
                          'quantidade_recebida', d.quantidade_recebida,
                          'divergencia',         d.divergencia,
                          'justificativa',       d.justificativa,
                          'justificada_por_nome', d.justificada_por_nome)
                        order by d.numero), '[]'::jsonb)
          into v_divs
          from public.rec_emb_divergencias(v_emb.emb) d;

        v_emb_n := 0;

        -- ⚠️ TODA EMB QUE FECHA MANDA MENSAGEM (decisão 5 da spec, corrigida em 14/10/2026). Com
        -- divergência, a lista viaja no `dados`; SEM divergência, `divergencias` viaja VAZIA (`[]`)
        -- e quem escreve a frase "fechou sem divergência" é o TS (domain/emb.ts) — esta migração
        -- não decide texto nenhum. Por isso NÃO há aqui nenhum `if` em volta do `jsonb_build_object`
        -- e do fan-out: a EMB limpa percorre exatamente o mesmo caminho da EMB divergente.
        -- ⚠️ Até 09/10 este bloco começava com `if jsonb_array_length(v_divs) > 0 then` e PULAVA a
        -- EMB limpa. Se esse `if` reaparecer, é a decisão antiga ressurgindo: confira a spec.
        v_dados := jsonb_build_object(
                     'regra_tipo',   t.tipo,
                     'regra_nome',   t.nome,
                     'emb',          v_emb.emb,
                     'fechada_em',   v_emb.fechada_em,
                     'divergencias', v_divs,
                     'agora',        v_agora);

        -- Mesmas duas filas do resumo, SEM ocorrência, sem botão, com o tipo de envio 'emb' e o
        -- módulo da regra congelado na linha (0149).
        if t.avisar_pessoas then
          insert into public.alerta_envios
            (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
          select null, c.usuario_id, c.canal, 'emb', t.modulo, v_dados, false, 'usuario'
            from public.alerta_contas c
            join public.usuarios u on u.id = c.usuario_id and u.ativo
           where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
             and public.usuario_tem_permissao(c.usuario_id, t.modulo, 'administrar')
           order by c.usuario_id, c.canal;
          get diagnostics v_n = row_count;
          v_emb_n := v_emb_n + v_n;
        end if;

        if t.avisar_canal and v_canal is not null then
          insert into public.alerta_envios
            (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo,
             destino_externo_id)
          select null, null, 'discord', 'emb', t.modulo, v_dados, false, 'canal', v_canal;
          get diagnostics v_n = row_count;
          v_emb_n := v_emb_n + v_n;
        end if;

        v_enfileirados := v_enfileirados + v_emb_n;

        -- A MARCA (ver o aviso do cabeçalho): UM critério só, igual ao do resumo diário — grava
        -- depois de enfileirar, e só se algo foi para a fila. Ninguém alcançável NÃO grava: volta
        -- na próxima rodada, com ou sem divergência.
        if v_emb_n > 0 then
          insert into public.alerta_emb_avisada (regra_id, emb, avisada_em, divergencias, enviados)
          values (t.regra_id, v_emb.emb, v_agora, jsonb_array_length(v_divs), v_emb_n)
          -- Corrida (cron atrasado + "Avaliar agora"): a trava advisory já impede, e o `do nothing`
          -- é a terceira linha de defesa. Nunca sobrescreve a marca que já existe.
          on conflict (regra_id, emb) do nothing;
        else
          -- Havia o que avisar (ainda que fosse só "a EMB fechou limpa") e ninguém alcançável. Sem
          -- este rastro, uma regra cujos responsáveis nunca vincularam conta deixaria o aviso sem
          -- sair toda rodada, sem log e sem contador.
          raise log 'alerta_avaliar: EMB % da regra % (%) nao foi avisada (% divergencia(s)): ninguem alcancavel',
            v_emb.emb, t.regra_id, t.nome, jsonb_array_length(v_divs);
        end if;
      end loop;

      continue;
    end if;
```

E, no fim do arquivo, `notify pgrst, 'reload schema';`.

- [ ] **Step 8: Rodar o teste SQL e ver passar**

Run: `supabase/tests/rodar-alertas-test.sh`
Expected: `T0`–`T10` com `ok`, `0150 (fim de EMB): ok` e `ALERTAS SQL OK`.

- [ ] **Step 9: Sabotar os dois testes que mais importam**

Antes de dar a tarefa por feita, prove que T3 e T6 medem algo. Faça duas rodadas, uma de cada vez,
numa cópia do arquivo da migração:

1. Tire o `where not exists (... alerta_emb_avisada ...)` do laço. Expected: **T3 falha** com
   "a marca nao impediu o reenvio".
2. Troque `rec_embs_fechadas(t.criado_em)` por `rec_embs_fechadas('-infinity'::timestamptz)`.
   Expected: **T6 falha** com "EMB fechada antes da regra mandou aviso (a avalanche volta)".

Se algum dos dois **passar** sabotado, o teste não está medindo o que diz — conserte o teste antes
de seguir. Desfaça as duas sabotagens.

- [ ] **Step 10: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
git add supabase/migrations/0150_alertas_fim_de_emb.sql supabase/tests/alertas_emb_test.sql supabase/tests/_stubs.sql supabase/tests/rodar-alertas-test.sh
git commit -m "feat(alertas): tipo de regra Fim de EMB no banco

Quando TODOS os processos de uma EMB chegam a um terminal (Almoxarifado ou Reprovado na
Qualidade), o cron enfileira UMA mensagem com as divergencias de quantidade daquela EMB
e a justificativa de cada uma. EMB que fecha SEM divergencia tambem manda: a lista vai
vazia e o texto diz que ela fechou sem divergencia (decisao 5 da spec, corrigida em
14/10/2026; a versao de 09/10 dizia que EMB limpa nao mandava nada).

A marca de 'ja avisei' e a tabela alerta_emb_avisada, com PK (regra_id, emb): o resumo
diario guarda uma data por regra porque o evento dele e o dia; aqui o evento e a EMB.
Gravada depois de enfileirar, por um criterio so (algo entrou na fila); EMB cujos
responsaveis nao tem conta vinculada nao grava e volta na proxima rodada.

O piso criado_em da regra impede que a primeira rodada avise toda EMB historicamente
fechada. O fim de EMB sai do laco por um bloco unico no topo, como o resumo diario: o
caminho da ocorrencia nao ganhou condicao nenhuma e nunca ve uma regra de EMB.

Spec: docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md (decisoes 3, 4 e 5;
casos 1 a 5)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: O tipo "Fim de EMB" no domínio e a mensagem

**Files:**
- Create: `src/modules/alertas/domain/emb.ts`
- Create: `src/modules/alertas/domain/__tests__/emb.test.ts`
- Create: `src/modules/alertas/domain/__tests__/envio-emb.test.ts`
- Create: `src/modules/alertas/domain/__tests__/regra-emb.test.ts`
- Modify: `src/modules/alertas/domain/tipos.ts` (`TipoRegra`, `TIPOS_REGRA`, `NOME_TIPO_REGRA`, `DESCRICAO_TIPO_REGRA`, `ehTipoRegra`, `TipoEnvio`)
- Modify: `src/modules/alertas/domain/modulo.ts` (`TIPOS_REGRA_POR_MODULO.recebimento = ['emb']`)
- Modify: `src/modules/alertas/domain/regra.ts` (ramo `'emb'` em `validarRegra`, `resumoLimite`, `resumoJanelaRegra`)
- Modify: `src/modules/alertas/domain/envio.ts` (`TIPOS`, `textoDoEnvio`, `textoEmbDe`)
- Modify: `src/modules/alertas/domain/postos-regra.ts` (`postoServeAoTipo`)
- Modify: `src/modules/alertas/domain/__tests__/modulo.test.ts` (o tipo do Recebimento agora existe)

**Interfaces:**
- Consumes (Task 4): o formato do `dados` da linha de fila de tipo `'emb'`.
- Produces, para a Task 6:
  ```ts
  // src/modules/alertas/domain/emb.ts
  export interface DivergenciaEmb {
    numero: number
    item: string
    descricao: string
    quantidadePedido: number | null
    quantidadeRecebida: number | null
    divergencia: string
    justificativa: string
    justificadaPorNome: string
  }
  // Lista VAZIA = EMB limpa: devolve a mensagem própria de "fechou sem divergência" (decisão 5
  // da spec, corrigida em 14/10/2026 — toda EMB que fecha manda mensagem).
  export function textoEmb(nomeRegra: string, emb: string, divergencias: readonly DivergenciaEmb[]): string
  export const JANELA_EMB: string      // 'Quando a EMB fecha'
  export const LIMITE_EMB: string      // 'Divergências sem justificativa'
  ```
  - `TipoRegra` ganha `'emb'`; `NOME_TIPO_REGRA.emb = 'Fim de EMB'`.
  - `TipoEnvio` ganha `'emb'`.
  - `TIPOS_REGRA_POR_MODULO.recebimento = ['emb']`.
  - `validarRegra` com `tipo: 'emb'` devolve `postos: []`, `janelaTipo: 'op'`, `janelaValor: null`,
    `pmos: []` e todos os campos de medida em `null`.

- [ ] **Step 1: Escrever o teste da mensagem**

Crie `src/modules/alertas/domain/__tests__/emb.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { textoEmb, type DivergenciaEmb } from '../emb'
import { LIMITE_MENSAGEM } from '../mensagens'

function div(o: Partial<DivergenciaEmb> = {}): DivergenciaEmb {
  return {
    numero: 1234,
    item: 'CAP-001',
    descricao: 'CAPACITOR 100UF',
    quantidadePedido: 500,
    quantidadeRecebida: 490,
    divergencia: '-10',
    justificativa: '',
    justificadaPorNome: '',
    ...o,
  }
}

describe('textoEmb', () => {
  it('a primeira linha diz a EMB e quantas divergências são (é o assunto do e-mail)', () => {
    const t = textoEmb('Fim de EMB', 'EMB390', [div(), div({ numero: 1235, item: 'RES-002' })])
    expect(t.split('\n')[0]).toContain('EMB390')
    expect(t.split('\n')[0]).toContain('2 divergências')
  })

  it('concorda no singular', () => {
    const t = textoEmb('Fim de EMB', 'EMB390', [div()])
    expect(t.split('\n')[0]).toContain('1 divergência')
  })

  it('mostra o item, o pedido, o recebido e a diferença', () => {
    const t = textoEmb('Fim de EMB', 'EMB390', [div()])
    expect(t).toContain('CAP-001')
    expect(t).toContain('CAPACITOR 100UF')
    expect(t).toContain('500')
    expect(t).toContain('490')
    expect(t).toContain('-10')
  })

  it('mostra a justificativa e quem escreveu', () => {
    const t = textoEmb('Fim de EMB', 'EMB390', [
      div({ justificativa: 'Fornecedor avisou falta.', justificadaPorNome: 'Ana Gestora' }),
    ])
    expect(t).toContain('Fornecedor avisou falta.')
    expect(t).toContain('Ana Gestora')
  })

  it('marca em destaque quem NÃO foi justificado — é a que precisa de ação', () => {
    const t = textoEmb('Fim de EMB', 'EMB390', [div({ justificativa: '   ' })])
    expect(t).toContain('sem justificativa')
  })

  it('cabe no limite do Discord mesmo com muitas divergências', () => {
    const muitas = Array.from({ length: 300 }, (_, i) =>
      div({ numero: 1000 + i, item: `IT-${i}`, justificativa: 'x'.repeat(120) }),
    )
    const t = textoEmb('Fim de EMB', 'EMB390', muitas)
    expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
    // O corte avisa quantas ficaram de fora, em vez de calar.
    expect(t).toMatch(/e mais \d+ (divergência|divergências)/)
  })

  // ⚠️ Decisão 5 da spec, CORRIGIDA EM 14/10/2026: toda EMB que fecha manda mensagem. A versão de
  // 09/10 deste teste só exigia "devolve só o cabeçalho", como defesa de um caso que o banco nunca
  // enfileirava. Hoje o banco enfileira a EMB limpa, e esta é a mensagem que a pessoa recebe.
  it('EMB sem divergência nenhuma avisa que fechou SEM divergência', () => {
    const t = textoEmb('Fim de EMB', 'EMB390', [])
    expect(t).toContain('EMB390')
    expect(t).toContain('sem divergência')
    expect(t).toContain('Fim de EMB')
    // Uma linha só: ela é o assunto do e-mail e não há lista para mostrar.
    expect(t.split('\n').length).toBe(1)
    // E NÃO sai pelo cabeçalho das divergências, que diria "0 divergências de quantidade" —
    // mensagem que soa como alerta de nada.
    expect(t).not.toContain('0 divergências')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/domain/__tests__/emb.test.ts`
Expected: FAIL — `Failed to resolve import "../emb"`.

- [ ] **Step 3: Escrever `domain/emb.ts`**

Use `listaComCorte` de `mensagens.ts` — ela já resolve o corte com aviso. Ela é privada hoje;
**exporte-a** (`export function listaComCorte(...)`) e documente no comentário dela que o fim de
EMB também a usa.

```ts
import { LIMITE_MENSAGEM, cortarUtf16, listaComCorte } from './mensagens'

/** Um item divergente da EMB, como a mensagem precisa dele (o `dados` da fila, já lido). */
export interface DivergenciaEmb {
  numero: number
  item: string
  descricao: string
  quantidadePedido: number | null
  quantidadeRecebida: number | null
  /** O valor como o banco guarda (texto): '-10', '5', '1,5'. Mostrado como está. */
  divergencia: string
  /** Vazia = ninguém justificou. É justamente a que precisa de ação. */
  justificativa: string
  justificadaPorNome: string
}

/** A frase da coluna "Janela" da lista de regras. A regra de fim de EMB não tem janela. */
export const JANELA_EMB = 'Quando a EMB fecha'

/** A frase da coluna "Limite". A regra de fim de EMB não tem limite: ela tem um gatilho. */
export const LIMITE_EMB = 'Todos os processos no fim'

const n = (v: number, s: string, p: string) => `${v} ${v === 1 ? s : p}`

function numeroOuTraco(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : String(v)
}

/**
 * A mensagem do fim de EMB. TODA EMB que fecha manda uma (decisão 5 da spec, corrigida em
 * 14/10/2026):
 *
 *  - com divergência: uma linha de cabeçalho e, por divergência, duas linhas — o item com as
 *    quantidades e, abaixo, a justificativa ou a marca de que ninguém justificou;
 *  - sem divergência: UMA linha, dizendo que a EMB fechou e que fechou sem divergência. Ela não é
 *    o cabeçalho com "0 divergências": quem lê precisa saber na primeira linha que não há nada a
 *    fazer. ⚠️ Até 09/10 a EMB limpa não mandava mensagem nenhuma, e esta função só devolvia o
 *    cabeçalho por defesa.
 *
 * ⚠️ A PRIMEIRA LINHA É O ASSUNTO DO E-MAIL (o cliente de e-mail parte o texto na primeira quebra,
 * ver `infra/email.ts`): ela tem de dizer sozinha de que EMB se trata e quantas divergências são
 * — ou que não houve nenhuma, no caso da EMB limpa.
 * Mexer na ordem das linhas muda o assunto do e-mail.
 *
 * ⚠️ Uma EMB com muitas divergências passaria dos 2000 do Discord, que RECUSA a mensagem inteira.
 * O corte é o mesmo das posições e do resumo (`listaComCorte`): "… e mais 12 divergências". O
 * orçamento é o que sobra do limite depois do cabeçalho e do `\n` que o separa da lista. Sem
 * MARGEM_CABECALHO: o fim de EMB não vira lembrete nem reabertura, ninguém embrulha este texto.
 */
export function textoEmb(
  nomeRegra: string,
  emb: string,
  divergencias: readonly DivergenciaEmb[],
): string {
  // A EMB limpa tem texto PRÓPRIO, e sai por aqui antes de qualquer lista.
  if (divergencias.length === 0) {
    return cortarUtf16(
      `✅ ${emb} fechou sem divergência de quantidade · ${nomeRegra}`,
      LIMITE_MENSAGEM,
    )
  }

  // Nome de regra absurdo: o próprio cabeçalho cederia o limite, então é ele que é aparado.
  const cabecalho = cortarUtf16(
    `📦 ${emb} fechou — ${n(divergencias.length, 'divergência', 'divergências')} de quantidade · ${nomeRegra}`,
    LIMITE_MENSAGEM,
  )

  const itens = divergencias.map((d) => {
    const identidade = [`#${d.numero}`, d.item, d.descricao].filter((p) => p !== '').join(' ')
    const quantidades =
      `pedido ${numeroOuTraco(d.quantidadePedido)}, ` +
      `recebido ${numeroOuTraco(d.quantidadeRecebida)} (${d.divergencia})`
    const texto = d.justificativa.trim()
    const quem = d.justificadaPorNome.trim()
    const explicacao =
      texto === ''
        ? '   ↳ ⚠️ sem justificativa'
        : `   ↳ ${texto}${quem === '' ? '' : ` (${quem})`}`
    return `${identidade} · ${quantidades}\n${explicacao}`
  })

  const lista = listaComCorte(
    itens,
    LIMITE_MENSAGEM - cabecalho.length - 1,
    'divergência',
    'divergências',
    '\n',
  )
  // Nem uma divergência cabe com o aviso (nome de regra gigante): a mensagem inteira vale mais que
  // a lista. Mesma saída do resumo diário.
  return lista === '' ? cabecalho : `${cabecalho}\n${lista}`
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/domain/__tests__/emb.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Escrever o teste de `textoDoEnvio` com tipo `'emb'`**

Crie `src/modules/alertas/domain/__tests__/envio-emb.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { textoDoEnvio } from '../envio'

const DADOS = {
  regra_tipo: 'emb',
  regra_nome: 'Fim de EMB',
  emb: 'EMB390',
  fechada_em: '2026-10-09T14:00:00Z',
  agora: '2026-10-09T14:05:00Z',
  divergencias: [
    {
      numero: 1234,
      item: 'CAP-001',
      descricao: 'CAPACITOR 100UF',
      quantidade_pedido: 500,
      quantidade_recebida: 490,
      divergencia: '-10',
      justificativa: 'Fornecedor avisou falta.',
      justificada_por_nome: 'Ana Gestora',
    },
    {
      numero: 1235,
      item: 'RES-002',
      descricao: 'RESISTOR 1K',
      quantidade_pedido: 100,
      quantidade_recebida: 105,
      divergencia: '5',
      justificativa: '',
      justificada_por_nome: '',
    },
  ],
}

describe('textoDoEnvio com tipo emb', () => {
  it('monta a mensagem a partir do dados que a 0150 grava', () => {
    const t = textoDoEnvio('emb', DADOS)
    expect(t).toContain('EMB390')
    expect(t).toContain('CAP-001')
    expect(t).toContain('Fornecedor avisou falta.')
    expect(t).toContain('sem justificativa')
  })

  it('aceita quantidade nula (campo em branco no Recebimento)', () => {
    const t = textoDoEnvio('emb', {
      ...DADOS,
      divergencias: [{ ...DADOS.divergencias[0], quantidade_pedido: null }],
    })
    expect(t).toContain('pedido —')
  })

  it('lança quando `divergencias` não é lista (dado corrompido)', () => {
    expect(() => textoDoEnvio('emb', { ...DADOS, divergencias: 'nada' })).toThrow()
  })

  it('lança quando `emb` falta — nunca manda uma mensagem sem dizer de que EMB é', () => {
    const { emb: _emb, ...semEmb } = DADOS
    expect(() => textoDoEnvio('emb', semEmb)).toThrow()
  })

  it('lança quando um item da lista não é objeto', () => {
    expect(() => textoDoEnvio('emb', { ...DADOS, divergencias: ['x'] })).toThrow()
  })
})
```

- [ ] **Step 6: Rodar, ver falhar, implementar, ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/domain/__tests__/envio-emb.test.ts`
Expected: FAIL — `'emb'` não é um `TipoEnvio`.

Em `domain/tipos.ts`:

```ts
/** Tipos de mensagem gravados em `alerta_envios.tipo`. */
export type TipoEnvio =
  | 'alerta' | 'lembrete' | 'resolvido' | 'normalizou' | 'teste' | 'resumo' | 'emb'

/** Tipo da regra (spec 2026-09-18 e 2026-10-09). O tipo não muda depois de criado. */
export type TipoRegra = 'aprovacao' | 'tempo' | 'defeito' | 'resumo' | 'emb'
export const TIPOS_REGRA: readonly TipoRegra[] = ['aprovacao', 'tempo', 'defeito', 'resumo', 'emb']

export const NOME_TIPO_REGRA: Record<TipoRegra, string> = {
  aprovacao: 'Taxa de aprovação',
  tempo: 'Tempo médio por peça',
  defeito: 'Defeito repetido',
  resumo: 'Resumo diário',
  emb: 'Fim de EMB',
}

export const DESCRICAO_TIPO_REGRA: Record<TipoRegra, string> = {
  aprovacao: 'Avisa quando a taxa de aprovação do posto cai abaixo da meta.',
  tempo: 'Avisa quando o tempo médio entre um bipe e o próximo passa do limite.',
  defeito: 'Avisa quando o mesmo defeito se repete várias vezes no posto em pouco tempo.',
  resumo: 'Manda, na hora escolhida, a taxa de aprovação do dia de cada posto.',
  emb: 'Quando todos os processos de uma EMB terminam, lista as divergências de quantidade dela e as justificativas.',
}

export function ehTipoRegra(valor: unknown): valor is TipoRegra {
  return (
    valor === 'aprovacao' ||
    valor === 'tempo' ||
    valor === 'defeito' ||
    valor === 'resumo' ||
    valor === 'emb'
  )
}
```

Em `domain/envio.ts`:

```ts
// 1. o import
import { textoEmb, type DivergenciaEmb } from './emb'

// 2. a lista de tipos de envio
const TIPOS: readonly TipoEnvio[] = [
  'alerta', 'lembrete', 'resolvido', 'normalizou', 'teste', 'resumo', 'emb',
]

// 3. o leitor do `dados`, ao lado de textoResumoDe
/**
 * Lê o `dados` do fim de EMB como a 0150 o grava: `emb`, `regra_nome` e `divergencias` (array de
 * {numero, item, descricao, quantidade_pedido, quantidade_recebida, divergencia, justificativa,
 * justificada_por_nome}). Formato diferente do esperado LANÇA — nunca devolve uma mensagem vazia
 * calada: o despachante registra o erro com o id do envio e os outros envios seguem.
 */
function textoEmbDe(dados: Record<string, unknown>): string {
  const emb = texto(dados, 'emb')
  if (emb.trim() === '') throw new DadosEnvioInvalidos('emb')
  if (!Array.isArray(dados.divergencias)) throw new DadosEnvioInvalidos('divergencias')
  const divergencias: DivergenciaEmb[] = dados.divergencias.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new DadosEnvioInvalidos('divergencias')
    }
    const d = item as Record<string, unknown>
    return {
      numero: numero(d, 'numero'),
      item: texto(d, 'item'),
      descricao: texto(d, 'descricao'),
      // Quantidade é campo livre no Recebimento e pode estar em branco: nulo é legítimo e a
      // mensagem mostra '—'. Só o que NÃO é número nem nulo é dado corrompido.
      quantidadePedido: numeroOuNulo(d, 'quantidade_pedido'),
      quantidadeRecebida: numeroOuNulo(d, 'quantidade_recebida'),
      divergencia: texto(d, 'divergencia'),
      justificativa: texto(d, 'justificativa'),
      justificadaPorNome: texto(d, 'justificada_por_nome'),
    }
  })
  return textoEmb(texto(dados, 'regra_nome'), emb, divergencias)
}

// 4. o despacho, logo depois do do resumo
export function textoDoEnvio(tipo: TipoEnvio, dados: Record<string, unknown>): string {
  if (tipo === 'teste') return textoTeste(texto(dados, 'nome'))
  if (tipo === 'resumo') return textoResumoDe(dados)
  if (tipo === 'emb') return textoEmbDe(dados)
  // ...o resto como está
}
```

⚠️ `numeroOuNulo(d, campo)` não existe em `envio.ts` hoje — há `numero` (que lança) e
`textoOuNulo`. Escreva o helper ao lado deles:

```ts
/** Número que PODE faltar: nulo/ausente vale null; qualquer outra coisa é dado corrompido. */
function numeroOuNulo(d: Record<string, unknown>, campo: string): number | null {
  const v = d[campo]
  if (v === null || v === undefined) return null
  return numero(d, campo)
}
```

E acrescente `emb` à lista de chaves do comentário grande de `textoDoEnvio`:

```
 *   emb: regra_tipo, regra_nome, emb, fechada_em, divergencias (array de {numero, item, descricao,
 *        quantidade_pedido, quantidade_recebida, divergencia, justificativa, justificada_por_nome}; 0150)
```

Run de novo: PASS.

- [ ] **Step 7: Escrever o teste da validação da regra de fim de EMB**

Crie `src/modules/alertas/domain/__tests__/regra-emb.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resumoJanelaRegra, resumoLimite, validarRegra, type EntradaRegra } from '../regra'

function entrada(o: Partial<EntradaRegra> = {}): EntradaRegra {
  return {
    modulo: 'recebimento',
    tipo: 'emb',
    nome: 'Fim de EMB',
    postos: [],
    taxaMinima: '',
    janelaTipo: '',
    janelaValor: null,
    minimoBipes: '',
    lembreteMin: null,
    canais: ['telegram'],
    destinatarios: ['u1'],
    ativa: true,
    ...o,
  }
}

describe('validarRegra no tipo emb', () => {
  it('aceita sem posto, sem janela e sem limite', () => {
    const r = validarRegra(entrada())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.postos).toEqual([])
    // A janela é de fachada: 'op' com valor nulo é o que o banco aceita sem mexer nos checks.
    expect(r.valor.janelaTipo).toBe('op')
    expect(r.valor.janelaValor).toBeNull()
    expect(r.valor.pmos).toEqual([])
    expect(r.valor.taxaMinima).toBeNull()
    expect(r.valor.minimoBipes).toBeNull()
    expect(r.valor.lembreteMin).toBeNull()
    expect(r.valor.horaResumo).toBeNull()
    expect(r.valor.intervalos).toEqual([])
  })

  it('ignora a janela que o formulário mandar (como o resumo diário faz)', () => {
    const r = validarRegra(entrada({ janelaTipo: 'intervalos', janelaValor: '60' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valor.janelaTipo).toBe('op')
  })

  it('ignora posto e PMO que o formulário mandar', () => {
    const r = validarRegra(entrada({ postos: ['Teste'], pmos: ['PMOA'] }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valor.postos).toEqual([])
      expect(r.valor.pmos).toEqual([])
    }
  })

  it('recusa o campo de medida que não é dele', () => {
    expect(validarRegra(entrada({ taxaMinima: '90' })).ok).toBe(false)
    expect(validarRegra(entrada({ limiteOcorrencias: '5' })).ok).toBe(false)
    expect(validarRegra(entrada({ lembreteMin: '30' })).ok).toBe(false)
    expect(validarRegra(entrada({ horaResumo: '18:00' })).ok).toBe(false)
  })

  it('continua exigindo nome, responsável e um canal', () => {
    expect(validarRegra(entrada({ nome: '  ' }))).toEqual({ ok: false, erro: 'Informe o nome da regra.' })
    expect(validarRegra(entrada({ destinatarios: [] })).ok).toBe(false)
    expect(validarRegra(entrada({ canais: [] })).ok).toBe(false)
  })

  it('a lista mostra frase própria em Janela e em Limite, nunca o valor cru', () => {
    const r = validarRegra(entrada())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(resumoJanelaRegra(r.valor)).toBe('Quando a EMB fecha')
    expect(resumoLimite(r.valor)).toBe('Todos os processos no fim')
    // 'op' nunca aparece: seria uma janela que a regra não tem.
    expect(resumoJanelaRegra(r.valor)).not.toContain('OP')
  })
})
```

- [ ] **Step 8: Rodar, ver falhar, implementar `regra.ts`, ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/domain/__tests__/regra-emb.test.ts`
Expected: FAIL (hoje `'emb'` não é um tipo e a validação cobra posto).

Em `domain/regra.ts`:

```ts
// no topo
import { JANELA_EMB, LIMITE_EMB } from './emb'

const MSG_EMB_CAMPO = 'O aviso de fim de EMB não usa este campo.'
```

Em `validarRegra`, logo **depois** da checagem de nome e **no lugar** da checagem de postos:

```ts
  // O fim de EMB não tem posto: o gatilho é a EMB fechar, e EMB não é posto. Os outros tipos
  // continuam exigindo pelo menos um.
  const postos = tipo === 'emb' ? [] : unicos(e.postos)
  if (tipo !== 'emb' && postos.length === 0) return erro('Escolha pelo menos 1 posto.')

  // Fim de EMB: caminho próprio até os destinatários, como o resumo diário. Não usa taxa, janela,
  // bipes, lembrete, limites nem hora, e RECUSA o campo que não é dele em vez de ignorá-lo em
  // silêncio. A janela SAI como 'op' com valor nulo, seja o que o formulário mandar — é valor de
  // fachada (o 'op' é o único janela_tipo que o banco aceita com valor nulo sem mexer nos dois
  // checks de janela_valor), e a coluna "Janela" da lista mostra `JANELA_EMB`, nunca este valor.
  if (tipo === 'emb') {
    const naoUsados = [
      e.taxaMinima, e.janelaValor, e.minimoBipes, e.lembreteMin,
      e.limiteTempo, e.limiteOcorrencias, e.pausaMaxMin, e.horaResumo,
    ]
    if (naoUsados.some((v) => textoLimpo(v) !== '')) return erro(MSG_EMB_CAMPO)
  }
```

Troque a decisão de `janelaTipo`:

```ts
  if (tipo !== 'resumo' && tipo !== 'emb' && !ehJanelaTipo(e.janelaTipo)) {
    return erro('Escolha a janela da regra.')
  }
  // O resumo sai SEMPRE como 'intervalos' e o fim de EMB SEMPRE como 'op' (ver acima), seja o que
  // o formulário mandar.
  const janelaTipo: JanelaTipo =
    tipo === 'resumo' ? 'intervalos' : tipo === 'emb' ? 'op' : (e.janelaTipo as JanelaTipo)
```

E, em cada bloco que hoje testa `tipo !== 'resumo'`, acrescente `&& tipo !== 'emb'`:
`janelaValor`, `intervalos`, `lembrete`. Os blocos de `taxaMinima`, `minimoBipes`, `limiteTempoSeg`
e `limiteOcorrencias` já são `if (tipo === 'aprovacao')` / `'tempo'` / `'defeito'` e não precisam
de nada. E `pmos`:

```ts
      pmos: tipo === 'emb' ? [] : unicos(e.pmos),
```

As duas frases da lista:

```ts
/** Coluna "Limite" da lista de regras: '≥ 90%', '≤ 2:00/peça', '≥ 5 vezes'. */
export function resumoLimite(
  r: Pick<RegraValida, 'tipo' | 'taxaMinima' | 'limiteTempoSeg' | 'limiteOcorrencias'>,
): string {
  // O fim de EMB não tem limite: tem gatilho. Mostrar '—' deixaria a coluna parecendo defeito.
  if (r.tipo === 'emb') return LIMITE_EMB
  if (r.tipo === 'tempo') return r.limiteTempoSeg === null ? '—' : `≤ ${formatarMmSs(r.limiteTempoSeg)}/peça`
  if (r.tipo === 'defeito') return r.limiteOcorrencias === null ? '—' : `≥ ${r.limiteOcorrencias} vezes`
  return r.taxaMinima === null ? '—' : `≥ ${formatarMeta(r.taxaMinima)}%`
}

export function resumoJanelaRegra(
  r: Pick<RegraValida, 'tipo' | 'janelaTipo' | 'janelaValor' | 'horaResumo'>,
): string {
  // ⚠️ O fim de EMB guarda janela_tipo = 'op' por FACHADA (ver validarRegra): mostrar "na OP em
  // andamento" diria uma janela que ele não tem — o mesmo motivo que fez o resumo mostrar a hora
  // em vez de "Blocos de 1h".
  if (r.tipo === 'emb') return JANELA_EMB
  if (r.tipo === 'resumo') return r.horaResumo ? `Dia inteiro, às ${r.horaResumo}` : '—'
  return resumoJanela({ tipo: r.janelaTipo, valor: r.janelaValor })
}
```

Em `domain/postos-regra.ts`, `postoServeAoTipo`:

```ts
 *  - fim de EMB: nenhum posto. A regra não tem posto nenhum (o gatilho é a EMB fechar), e a lista
 *    de postos não aparece no formulário dele.
export function postoServeAoTipo(tipo: TipoRegra, posto: PostoRegra): boolean {
  if (tipo === 'emb') return false
  if (tipo === 'aprovacao' || tipo === 'resumo') return posto.temStatus
  if (tipo === 'defeito') return posto.coletaDefeito
  return true
}
```

Em `domain/modulo.ts`:

```ts
export const TIPOS_REGRA_POR_MODULO: Record<ModuloAlerta, readonly TipoRegra[]> = {
  shopfloor: ['aprovacao', 'tempo', 'defeito', 'resumo'],
  recebimento: ['emb'],
}
```

E ajuste `modulo.test.ts`: o teste "cada tipo de regra pertence a exatamente um módulo" agora
passa com os cinco tipos, e acrescente um caso explícito:

```ts
  it('o fim de EMB é do Recebimento, e só dele', () => {
    expect(TIPOS_REGRA_POR_MODULO.recebimento).toEqual(['emb'])
    expect(tipoPertenceAoModulo('emb', 'shopfloor')).toBe(false)
  })
```

- [ ] **Step 9: Rodar a suíte do módulo**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas && npx tsc --noEmit`
Expected: PASS e sem erro de tipo. Vários `Record<TipoRegra, ...>` em `regra-form.tsx` (`JANELAS`,
`TITULO_PREVIA`, `EXPLICA_POSTOS`) vão **falhar a compilação** por falta da chave `emb` — é de
propósito (é o `Record` cobrando a cobertura). A Task 6 preenche essas chaves; se você quiser a
suíte verde ao fim desta tarefa, preencha-as agora com os valores que a Task 6 define e deixe a
Task 6 só com a UI. Qualquer das duas ordens serve, mas **não** troque os `Record` por
`Partial<Record<...>>` para calar o compilador.

- [ ] **Step 10: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
git add src/modules/alertas/domain/emb.ts src/modules/alertas/domain/tipos.ts src/modules/alertas/domain/modulo.ts src/modules/alertas/domain/regra.ts src/modules/alertas/domain/envio.ts src/modules/alertas/domain/mensagens.ts src/modules/alertas/domain/postos-regra.ts src/modules/alertas/domain/__tests__/emb.test.ts src/modules/alertas/domain/__tests__/envio-emb.test.ts src/modules/alertas/domain/__tests__/regra-emb.test.ts src/modules/alertas/domain/__tests__/modulo.test.ts
git commit -m "feat(alertas): tipo de regra Fim de EMB no dominio e a mensagem

TipoRegra e TipoEnvio ganham 'emb'. A regra de fim de EMB nao tem posto, janela, limite,
PMO nem hora: validarRegra recusa o campo que nao e dele e forca janela 'op' com valor
nulo (valor de fachada, o unico que o banco aceita nulo sem mexer nos dois checks de
janela_valor). A lista mostra frases proprias em Janela e Limite, nunca o valor cru --
mesmo caminho que o resumo diario abriu.

textoEmb monta a mensagem: cabecalho com a EMB e quantas divergencias (e o assunto do
e-mail), e por divergencia o item com as quantidades e a justificativa, ou a marca de
que ninguem justificou. Corte com aviso para caber nos 2000 do Discord.

Spec: docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md (decisoes 3, 4 e 5)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: O formulário do fim de EMB

**Files:**
- Modify: `src/modules/alertas/ui/regra-form.tsx` (os `Record<TipoRegra, ...>` e os blocos que somem no tipo `'emb'`)
- Modify: `src/modules/alertas/ui/regras-lista.tsx` (nada estrutural: confirmar que a coluna Postos não fica vazia feia)
- Create: `src/modules/alertas/ui/__tests__/regra-form-emb.test.tsx`
- Modify: `src/modules/alertas/ui/__tests__/alertas-tela-modulo.test.tsx` (o quarto teste troca de sinal)

**Interfaces:**
- Consumes (Task 5): `NOME_TIPO_REGRA.emb`, `DESCRICAO_TIPO_REGRA.emb`,
  `TIPOS_REGRA_POR_MODULO.recebimento = ['emb']`, `validarRegra` com `tipo: 'emb'`,
  `resumoJanelaRegra`/`resumoLimite`.
- Produces: nada para tarefas seguintes (é a ponta da UI do pedaço).

- [ ] **Step 1: Escrever o teste do formulário**

Crie `src/modules/alertas/ui/__tests__/regra-form-emb.test.tsx`, no molde de
`regra-form-resumo.test.tsx` (copie os mocks de action e de `sonner` dele):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RegraForm } from '../regra-form'

const salvarRegraAction = vi.fn()
const previaRegraAction = vi.fn()

vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  salvarRegraAction: (...a: unknown[]) => salvarRegraAction(...a),
  previaRegraAction: (...a: unknown[]) => previaRegraAction(...a),
}))
const toastErro = vi.fn()
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastErro(...a) } }))

const DESTINATARIOS = [
  { usuarioId: 'u1', nome: 'Beto Recebimento', email: 'beto@x', telegram: true, discord: false },
]

function montar() {
  render(
    <RegraForm
      modulo="recebimento"
      tipo="emb"
      regra={null}
      postos={[]}
      pmosDisponiveis={[]}
      destinatarios={DESTINATARIOS}
      configurados={{ telegram: true, discord: true }}
      canalConfigurado
      onSalvo={vi.fn()}
      onCancelar={vi.fn()}
    />,
  )
}

/** O que foi mandado ao servidor na primeira chamada de salvar. */
const enviado = () => (salvarRegraAction.mock.calls[0] as unknown[])[2] as Record<string, unknown>

beforeEach(() => vi.clearAllMocks())

describe('formulário do fim de EMB', () => {
  it('monta: mostra nome, responsáveis e como avisar', () => {
    montar()
    expect(screen.getByLabelText('Nome')).toBeInTheDocument()
    expect(screen.getByText('Responsáveis')).toBeInTheDocument()
    expect(screen.getByText('Como avisar')).toBeInTheDocument()
  })

  it('não mostra posto, janela, lembrete, PMO nem prévia', () => {
    montar()
    expect(screen.queryByText('Postos')).not.toBeInTheDocument()
    expect(screen.queryByText('Janela')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/lembrar a cada/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/PMOs/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ver prévia/i })).not.toBeInTheDocument()
  })

  it('explica o gatilho na própria tela', () => {
    montar()
    expect(screen.getByText(/todos os processos/i)).toBeInTheDocument()
  })

  it('manda ao servidor uma regra sem posto, sem janela e sem PMO', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g9' })
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Fim de EMB' } })
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Beto Recebimento'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    const d = enviado()
    expect(d.tipo).toBe('emb')
    expect(d.postos).toEqual([])
    expect(d.pmos).toEqual([])
    expect(d.taxaMinima).toBe('')
    expect(d.minimoBipes).toBe('')
    expect(d.lembreteMin).toBe('')
    expect(d.horaResumo).toBeUndefined()
    // O módulo vai como 1º parâmetro da action.
    expect((salvarRegraAction.mock.calls[0] as unknown[])[0]).toBe('recebimento')
  })

  it('cobra responsável, como qualquer regra', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Fim de EMB' } })
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalled())
    expect(String((toastErro.mock.calls[0] as unknown[])[0])).toContain('responsável')
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/ui/__tests__/regra-form-emb.test.tsx`
Expected: FAIL — o formulário ainda mostra Postos e Janela no tipo `'emb'`.

- [ ] **Step 3: Implementar em `regra-form.tsx`**

Preencha as chaves `emb` dos `Record<TipoRegra, ...>`:

```tsx
/** As janelas que cada tipo aceita (spec 2026-09-18, §2). */
const JANELAS: Record<TipoRegra, JanelaTipo[]> = {
  aprovacao: ['tempo', 'bipes', 'op', 'intervalos'],
  tempo: ['tempo', 'op'],
  defeito: ['tempo'],
  // O resumo não tem janela a escolher: sai sempre pelos intervalos (o "dia" de cada posto).
  resumo: ['intervalos'],
  // O fim de EMB não tem janela nenhuma: o gatilho é a EMB fechar. O 'op' é valor de fachada que a
  // validação força (ver validarRegra) e a lista nunca mostra.
  emb: ['op'],
}

const TITULO_PREVIA: Record<TipoRegra, string> = {
  // ...as quatro de hoje
  // Sem uso: a prévia não existe no fim de EMB (não há janela a antecipar). A chave fecha o Record.
  emb: 'Fim de EMB',
}

const EXPLICA_POSTOS: Record<TipoRegra, string> = {
  // ...as quatro de hoje
  // Sem uso: o fim de EMB não tem lista de postos. A chave fecha o Record.
  emb: '',
}
```

E as três mudanças de render. A `janelaInicial`:

```tsx
function janelaInicial(tipo: TipoRegra, regra: RegraAlerta | null): JanelaTipo {
  if (tipo === 'resumo') return 'intervalos'
  // Fachada, igual à da validação: a janela não aparece no formulário do fim de EMB.
  if (tipo === 'emb') return 'op'
  const salva = regra?.janelaTipo ?? 'tempo'
  return JANELAS[tipo].includes(salva) ? salva : 'tempo'
}
```

O `entrada()`:

```tsx
      postos: tipo === 'emb' ? [] : postosSel,
      // ...
      pmos: tipo === 'emb' ? [] : pmosSel,
```

E os blocos que somem — o `fieldset` de Postos, o de Janela, o campo de lembrete, o `PmosSelecao`
e o botão "Ver prévia" ganham `tipo !== 'emb'`:

```tsx
      {/* O fim de EMB não tem posto: o gatilho é a EMB fechar, e EMB não é posto. */}
      {tipo !== 'emb' && (
      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Postos
          {/* ...igual */}
      </fieldset>
      )}

      {/* O gatilho do fim de EMB não se configura: ou todos os processos da EMB terminaram, ou não.
          Mas tem de estar ESCRITO na tela — senão o gestor salva a regra sem saber quando ela sai. */}
      {tipo === 'emb' && (
        <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          <p>
            O aviso sai quando <strong>todos os processos de uma EMB</strong> chegam ao fim do fluxo —
            Almoxarifado ou Reprovado na Qualidade. Item reprovado também terminou.
          </p>
          <p className="mt-2">
            A mensagem traz <strong>só as divergências de quantidade</strong> daquela EMB, com a
            justificativa de cada uma (ou a marca de que ninguém justificou). EMB que fecha sem
            nenhuma divergência <strong>também avisa</strong>, dizendo que terminou sem
            divergência.
          </p>
          <p className="mt-2">
            Cada EMB avisa <strong>uma vez só</strong>. A conferência é feita a cada 5 minutos, e
            EMBs que fecharam antes de a regra ser criada não são avisadas.
          </p>
        </div>
      )}
```

⚠️ `{tipo !== 'resumo' && (` já embrulha a Janela e o lembrete; troque por
`{tipo !== 'resumo' && tipo !== 'emb' && (`. O `PmosSelecao` e o botão "Ver prévia" também ganham
`tipo !== 'emb' &&`.

⚠️ O `<Input>` do Nome tem um `placeholder` por tipo em cadeia de ternários — acrescente o ramo:
`tipo === 'emb' ? 'Divergências de EMB' : ...`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/ui/__tests__/regra-form-emb.test.tsx`
Expected: PASS (5 testes).

- [ ] **Step 5: Trocar o sinal do teste da tela**

Em `src/modules/alertas/ui/__tests__/alertas-tela-modulo.test.tsx`, substitua o quarto teste
(aquele que afirmava que "Nova regra" fica desabilitado no Recebimento) por:

```tsx
  it('no Recebimento, Nova regra abre a escolha com o cartão de Fim de EMB', async () => {
    montar('recebimento', [])
    const botao = screen.getByRole('button', { name: /nova regra/i })
    expect(botao).not.toBeDisabled()
    fireEvent.click(botao)
    expect(await screen.findByText('Fim de EMB')).toBeInTheDocument()
    // E só ele: os tipos do ShopFloor não aparecem aqui (caso 6 da spec, do lado do cartão).
    expect(screen.queryByText('Taxa de aprovação')).not.toBeInTheDocument()
    expect(screen.queryByText('Resumo diário')).not.toBeInTheDocument()
  })
```

- [ ] **Step 6: Rodar tudo e conferir o build**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
npx vitest run --maxWorkers=2
npx tsc --noEmit
npx next build
```

Expected: tudo verde.

- [ ] **Step 7: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
git add src/modules/alertas/ui/regra-form.tsx src/modules/alertas/ui/regras-lista.tsx src/modules/alertas/ui/__tests__/regra-form-emb.test.tsx src/modules/alertas/ui/__tests__/alertas-tela-modulo.test.tsx
git commit -m "feat(alertas): formulario do Fim de EMB

O cartao 'Fim de EMB' aparece na escolha de tipo da tela do Recebimento, e so lá. O
formulario dele tem nome, responsaveis e como avisar -- sem posto, sem janela, sem
lembrete, sem PMO e sem previa, porque o gatilho nao se configura. Em vez dos campos
que nao existem, a tela EXPLICA quando o aviso sai, o que ele traz e que cada EMB avisa
uma vez so.

Spec: docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md (casos 1 a 6)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Fim do Pedaço 2.** Entregável: a feature funciona, por Telegram e Discord. Falta o canal que o
usuário pediu como prioridade.

---

# PEDAÇO 3 — Canal de e-mail

Entregável do pedaço: o e-mail entra como terceiro canal, entregue por SMTP, com o endereço vindo de
`usuarios.email` (o do login). Vale para **todos** os tipos de regra, não só para o fim de EMB — o
e-mail é um canal, e tratá-lo como exclusivo do fim de EMB criaria uma exceção sem motivo.

⚠️ **Antes de começar:** confirmar no servidor as credenciais SMTP que o GoTrue já usa (a própria
spec pede isso). O "esqueci a senha" está quebrado por **outro** motivo (template e `origin` atrás
do nginx) — o **envio** funciona, e é só dele que esta feature depende. Se as credenciais não
estiverem disponíveis, pare e pergunte: sem elas o Pedaço 3 não tem como ser testado de ponta a
ponta.

---

### Task 7: Migração 0151 — o canal 'email' no banco

**Files:**
- Create: `supabase/migrations/0151_alertas_canal_email.sql`
- Create: `supabase/tests/alertas_email_test.sql`
- Modify: `supabase/tests/rodar-alertas-test.sh` (bloco da 0151 no fim)

**Interfaces:**
- Consumes (Tasks 1 e 4): `alerta_envios.modulo`, o corpo do `alerta_avaliar` da 0150.
- Produces:
  - `alerta_regras.canais` aceita `'email'`; `alerta_envios.canal` aceita `'email'`.
  - `alerta_destinatarios(p_modulo)` passa a devolver **uma coluna a mais no fim**: `email_ok boolean`
    (`true` quando `usuarios.email` não está em branco).
  - O fan-out de pessoas do `alerta_avaliar` e do `alerta_resolver_interno` enfileira linha de
    `canal = 'email'` com `destino_tipo = 'usuario'` **sem** passar por `alerta_contas`.
  - `alerta_reservar_envios` resolve o endereço de uma linha de e-mail a partir de `usuarios.email`.
  - ⚠️ `alerta_contas.canal` **não** muda: e-mail não tem vínculo, e é isso que a spec quer dizer
    com "não há tela nova, não há cadastro de endereço, não há confirmação".

- [ ] **Step 1: Escrever o teste SQL do canal de e-mail**

Crie `supabase/tests/alertas_email_test.sql`:

```sql
-- Testes SQL da 0151 (canal 'email'). Rodar com supabase/tests/rodar-alertas-test.sh: DEPOIS de
-- alertas_emb_test.sql, na mesma base, com a 0151 por cima de tudo.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE: o e-mail é o único canal SEM vínculo — o endereço sai de
-- usuarios.email, não de alerta_contas. O `join` com alerta_contas resolvia o endereço de todas as
-- linhas de pessoa (0123); se o e-mail passar por ele, a linha nunca é reservada, fica pendente e
-- expira em 24 h EM SILÊNCIO. É esse caminho que este arquivo mede.
--
-- O mapa dos testes:
--   T0  esquema: 'email' aceito em alerta_regras.canais e em alerta_envios.canal; alerta_contas
--       NÃO aceita 'email' (e-mail não tem vínculo, de propósito);
--   T1  o fan-out enfileira e-mail SEM conta vinculada;
--   T2  ⚠️ a reserva resolve o endereço a partir de usuarios.email;
--   T3  responsável com e-mail em branco NÃO é enfileirado (não há endereço a inventar);
--   T4  responsável sem shopfloor/recebimento.administrar continua fora, como nos outros canais;
--   T5  o aviso "resolvido por X" também sai por e-mail;
--   T6  alerta_destinatarios devolve email_ok;
--   T7  Telegram e Discord continuam exigindo conta vinculada (nada regrediu).

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);

update public.alerta_regras set ativa = false where ativa;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- ---------- T0 ----------
do $t$
begin
  begin
    insert into public.alerta_contas (usuario_id, canal, externo_id)
    values ('00000000-0000-0000-0000-0000000000b1', 'email', 'beto@x');
    raise exception 'T0 FALHOU: alerta_contas aceitou canal email (e-mail nao tem vinculo)';
  exception when check_violation then null;
  end;
end $t$;
\echo 'T0 (esquema do canal email): ok'

-- ---------- T1 e T2: enfileira sem vínculo e a reserva acha o endereço ----------
-- Dora administra o Recebimento, tem e-mail de login e NÃO tem conta em canal nenhum.
select public.teste_regra_emb_email('EMB por email',
         array['00000000-0000-0000-0000-0000000000b2']::uuid[]);
select public.teste_item_emb_email('EMB800', 'E-1', 'Aprovado', 40, 35);
do $t$
declare v_id uuid; v_ext text;
begin
  set local role service_role;
  perform public.alerta_avaliar();
  reset role;
  select id into v_id from public.alerta_envios
   where tipo = 'emb' and canal = 'email' and dados->>'emb' = 'EMB800';
  if v_id is null then
    raise exception 'T1 FALHOU: nao enfileirou e-mail para quem nao tem conta vinculada';
  end if;
  if not exists (select 1 from public.alerta_contas
                  where usuario_id = '00000000-0000-0000-0000-0000000000b2') then
    null;  -- confirmado: ela nao tem vinculo nenhum, e ainda assim foi enfileirada
  else
    raise exception 'T1 FALHOU: a massa do teste esta errada (Dora tem conta vinculada)';
  end if;

  set local role service_role;
  select externo_id into v_ext from public.alerta_reservar_envios(array['email'], 100)
   where id = v_id;
  reset role;
  if coalesce(v_ext, '') <> 'dora@x' then
    raise exception 'T2 FALHOU: a reserva devolveu endereco %, esperava dora@x', v_ext;
  end if;
end $t$;
\echo 'T1/T2 (e-mail sem vinculo, endereco de usuarios.email): ok'

-- ---------- T3: e-mail em branco ----------
insert into public.usuarios (id, nome, email, ativo, perfil_id) values
  ('00000000-0000-0000-0000-0000000000b3', 'Elza Sem Email', '   ', true,
   '00000000-0000-0000-0000-0000000000b0')
on conflict (id) do update set email = '   ';
select public.teste_regra_emb_email('EMB sem endereco',
         array['00000000-0000-0000-0000-0000000000b3']::uuid[]);
select public.teste_item_emb_email('EMB810', 'E-2', 'Aprovado', 40, 30);
do $t$
begin
  set local role service_role;
  perform public.alerta_avaliar();
  reset role;
  if exists (select 1 from public.alerta_envios
              where tipo = 'emb' and canal = 'email' and dados->>'emb' = 'EMB810') then
    raise exception 'T3 FALHOU: enfileirou e-mail para quem nao tem endereco';
  end if;
end $t$;
\echo 'T3 (e-mail em branco fica fora): ok'
```

Continue com T4–T7 no mesmo molde (os helpers `teste_regra_emb_email` e `teste_item_emb_email` são
cópias dos da Task 4 com `canais = array['email']`; escreva-os no topo do arquivo, porque os da
Task 4 são apagados no fim dela). Em T6:

```sql
-- ---------- T6: alerta_destinatarios devolve email_ok ----------
do $t$
declare v_dora boolean; v_elza boolean;
begin
  perform set_config('teste.perms', 'recebimento.administrar', false);
  select bool_or(email_ok) filter (where usuario_id = '00000000-0000-0000-0000-0000000000b2'),
         bool_or(email_ok) filter (where usuario_id = '00000000-0000-0000-0000-0000000000b3')
    into v_dora, v_elza
    from public.alerta_destinatarios('recebimento');
  if not coalesce(v_dora, false) then raise exception 'T6 FALHOU: Dora veio sem email_ok'; end if;
  if coalesce(v_elza, true) then raise exception 'T6 FALHOU: Elza (email em branco) veio com email_ok'; end if;
end $t$;
select set_config('teste.perms', 'shopfloor.administrar,recebimento.administrar', false);
\echo 'T6 (alerta_destinatarios devolve email_ok): ok'
```

E em T7:

```sql
-- ---------- T7: Telegram e Discord continuam exigindo vínculo ----------
do $t$
declare v_n int;
begin
  insert into public.alerta_envios
    (ocorrencia_id, usuario_id, canal, tipo, modulo, dados, com_botao, destino_tipo)
  values (null, '00000000-0000-0000-0000-0000000000b2', 'telegram', 'resumo', 'recebimento',
          '{}'::jsonb, false, 'usuario');
  set local role service_role;
  select count(*) into v_n from public.alerta_reservar_envios(array['telegram'], 100)
   where usuario_id = '00000000-0000-0000-0000-0000000000b2';
  reset role;
  if v_n <> 0 then
    raise exception 'T7 FALHOU: reservou Telegram para quem nao tem conta vinculada';
  end if;
end $t$;
\echo 'T7 (Telegram/Discord continuam exigindo vinculo): ok'
\echo '0151 (canal email): ok'
```

- [ ] **Step 2: Acrescentar o bloco ao runner e ver falhar**

```bash
# ---------- 0151: canal 'email' ----------
# O e-mail é o único canal sem vínculo: o endereço sai de usuarios.email. É o teste dela que prova
# que a reserva acha esse endereço — sem isso a linha ficaria pendente e expiraria em silêncio.
docker cp supabase/migrations/0151_alertas_canal_email.sql "$NOME":/tmp/0151.sql
docker cp supabase/tests/alertas_email_test.sql "$NOME":/tmp/teste_email.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0151.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0151.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_email.sql
echo "0151 (canal email): ok"
```

Run: `supabase/tests/rodar-alertas-test.sh`
Expected: FALHA no `docker cp` da 0151.

- [ ] **Step 3: Escrever a 0151 — os checks de canal**

```sql
-- =============================================================
-- ALERTAS — CANAL DE E-MAIL
-- Spec: docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md
--
-- Aplica POR CIMA da 0113/0115/0123/0139/0141/0149/0150. Idempotente.
--
-- Um terceiro canal, 'email'. Vale para TODOS os tipos de regra, não só para o fim de EMB: e-mail é
-- um canal, e abrir exceção por tipo criaria uma assimetria sem motivo.
--
-- ⚠️ O E-MAIL É O ÚNICO CANAL SEM VÍNCULO. Telegram e Discord precisam de uma conta vinculada
-- (alerta_contas) porque o endereço deles é um id de conversa que só existe depois de a pessoa
-- falar com o bot. O e-mail do login JÁ ESTÁ em usuarios.email (decisão 7 da spec): não há tela
-- nova, não há cadastro de endereço e não há confirmação. Por isso alerta_contas.canal NÃO ganha
-- 'email' — uma linha de vínculo de e-mail não quer dizer nada, e aceitá-la abriria a porta para
-- duas fontes de endereço.
--
-- ⚠️ O QUE ISSO CUSTA, ESCRITO DE PROPÓSITO (spec): não dá para avisar quem não tem conta no
-- sistema, nem mandar para um endereço diferente do de login. Avisar um comprador que não usa o
-- sistema é feature nova.
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0151_alertas_canal_email.sql
--
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app. A assinatura nova de alerta_destinatarios
-- derruba a anterior; app novo contra banco velho não acha a coluna email_ok.
--
-- Convenções (as mesmas da 0113): corpo de função com $func$; grants e revokes explícitos;
-- notify pgrst na última linha.
-- =============================================================

-- ---------- 'email' nos dois lugares onde canal é escrito ----------
-- O check de `canais` da 0113 tem DUAS condições na mesma expressão de coluna, então ganhou nome
-- automático. Acha-se pela definição (a única que traz `canais <@`). O novo tem nome próprio, que o
-- loop poupa. ORDEM: o novo entra ANTES de o antigo cair.
alter table public.alerta_regras drop constraint if exists alerta_regras_canais_validos;
alter table public.alerta_regras add constraint alerta_regras_canais_validos
  check (cardinality(canais) > 0 and canais <@ array['telegram', 'discord', 'email']);

do $func$
declare
  v_nome text;
begin
  for v_nome in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.alerta_regras'::regclass
       and c.contype = 'c'
       and c.conname <> 'alerta_regras_canais_validos'
       and pg_get_constraintdef(c.oid) like '%canais <@%'
  loop
    execute format('alter table public.alerta_regras drop constraint %I', v_nome);
  end loop;
end
$func$;

alter table public.alerta_envios drop constraint if exists alerta_envios_canal_valido;
alter table public.alerta_envios add constraint alerta_envios_canal_valido
  check (canal in ('telegram', 'discord', 'email'));

do $func$
declare
  v_nome text;
begin
  for v_nome in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.alerta_envios'::regclass
       and c.contype = 'c'
       and c.conname <> 'alerta_envios_canal_valido'
       and pg_get_constraintdef(c.oid) like '%canal = ANY%'
       and pg_get_constraintdef(c.oid) like '%telegram%'
  loop
    execute format('alter table public.alerta_envios drop constraint %I', v_nome);
  end loop;
end
$func$;

-- ⚠️ alerta_contas.canal NÃO muda (ver o cabeçalho): e-mail não tem vínculo.

-- Uma linha de e-mail em canal não existe: o aviso em canal é sempre o do Discord (0123).
alter table public.alerta_envios drop constraint if exists alerta_envios_email_so_pessoa;
alter table public.alerta_envios add constraint alerta_envios_email_so_pessoa
  check (canal <> 'email' or destino_tipo = 'usuario');
```

- [ ] **Step 4: Recriar `alerta_destinatarios` com `email_ok`**

Copie a versão da 0149 e acrescente **uma** coluna ao fim do `returns table` e do `select`:

```sql
create or replace function public.alerta_destinatarios(p_modulo text default 'shopfloor')
returns table (usuario_id uuid, nome text, email text, telegram boolean, discord boolean,
               email_ok boolean)
-- ... o MESMO corpo da 0149, com uma coluna a mais no select:
--       nullif(btrim(u.email), '') is not null   as email_ok
-- (a coluna `email` já vinha; `email_ok` é o "este endereço serve para enviar?", que a tela usa
--  para o aviso "Fulano sem e-mail" — mesmo papel dos booleanos de telegram/discord)
$func$;

revoke all on function public.alerta_destinatarios(text) from public, anon;
grant execute on function public.alerta_destinatarios(text) to authenticated, service_role;
```

⚠️ `create or replace` **não** consegue acrescentar coluna ao `returns table` de uma função
existente (`cannot change return type of existing function`). Então aqui o `drop` vem **antes**:

```sql
-- O retorno ganhou coluna: `create or replace` recusa mudança de tipo de retorno. O drop vem ANTES
-- do create — a assinatura é a mesma, então não há instante com duas funções, e o `psql -1` aplica
-- tudo numa transação só.
drop function if exists public.alerta_destinatarios(text);
create or replace function public.alerta_destinatarios(p_modulo text default 'shopfloor')
-- ...
```

- [ ] **Step 5: Recriar `alerta_avaliar`, `alerta_resolver_interno` e `alerta_reservar_envios`**

Bloco de diferenças declaradas:

```sql
-- ---------------------------------------------------------------------------------------------
-- ⚠️ FUNÇÕES EM PRODUÇÃO QUE ESTE TRECHO RECRIA, E AS ÚNICAS DIFERENÇAS DECLARADAS
--
-- public.alerta_avaliar(text, jsonb, jsonb) — a versão viva é a da 0150 — 1 diferença, aplicada
--   nos TRÊS fan-outs de pessoa (o do caminho da ocorrência, o do resumo e o do fim de EMB):
--   o `from public.alerta_contas c` vira uma subconsulta `d` que UNE duas fontes de destino —
--   as contas vinculadas (Telegram/Discord, como sempre) e, quando 'email' está nos canais da
--   regra, uma linha por responsável COM e-mail de login. Tudo o mais fica igual.
--
-- public.alerta_resolver_interno(uuid, uuid, boolean) — a versão viva é a da 0149 — a MESMA
--   diferença, no fan-out do "resolvido por X". Sem ela, uma regra que avisa SÓ por e-mail nunca
--   mandaria o aviso de resolução, e quem recebeu o alerta não saberia que acabou.
--
-- public.alerta_reservar_envios(text[], int, uuid) — a versão viva é a da 0149 — 2 diferenças:
--   1. o endereço passa a sair de `case when e.canal = 'email' then nullif(btrim(u.email), '')
--      else coalesce(c.externo_id, e.destino_externo_id) end`;
--   2. no ramo `when 'usuario'` do `case e.destino_tipo`, a exigência de conta vinculada
--      (`c.externo_id is not null`) vale só para telegram/discord; para 'email' a exigência é
--      `nullif(btrim(u.email), '') is not null`. O usuário ativo e a permissão do módulo (0149)
--      continuam valendo para os três canais.
--   O retorno NÃO ganha coluna: a assinatura fica igual, sem `drop function`.
--
-- ⚠️ A SUBCONSULTA É A FORMA, E NÃO UM `left join alerta_contas`: com left join, um responsável
-- sem nenhum vínculo geraria UMA linha de e-mail por... nada (o join não multiplica), mas um COM
-- vínculo nos dois canais geraria duas linhas de e-mail. O `union all` de duas fontes dá
-- exatamente uma linha por (pessoa, canal), que é o que a fila espera.
-- ---------------------------------------------------------------------------------------------
```

A subconsulta, escrita uma vez e repetida nos três fan-outs (o SQL não tem como extrair isso sem
uma função, e uma função aqui esconderia o `t.destinatarios`/`r.destinatarios` que muda entre eles):

```sql
          select null, d.usuario_id, d.canal, 'emb', t.modulo, v_dados, false, 'usuario'
            from (
              -- Telegram e Discord: pela conta vinculada de AGORA (quem desvinculou não recebe).
              select c.usuario_id, c.canal
                from public.alerta_contas c
               where c.usuario_id = any (t.destinatarios)
                 and c.canal = any (t.canais)
              union all
              -- E-mail: NÃO há vínculo — o endereço é o do login (usuarios.email, decisão 7 da
              -- spec). Quem está com o endereço em branco fica fora: não há endereço a inventar.
              select u2.id, 'email'
                from public.usuarios u2
               where u2.id = any (t.destinatarios)
                 and 'email' = any (t.canais)
                 and nullif(btrim(u2.email), '') is not null
            ) d
            join public.usuarios u on u.id = d.usuario_id and u.ativo
           where public.usuario_tem_permissao(d.usuario_id, t.modulo, 'administrar')
           order by d.usuario_id, d.canal;
```

⚠️ Nos três fan-outs, o `insert ... select` muda só nestas linhas; o resto (`insert into
public.alerta_envios (...)`, o tipo de envio, `com_botao`, `destino_tipo`) fica igual. No fan-out do
caminho da ocorrência, `'emb'` é `v_tipo`, `v_dados` é o mesmo e `com_botao` é
`v_tipo in ('alerta','lembrete')`; no `alerta_resolver_interno`, `t.destinatarios`/`t.canais`/
`t.modulo` viram `r.destinatarios`/`r.canais`/`r.modulo` e há o `and d.usuario_id is distinct from
p_usuario_id` (quem resolveu não recebe o próprio aviso) — **não esqueça esse filtro**.

E o fim do arquivo: `notify pgrst, 'reload schema';`

- [ ] **Step 6: Rodar o teste SQL e ver passar**

Run: `supabase/tests/rodar-alertas-test.sh`
Expected: `T0`–`T7` com `ok`, `0151 (canal email): ok`, `ALERTAS SQL OK`.

- [ ] **Step 7: Sabotar o teste que mais importa**

Deixe o endereço de e-mail sair de `coalesce(c.externo_id, e.destino_externo_id)` (sem o ramo do
`case`). Expected: **T2 falha** com "a reserva devolveu endereco <vazio>". Desfaça.

- [ ] **Step 8: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
git add supabase/migrations/0151_alertas_canal_email.sql supabase/tests/alertas_email_test.sql supabase/tests/rodar-alertas-test.sh
git commit -m "feat(alertas): canal de e-mail no banco

Terceiro canal, 'email', para todos os tipos de regra. E o unico canal SEM vinculo: o
endereco sai de usuarios.email (o do login), nao de alerta_contas -- por isso
alerta_contas.canal NAO ganha 'email'. Quem esta com o endereco em branco fica fora.

O fan-out de pessoas passa a unir duas fontes de destino (contas vinculadas + e-mail de
login) nos tres lugares onde ele aparece, e alerta_reservar_envios resolve o endereco de
uma linha de e-mail a partir de usuarios.email. Sem isso a linha nunca seria reservada e
expiraria em 24 h em silencio.

alerta_destinatarios devolve email_ok, para a tela avisar 'Fulano sem e-mail'.

Spec: docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md (decisao 7)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: O cliente SMTP

**Files:**
- Create: `src/modules/alertas/infra/email.ts`
- Create: `src/modules/alertas/infra/__tests__/email.test.ts`
- Modify: `src/modules/alertas/domain/tipos.ts` (`Canal`, `CANAIS`, `NOME_CANAL`, `ehCanal`)
- Modify: `src/modules/alertas/infra/canais.ts` (`canaisConfigurados`, `criarPortasCanais`)
- Modify: `src/modules/alertas/infra/__tests__/canal-discord.test.ts` (ou onde `canaisConfigurados` é testado)
- Modify: `package.json` (dependência `nodemailer` + `@types/nodemailer`)
- Modify: `.env.example` (as cinco variáveis de SMTP)

**Interfaces:**
- Consumes (Task 7): `alerta_envios.canal = 'email'` com o endereço já resolvido pela reserva.
- Produces:
  ```ts
  // src/modules/alertas/infra/email.ts
  export interface EmailClient {
    enviarMensagem(endereco: string, texto: string): Promise<ResultadoEnvio>
  }
  export interface ConfigEmail {
    host: string; porta: number; usuario: string; senha: string; remetente: string; seguro: boolean
  }
  export function lerConfigEmail(env?: NodeJS.ProcessEnv): ConfigEmail | null
  export function separarAssunto(texto: string): { assunto: string; corpo: string }
  export function criarEmail(cfg: ConfigEmail, transporte?: TransporteEmail): EmailClient
  ```
  - `Canal` ganha `'email'`; `CANAIS = ['telegram', 'discord', 'email']`;
    `NOME_CANAL.email = 'E-mail'`.
  - `canaisConfigurados()` passa a devolver `email: lerConfigEmail(env) !== null`.
  - `criarPortasCanais()` monta `portas.email` quando a configuração existe.

- [ ] **Step 1: Instalar a dependência**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
npm install nodemailer@7.0.9
npm install -D @types/nodemailer@7.0.4
```

⚠️ Versão fixada de propósito (sem `^`? não — o `npm install` grava `^`, e está certo: o projeto usa
`^` em tudo). Confirme a versão instalada em `package.json` e que o `package-lock.json` foi
atualizado. Se a rede não permitir instalar, **pare e pergunte**: sem cliente SMTP não há Pedaço 3.

- [ ] **Step 2: Escrever o teste do cliente**

Crie `src/modules/alertas/infra/__tests__/email.test.ts`. O teste **não** abre socket: injeta um
transporte de mentira, como os testes de Telegram/Discord injetam `fetch`.

```ts
import { describe, it, expect, vi } from 'vitest'
import { criarEmail, lerConfigEmail, separarAssunto } from '../email'

const CFG = {
  host: 'smtp.exemplo.com',
  porta: 587,
  usuario: 'alertas@enterplak.com.br',
  senha: 'x',
  remetente: 'ShopFloor <alertas@enterplak.com.br>',
  seguro: false,
}

describe('separarAssunto', () => {
  it('a primeira linha é o assunto e o resto é o corpo', () => {
    const r = separarAssunto('📦 EMB390 fechou — 2 divergências\n#1 CAP\n   ↳ sem justificativa')
    expect(r.assunto).toBe('📦 EMB390 fechou — 2 divergências')
    expect(r.corpo).toBe('#1 CAP\n   ↳ sem justificativa')
  })

  it('texto de uma linha vira assunto, e o corpo repete o assunto', () => {
    const r = separarAssunto('📦 EMB390 fechou — 1 divergência')
    expect(r.assunto).toBe('📦 EMB390 fechou — 1 divergência')
    // Corpo vazio faria um e-mail em branco, que muitos clientes marcam como suspeito.
    expect(r.corpo).toBe('📦 EMB390 fechou — 1 divergência')
  })

  it('apara o assunto e troca quebras por espaço (cabeçalho não aceita \\n)', () => {
    const r = separarAssunto('  assunto com espaço  \ncorpo')
    expect(r.assunto).toBe('assunto com espaço')
    expect(r.assunto).not.toContain('\n')
  })

  it('corta assunto gigante (os servidores recusam cabeçalho longo)', () => {
    const r = separarAssunto(`${'a'.repeat(500)}\ncorpo`)
    expect(r.assunto.length).toBeLessThanOrEqual(200)
  })
})

describe('lerConfigEmail', () => {
  it('devolve null sem host (canal não configurado)', () => {
    expect(lerConfigEmail({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('devolve null sem remetente — um e-mail sem From é recusado', () => {
    expect(lerConfigEmail({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' } as NodeJS.ProcessEnv)).toBeNull()
  })

  it('porta padrão 587 e seguro=false (STARTTLS, o que o GoTrue usa)', () => {
    const c = lerConfigEmail({
      SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_REMETENTE: 'a@b',
    } as NodeJS.ProcessEnv)
    expect(c).toEqual({ host: 'h', porta: 587, usuario: 'u', senha: 'p', remetente: 'a@b', seguro: false })
  })

  it('porta 465 liga o seguro sozinho', () => {
    const c = lerConfigEmail({
      SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_REMETENTE: 'a@b',
    } as NodeJS.ProcessEnv)
    expect(c?.porta).toBe(465)
    expect(c?.seguro).toBe(true)
  })
})

describe('criarEmail', () => {
  it('manda assunto, corpo, destinatário e remetente', async () => {
    const enviar = vi.fn().mockResolvedValue({ messageId: '<abc@exemplo>' })
    const cli = criarEmail(CFG, { enviar })
    const r = await cli.enviarMensagem('beto@x', 'Assunto\nCorpo')
    expect(r).toEqual({ ok: true, mensagemExternaId: '<abc@exemplo>' })
    expect(enviar).toHaveBeenCalledWith({
      from: CFG.remetente,
      to: 'beto@x',
      subject: 'Assunto',
      text: 'Corpo',
    })
  })

  it('erro do transporte volta como falha, sem derrubar nada', async () => {
    const enviar = vi.fn().mockRejectedValue(new Error('EAUTH'))
    const cli = criarEmail(CFG, { enviar })
    const r = await cli.enviarMensagem('beto@x', 'A\nB')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toContain('EAUTH')
  })

  it('NUNCA põe a senha no erro', async () => {
    const enviar = vi.fn().mockRejectedValue(new Error(`falhou com ${CFG.senha}`))
    const cli = criarEmail({ ...CFG, senha: 'segredo-muito-secreto' }, { enviar })
    const r = await cli.enviarMensagem('beto@x', 'A\nB')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).not.toContain('segredo-muito-secreto')
  })

  it('endereço em branco falha antes de abrir conexão', async () => {
    const enviar = vi.fn()
    const cli = criarEmail(CFG, { enviar })
    const r = await cli.enviarMensagem('   ', 'A\nB')
    expect(r.ok).toBe(false)
    expect(enviar).not.toHaveBeenCalled()
  })

  it('transporte sem messageId ainda conta como enviado', async () => {
    const enviar = vi.fn().mockResolvedValue({})
    const cli = criarEmail(CFG, { enviar })
    const r = await cli.enviarMensagem('beto@x', 'A\nB')
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/infra/__tests__/email.test.ts`
Expected: FAIL — `Failed to resolve import "../email"`.

- [ ] **Step 4: Escrever `infra/email.ts`**

```ts
import type { ResultadoEnvio } from '../domain/tipos'

const TEMPO_LIMITE_MS = 20_000
/** Teto do assunto. Servidor SMTP recusa cabeçalho muito longo, e cliente corta na exibição. */
const LIMITE_ASSUNTO = 200

/**
 * O que o cliente de e-mail precisa do transporte. Existe para o TESTE poder injetar um transporte
 * de mentira — é o mesmo papel do `fetch` injetável nos clientes de Telegram e Discord: nenhum
 * teste abre socket.
 */
export interface TransporteEmail {
  enviar(mensagem: {
    from: string
    to: string
    subject: string
    text: string
  }): Promise<{ messageId?: string }>
}

export interface ConfigEmail {
  host: string
  porta: number
  usuario: string
  senha: string
  /** O `From`. Pode ser 'Nome <endereço>' ou só o endereço. */
  remetente: string
  /** true = TLS direto (porta 465); false = STARTTLS (porta 587, o que o GoTrue usa). */
  seguro: boolean
}

export interface EmailClient {
  enviarMensagem(endereco: string, texto: string): Promise<ResultadoEnvio>
}

/**
 * A configuração de SMTP deste ambiente, ou null (canal não configurado — a tela mostra
 * "não configurado" e nenhuma regra manda e-mail).
 *
 * ⚠️ São as MESMAS credenciais que o GoTrue já usa para o "esqueci a senha" (decisão da spec: não
 * se levanta servidor de e-mail novo). O "esqueci a senha" está quebrado por outro motivo
 * (template e `origin` atrás do nginx) — o ENVIO funciona, e é só dele que isto depende.
 *
 * `SMTP_REMETENTE` é obrigatória: e-mail sem `From` é recusado por qualquer servidor, e deixá-la
 * cair num valor inventado faria o alerta falhar só na primeira tentativa real, em produção.
 */
export function lerConfigEmail(env: NodeJS.ProcessEnv = process.env): ConfigEmail | null {
  const host = (env.SMTP_HOST ?? '').trim()
  const usuario = (env.SMTP_USER ?? '').trim()
  const senha = env.SMTP_PASS ?? ''
  const remetente = (env.SMTP_REMETENTE ?? '').trim()
  if (host === '' || usuario === '' || senha === '' || remetente === '') return null

  const portaBruta = Number.parseInt((env.SMTP_PORT ?? '').trim(), 10)
  const porta = Number.isInteger(portaBruta) && portaBruta > 0 ? portaBruta : 587
  // 465 é TLS direto; todo o resto (587, 25, 2525) é STARTTLS. SMTP_SEGURO sobrepõe, para o caso
  // raro de um servidor com TLS direto em porta fora do padrão.
  const seguroBruto = (env.SMTP_SEGURO ?? '').trim().toLowerCase()
  const seguro = seguroBruto === '' ? porta === 465 : seguroBruto === 'true' || seguroBruto === '1'

  return { host, porta, usuario, senha, remetente, seguro }
}

/**
 * Parte o texto do alerta em assunto e corpo: a PRIMEIRA LINHA é o assunto.
 *
 * ⚠️ POR QUE ASSIM, E NÃO UM TEXTO PRÓPRIO DE E-MAIL: `PortaCanal.enviar` entrega um texto só, e o
 * texto é o MESMO nos três canais (decisão da 0123 — quem lê no e-mail precisa da mesma informação
 * de quem lê no Discord). Toda mensagem do módulo já começa por uma linha de cabeçalho que diz
 * sozinha do que se trata (`📦 EMB390 fechou — 2 divergências de quantidade · Fim de EMB`), então
 * ela é um assunto pronto. Mexer na ordem das linhas de uma mensagem muda o assunto do e-mail —
 * está escrito também em `domain/emb.ts`.
 *
 * Texto de uma linha: o corpo REPETE o assunto, em vez de ir vazio (e-mail sem corpo é marcado como
 * suspeito por vários filtros).
 */
export function separarAssunto(texto: string): { assunto: string; corpo: string } {
  const i = texto.indexOf('\n')
  const primeira = (i === -1 ? texto : texto.slice(0, i)).trim()
  // Cabeçalho de e-mail não aceita quebra de linha: um \r sozinho na primeira linha viraria
  // injeção de cabeçalho. Troca por espaço antes de cortar.
  const assunto = primeira.replace(/[\r\n]+/g, ' ').slice(0, LIMITE_ASSUNTO)
  const corpo = i === -1 ? texto.trim() : texto.slice(i + 1)
  return { assunto, corpo }
}

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * O cliente de e-mail. `transporte` é injetado nos testes; em produção sai do nodemailer, criado
 * UMA vez por cliente (o pool de conexões dele é o que evita um handshake TLS por mensagem).
 */
export function criarEmail(cfg: ConfigEmail, transporte?: TransporteEmail): EmailClient {
  let atual = transporte ?? null

  async function obter(): Promise<TransporteEmail> {
    if (atual) return atual
    // Import dinâmico: o nodemailer é Node puro e não pode entrar no bundle do cliente. Também
    // mantém o custo fora dos ambientes sem SMTP configurado.
    const { createTransport } = await import('nodemailer')
    const t = createTransport({
      host: cfg.host,
      port: cfg.porta,
      secure: cfg.seguro,
      auth: { user: cfg.usuario, pass: cfg.senha },
      pool: true,
      maxConnections: 2,
      connectionTimeout: TEMPO_LIMITE_MS,
      greetingTimeout: TEMPO_LIMITE_MS,
      socketTimeout: TEMPO_LIMITE_MS,
    })
    atual = { enviar: (m) => t.sendMail(m) }
    return atual
  }

  return {
    async enviarMensagem(endereco: string, texto: string): Promise<ResultadoEnvio> {
      const para = endereco.trim()
      // A fila já filtra endereço em branco (0151), mas falhar aqui é barato e evita abrir conexão.
      if (para === '') return { ok: false, erro: 'E-mail: endereço do destinatário em branco.' }
      const { assunto, corpo } = separarAssunto(texto)
      try {
        const t = await obter()
        const r = await t.enviar({ from: cfg.remetente, to: para, subject: assunto, text: corpo })
        // Sem messageId o e-mail saiu de qualquer forma: o servidor aceitou. Guardar string vazia
        // é melhor que marcar falha e reenviar uma mensagem já entregue.
        return { ok: true, mensagemExternaId: r.messageId ?? '' }
      } catch (e) {
        // ⚠️ NUNCA deixar a senha chegar aqui: o erro vai para `alerta_envios.erro` e para a tela.
        // `replaceAll` cobre o servidor que ecoa a credencial na mensagem de EAUTH.
        const cru = mensagemDe(e)
        const limpo = cfg.senha === '' ? cru : cru.replaceAll(cfg.senha, '***')
        return { ok: false, erro: `E-mail: ${limpo}` }
      }
    },
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/infra/__tests__/email.test.ts`
Expected: PASS (12 testes).

- [ ] **Step 6: Ligar o canal em `tipos.ts` e `canais.ts`**

Em `domain/tipos.ts`:

```ts
/** Canais de envio suportados nesta versão. */
export type Canal = 'telegram' | 'discord' | 'email'
export const CANAIS: readonly Canal[] = ['telegram', 'discord', 'email']
export const NOME_CANAL: Record<Canal, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  email: 'E-mail',
}

/** É um canal conhecido? (entrada vinda de formulário/banco) */
export function ehCanal(valor: unknown): valor is Canal {
  return valor === 'telegram' || valor === 'discord' || valor === 'email'
}
```

Em `infra/canais.ts`:

```ts
import { lerConfigEmail, criarEmail } from './email'

/** Quais canais este ambiente consegue usar (a tela mostra "não configurado" nos outros). */
export function canaisConfigurados(env: NodeJS.ProcessEnv = process.env): Record<Canal, boolean> {
  return {
    telegram: !!env.TELEGRAM_BOT_TOKEN,
    discord: !!env.DISCORD_BOT_TOKEN,
    email: lerConfigEmail(env) !== null,
  }
}

// ...dentro de criarPortasCanais, depois do Discord:
  const configEmail = lerConfigEmail(env)
  if (configEmail) {
    const mail = criarEmail(configEmail)
    const porta: PortaCanal = {
      // O e-mail é só pessoa: "avisar no canal" é sempre o canal do Discord (0123), e o check
      // alerta_envios_email_so_pessoa da 0151 já impede a linha de canal nascer. Falha explícita
      // aqui é melhor que mandar e-mail para um endereço que por acaso é um id de canal.
      enviar: (destino, texto) =>
        destino.tipo === 'usuario'
          ? mail.enviarMensagem(destino.externoId, texto)
          : Promise.resolve({ ok: false as const, erro: 'E-mail não avisa em canal, só por mensagem direta.' }),
      // E-mail enviado não se edita. O botão "Resolvido" não existe nele (nenhuma mensagem de
      // e-mail nasce com botão: o botão é um componente de Telegram/Discord), então não há nada a
      // remover — devolver ok evita que `removerBotoesDaOcorrencia` tente de novo a cada rodada.
      removerBotoes: () => Promise.resolve({ ok: true as const }),
    }
    portas.email = porta
  }
```

⚠️ `PortaCanal.enviar` recebe três argumentos; o do e-mail ignora o terceiro
(`ocorrenciaIdBotao`) — escreva a assinatura com dois parâmetros e deixe o comentário explicando.

⚠️ `canaisConfigurados` ganhou chave: `Record<Canal, boolean>` já cobra isso no compilador. Veja
também `enviar-alertas.ts`: `const canais: Canal[] = CANAIS.filter((c) => portas[c])` já inclui
`'email'` sozinho — **nada a mudar lá**, e isso é bom sinal de que a abstração de canal aguentou.

- [ ] **Step 7: `.env.example`**

Acrescente, depois do bloco dos Alertas:

```
# Canal de E-MAIL dos alertas (SMTP) — server-only. SÃO AS MESMAS CREDENCIAIS QUE O GoTrue JÁ USA
# para o "esqueci a senha": não se levanta servidor de e-mail novo. Sem SMTP_HOST/USER/PASS/
# REMETENTE o canal aparece como "não configurado" e nenhuma regra manda e-mail.
# O endereço do destinatário é o do LOGIN (usuarios.email): não há cadastro de endereço.
SMTP_HOST=
# Padrão 587 (STARTTLS). 465 liga TLS direto sozinho.
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
# O `From` do e-mail. Obrigatório: e-mail sem From é recusado. Ex.: ShopFloor <alertas@exemplo.com.br>
SMTP_REMETENTE=
# Só para servidor com TLS direto em porta fora do padrão ('true'/'1'). Vazia = decide pela porta.
SMTP_SEGURO=
```

- [ ] **Step 8: Rodar tudo**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
npx vitest run --maxWorkers=2
npx tsc --noEmit
npx next build
```

Expected: verde. Testes que montam `configurados={{ telegram: true, discord: true }}` vão falhar a
compilação por falta da chave `email` — acrescente `email: true` (ou `false`, onde o teste quer o
canal fora).

- [ ] **Step 9: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
git add package.json package-lock.json .env.example src/modules/alertas/infra/email.ts src/modules/alertas/infra/__tests__/email.test.ts src/modules/alertas/domain/tipos.ts src/modules/alertas/infra/canais.ts
git commit -m "feat(alertas): canal de e-mail (SMTP)

Canal = 'telegram' | 'discord' | 'email'. O cliente usa as MESMAS credenciais SMTP que o
GoTrue ja usa no 'esqueci a senha' (que esta quebrado por outro motivo -- template e
origin --; o envio funciona).

A primeira linha do texto do alerta e o assunto do e-mail: PortaCanal.enviar entrega um
texto so, igual nos tres canais, e toda mensagem do modulo ja comeca por uma linha que
diz sozinha do que se trata. O transporte e injetavel, como o fetch dos outros canais:
nenhum teste abre socket. A senha nunca entra na mensagem de erro, que vai pro banco e
pra tela.

Spec: docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md (decisao 8)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: O e-mail na tela (e o botão de testar)

**Files:**
- Modify: `src/modules/alertas/domain/regra.ts` (`DestinatarioDisponivel.emailOk`, `destinatariosSemCanal`)
- Modify: `src/modules/alertas/infra/regras-repository.ts` (ler `email_ok`)
- Modify: `src/modules/alertas/ui/regra-form.tsx` (o rótulo da seção e o aviso de quem não recebe)
- Modify: `src/modules/alertas/ui/alertas-tela.tsx` (o aviso de canal não configurado)
- Modify: `src/app/(app)/perfil/cartao-alertas.tsx` (o e-mail não se vincula: mostrar o endereço e o botão de teste)
- Modify: `src/modules/alertas/application/perfil-alertas-actions.ts` (teste por e-mail)
- Create: `src/modules/alertas/domain/__tests__/regra-email.test.ts`
- Modify: `src/modules/alertas/ui/__tests__/regra-form-emb.test.tsx` (um caso a mais)
- Modify: `src/app/(app)/perfil/__tests__/cartao-alertas.test.tsx`

**Interfaces:**
- Consumes (Tasks 7 e 8): `email_ok` em `alerta_destinatarios`, `Canal` com `'email'`,
  `canaisConfigurados().email`, a porta de e-mail em `criarPortasCanais`.
- Produces: nada para tarefas seguintes (é a ponta da UI).
- `DestinatarioDisponivel` passa a ser:
  ```ts
  export interface DestinatarioDisponivel {
    usuarioId: string
    nome: string
    email: string
    telegram: boolean
    discord: boolean
    /** O endereço de login serve para enviar (não está em branco). */
    email_ok → emailOk: boolean
  }
  ```
  ⚠️ O nome no TS é `emailOk` (camelCase, como o resto do repositório mapeia); a coluna do banco é
  `email_ok`.

- [ ] **Step 1: Escrever o teste do aviso "sem canal"**

Crie `src/modules/alertas/domain/__tests__/regra-email.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { destinatariosSemCanal, type DestinatarioDisponivel } from '../regra'

const ANA: DestinatarioDisponivel = {
  usuarioId: 'u1', nome: 'Ana', email: 'ana@x', telegram: true, discord: true, emailOk: true,
}
const BETO: DestinatarioDisponivel = {
  usuarioId: 'u2', nome: 'Beto', email: '', telegram: false, discord: false, emailOk: false,
}

describe('destinatariosSemCanal com e-mail', () => {
  it('avisa quem está sem endereço de e-mail quando a regra manda e-mail', () => {
    expect(destinatariosSemCanal([ANA, BETO], ['u1', 'u2'], ['email'])).toEqual(['Beto sem E-mail'])
  })

  it('não avisa ninguém quando o canal de e-mail não está marcado', () => {
    expect(destinatariosSemCanal([ANA, BETO], ['u1', 'u2'], ['telegram'])).toEqual(['Beto sem Telegram'])
  })

  it('soma os avisos dos três canais', () => {
    expect(destinatariosSemCanal([BETO], ['u2'], ['telegram', 'discord', 'email'])).toEqual([
      'Beto sem Telegram',
      'Beto sem Discord',
      'Beto sem E-mail',
    ])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/domain/__tests__/regra-email.test.ts`
Expected: FAIL — `emailOk` não existe em `DestinatarioDisponivel` e `destinatariosSemCanal` indexa
`d[c]`, que para `'email'` hoje cairia na string `email` (truthy) em vez do booleano.

⚠️ Esse é um **bug real** que o teste pega: `destinatariosSemCanal` faz `canais.filter((c) => !d[c])`,
e `d['email']` é a string do endereço. Com `'email'` entrando em `Canal`, a função passaria a ler o
endereço como "tem canal" — e um endereço em branco (`''`) por acidente daria o aviso certo, mas um
endereço preenchido de um usuário desativado também. Indexar por canal deixou de ser seguro.

- [ ] **Step 3: Implementar**

Em `domain/regra.ts`:

```ts
export interface DestinatarioDisponivel {
  usuarioId: string
  nome: string
  /** O endereço de login. Mostrado na tela; NÃO é o "tem canal" (ver `emailOk`). */
  email: string
  telegram: boolean
  discord: boolean
  /** O endereço de login serve para enviar (não está em branco) — o "tem canal" do e-mail. */
  emailOk: boolean
}

/**
 * Avisos do diálogo: quem está escolhido mas não recebe por algum canal marcado.
 *
 * ⚠️ O mapa canal → campo é EXPLÍCITO, e não `d[canal]`. Com o canal 'email' na lista, `d['email']`
 * passaria a ler o ENDEREÇO (uma string) como se fosse o booleano "tem canal": endereço preenchido
 * daria "tem", mesmo num caso em que não dá. Um mapa é uma linha a mais e não tem como enganar.
 */
const TEM_CANAL: Record<Canal, (d: DestinatarioDisponivel) => boolean> = {
  telegram: (d) => d.telegram,
  discord: (d) => d.discord,
  emailOk: undefined as never, // ⚠️ remova esta linha: a chave é 'email', não 'emailOk'
  email: (d) => d.emailOk,
}

export function destinatariosSemCanal(
  disponiveis: DestinatarioDisponivel[],
  selecionados: string[],
  canais: Canal[],
): string[] {
  return disponiveis
    .filter((d) => selecionados.includes(d.usuarioId))
    .flatMap((d) => canais.filter((c) => !TEM_CANAL[c](d)).map((c) => `${d.nome} sem ${NOME_CANAL[c]}`))
}
```

⚠️ O `TEM_CANAL` acima tem, de propósito, uma linha errada marcada com `⚠️ remova esta linha` — ela
está aqui para você **não** copiar sem ler. O mapa correto tem três entradas: `telegram`, `discord`
e `email`.

⚠️ `destinatariosSemCanal` percorre `canais` na ordem em que vêm; o terceiro teste espera
`telegram, discord, email`, que é a ordem de `CANAIS`. Se o formulário passar outra ordem, o teste
de UI que compara listas vai pegar — mantenha o `canaisSel` construído a partir de `CANAIS`.

Em `infra/regras-repository.ts`, em `listarDestinatarios`:

```ts
  return ((data ?? []) as {
    usuario_id: string
    nome: string
    email: string
    telegram: boolean
    discord: boolean
    email_ok: boolean | null
  }[]).map((l) => ({
    usuarioId: l.usuario_id,
    nome: l.nome,
    email: l.email,
    telegram: l.telegram,
    discord: l.discord,
    // Banco ainda sem a 0151 (deploy antes da migração): a coluna não vem. Cai no endereço não
    // estar em branco — a mesma conta que a 0151 faz, só que aqui.
    emailOk: l.email_ok ?? l.email.trim() !== '',
  }))
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --maxWorkers=2 src/modules/alertas/domain/__tests__/regra-email.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: O e-mail no formulário**

Em `src/modules/alertas/ui/regra-form.tsx`, a sub-lista de canais da conversa privada já itera
`CANAIS` — com `'email'` em `CANAIS`, o checkbox aparece **sozinho**. Só o texto precisa de ajuste,
porque "conversa privada" não descreve e-mail:

```tsx
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Como avisar
          <Explica titulo="Como avisar">
            <p><strong>Mensagem direta ao responsável</strong>: é o comportamento de sempre — cada um recebe a mensagem. Marcando, escolha por onde: <strong>Telegram</strong>, <strong>Discord</strong>, <strong>E-mail</strong> ou os três.</p>
            <p>O <strong>E-mail</strong> vai para o endereço com que a pessoa entra no sistema. Não há cadastro de endereço, e quem não tem conta no sistema não pode ser avisado.</p>
            <p><strong>No canal do Discord</strong>: uma mensagem só, no canal do sistema, que todo mundo do canal vê.</p>
            <p>Dá para marcar os dois. Só no canal: ninguém recebe mensagem direta, e os responsáveis continuam podendo apertar <strong>Resolvido</strong> ali mesmo.</p>
            <p>A mensagem no canal <strong>não marca ninguém</strong> (@here/cargo): quem não estiver com o Discord aberto pode não notar.</p>
          </Explica>
        </legend>
        {/* ... */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label="Mensagem direta ao responsável"
              checked={avisarPessoas}
              onChange={() => setAvisarPessoas((a) => !a)}
            />
            Mensagem direta ao responsável
          </label>
```

⚠️ `aria-label="Conversa privada do responsável"` muda para
`aria-label="Mensagem direta ao responsável"`. Procure essa string nos testes existentes
(`regra-canal.test.ts`, `regra-form.test.tsx`) e atualize.

⚠️ A linha de estado de cada destinatário na lista de Responsáveis também ganha o e-mail:

```tsx
              <span className="text-xs text-muted-foreground">
                Telegram {d.telegram ? '✓' : '—'} · Discord {d.discord ? '✓' : '—'} ·
                E-mail {d.emailOk ? '✓' : '—'}
              </span>
```

Acrescente um caso ao `regra-form-emb.test.tsx`:

```tsx
  it('oferece o e-mail como canal e o manda ao servidor', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g9' })
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Fim de EMB' } })
    fireEvent.click(screen.getByLabelText('E-mail'))
    fireEvent.click(screen.getByLabelText('Beto Recebimento'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(enviado().canais).toEqual(['email'])
  })
```

- [ ] **Step 6: O e-mail em Meu perfil**

`src/app/(app)/perfil/cartao-alertas.tsx` hoje lista Telegram e Discord com "Vincular" /
"Desvincular" / "Enviar teste". **O e-mail não se vincula** (decisão 7 da spec): o cartão dele
mostra o endereço de login e só o botão de teste.

```tsx
{/* ⚠️ O E-MAIL NÃO TEM VÍNCULO: o endereço é o do login (usuarios.email). Não há "Vincular", não
    há "Desvincular" e não há confirmação — é o que a spec de 2026-10-09 decidiu (decisão 7). O que
    cabe aqui é mostrar PARA ONDE vai e deixar provar que chega. */}
<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
  <div className="flex flex-col">
    <span className="text-sm font-medium">E-mail</span>
    <span className="text-xs text-muted-foreground">
      {email.trim() === ''
        ? 'Seu cadastro está sem e-mail — avise o TI: você não vai receber alerta por e-mail.'
        : email}
    </span>
  </div>
  <Button variant="outline" disabled={pendente || email.trim() === ''} onClick={() => testar('email')}>
    Enviar teste
  </Button>
</div>
```

E em `src/modules/alertas/application/perfil-alertas-actions.ts`, a action de teste precisa aceitar
`'email'`. Hoje `enviarTeste` (em `application/enviar-alertas.ts`) chama
`repo.contaDoUsuario(usuarioId, canal)` e desiste se não houver conta — que é o caso do e-mail
**sempre**. Mude só isso:

```ts
export async function enviarTeste(
  portas: PortasCanais,
  repo: RepositorioEnvios,
  p: { usuarioId: string; canal: Canal; nome: string; email?: string },
): Promise<ResultadoSimples> {
  const porta = portas[p.canal]
  if (!porta) return { ok: false, erro: `${NOME_CANAL[p.canal]} não está configurado neste ambiente.` }

  // O e-mail NÃO tem vínculo: o destino é o endereço de login, que quem chama informa (a action
  // pega da sessão). Telegram e Discord continuam exigindo a conta vinculada.
  let externoId: string
  if (p.canal === 'email') {
    externoId = (p.email ?? '').trim()
    if (externoId === '') return { ok: false, erro: 'Seu cadastro está sem e-mail.' }
  } else {
    const conta = await repo.contaDoUsuario(p.usuarioId, p.canal)
    if (!conta) return { ok: false, erro: `Vincule o ${NOME_CANAL[p.canal]} antes de enviar o teste.` }
    externoId = conta.externoId
  }

  const dados = { nome: p.nome }
  const texto = textoDoEnvio('teste', dados)
  const resultado = await porta.enviar({ tipo: 'usuario', externoId }, texto, null)
  await repo.registrarEnvioDireto({
    usuarioId: p.usuarioId,
    canal: p.canal,
    tipo: 'teste',
    texto,
    dados,
    resultado,
  })
  return resultado.ok ? { ok: true } : { ok: false, erro: resultado.erro }
}
```

⚠️ `textoDoEnvio('teste', ...)` devolve `textoTeste(nome)`. Confira que ele tem **mais de uma
linha** ou que a primeira linha serve de assunto — se for uma linha só, `separarAssunto` repete o
assunto no corpo, o que está certo e é o que o teste de `email.test.ts` cobre.

⚠️ `registrarEnvioDireto` grava em `alerta_envios` com `modulo` default `'shopfloor'` (0149). Para
um teste isso não tem consequência (linha já final, `tipo = 'teste'`, nunca reservada). Deixe como
está e escreva um comentário de uma linha dizendo isso — senão o próximo leitor vai achar que é bug.

Atualize `src/app/(app)/perfil/__tests__/cartao-alertas.test.tsx`:

```tsx
  it('o e-mail não oferece vincular nem desvincular — só o teste', () => {
    montar({ email: 'ana@x' })
    expect(screen.getByText('ana@x')).toBeInTheDocument()
    const cartaoEmail = screen.getByText('E-mail').closest('div')!.parentElement!
    expect(cartaoEmail.querySelector('button')!.textContent).toContain('Enviar teste')
  })

  it('cadastro sem e-mail: avisa e desliga o teste', () => {
    montar({ email: '   ' })
    expect(screen.getByText(/cadastro está sem e-mail/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar teste/i })).toBeDisabled()
  })
```

- [ ] **Step 7: O aviso de "não configurado" na tela**

`alertas-tela.tsx` já monta a frase a partir de `CANAIS.filter((c) => !configurados[c])`, então o
e-mail entra sozinho. Confirme a leitura da frase resultante com os três canais fora:
"Telegram não configurado · Discord não configurado · E-mail não configurado neste ambiente —
regras com esse canal não enviam nada." — a frase continua correta no plural.

- [ ] **Step 8: Rodar tudo e conferir o build**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
npx vitest run --maxWorkers=2
npx tsc --noEmit
npx next build
```

Expected: verde. Os testes que montam `DestinatarioDisponivel` sem `emailOk` vão falhar a
compilação — acrescente o campo.

- [ ] **Step 9: Commit**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-emb"
git add src/modules/alertas/domain/regra.ts src/modules/alertas/domain/__tests__/regra-email.test.ts src/modules/alertas/infra/regras-repository.ts src/modules/alertas/application/enviar-alertas.ts src/modules/alertas/application/perfil-alertas-actions.ts src/modules/alertas/ui/regra-form.tsx src/modules/alertas/ui/alertas-tela.tsx src/modules/alertas/ui/__tests__/regra-form-emb.test.tsx src/app/\(app\)/perfil/cartao-alertas.tsx src/app/\(app\)/perfil/__tests__/cartao-alertas.test.tsx
git commit -m "feat(alertas): e-mail na tela e no Enviar teste

O checkbox de E-mail entra sozinho na lista de canais (CANAIS). O que precisou de mao:
'conversa privada' virou 'mensagem direta' (e-mail nao e conversa), a linha de cada
responsavel mostra se o endereco serve, e Meu perfil ganha um cartao de E-mail SEM
vincular/desvincular -- o endereco e o do login -- com so o botao de teste.

destinatariosSemCanal passou a usar um mapa explicito canal -> campo: com 'email' em
Canal, o `d[canal]` de antes leria o ENDERECO (string) como o booleano 'tem canal'.

Spec: docs/superpowers/specs/2026-10-09-aviso-fim-de-emb-design.md (decisao 7, caso 8)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Fim do Pedaço 3.** A feature está completa: e-mail, Discord e Telegram.

---

## Fechamento — o que fazer depois da última tarefa

Não é tarefa: é a lista do que ainda falta para isto virar produção, e que **não** cabe neste plano.

- [ ] **Smoke guiado no Dev**, com o usuário, na ordem dos 8 casos de aceitação da spec. O caso 8
  (botão de testar chegando nos três canais) só se prova aqui — o `enviarTeste` tem teste de
  unidade, mas a entrega real depende de token e de SMTP.
- [ ] **Revisão de código** (`superpowers:requesting-code-review`), com atenção a: a ordem das
  colunas do `union all` do `alerta_avaliar`; os três fan-outs de pessoa estarem iguais; nenhum
  `'shopfloor'` fixo sobrando em caminho novo (`grep -rn "'shopfloor'" src/modules/alertas`).
- [ ] **Promover as três migrações** (0149, 0150, 0151) **antes** do deploy do app, nesta ordem,
  no Dev e depois no Prod/RDS. Aditivas: sem dump.
- [ ] **Pôr as cinco variáveis de SMTP** no `.env` do servidor (as mesmas do GoTrue) **antes** do
  deploy — sem elas o canal aparece como "não configurado" e nenhuma regra manda e-mail, calada.
- [ ] **Decidir o deploy:** a spec diz que os três pedaços podem ir juntos num deploy só ou
  separados. É decisão de deploy, não de implementação.
- [ ] Atualizar a memória do projeto (`shopfloor-processo-modulo` / `alertas-shopfloor`) com o que
  entrou e em que migração.

---

## Autorrevisão deste plano

**Cobertura da spec**, requisito por requisito:

| Requisito da spec | Onde está |
|---|---|
| Vira tipo de regra nos Alertas, não tela própria (decisão 1) | Tasks 4, 5, 6 |
| Duas rotas, um componente; Alertas ficam em Ajustes (decisão 2) | Task 3 |
| `alerta_regras.modulo`, retroativa para `'shopfloor'` | Task 1, Step 4 |
| Cada tela lista só as regras do módulo dela | Task 2 (Step 12) + Task 1 (Step 6) + Task 3 (Step 1) |
| Item de menu do Recebimento com `modulo`/`perm` | Task 3, Step 7 |
| Dispara quando todos os processos da EMB terminam (decisão 3) | Task 4, Step 6 (`rec_embs_fechadas`) |
| Terminal = Almoxarifado **ou** Reprovado | Task 4, Step 6 + teste T5 |
| Avaliado no cron de 5 minutos, não por gatilho | Task 4, Step 7 (dentro do `alerta_avaliar`) |
| Marca de "já avisei", não reenvia | Task 4, Step 5 (tabela) e Step 7 (gravação) + testes T3 e T4 |
| Conteúdo: só as divergências e as justificativas (decisão 4) | Task 4, Step 6/7 + Task 5 (`textoEmb`) |
| "Ninguém justificou" em destaque | Task 5, `textoEmb` + teste |
| Toda EMB que fecha manda; sem divergência, a mensagem diz que fechou limpa (decisão 5, corrigida em 14/10/2026) | Task 4, Step 7 (nenhum `if` pula a EMB limpa) + teste T4 + Task 5 (`textoEmb` com lista vazia) |
| Destinatários escolhidos na regra (decisão 6) | Task 1 (`alerta_destinatarios(p_modulo)`) + Task 6 |
| E-mail do login como endereço (decisão 7) | Task 7 (fan-out + reserva) + Task 9 (Meu perfil) |
| SMTP do GoTrue, sem servidor novo | Task 8 (`lerConfigEmail`) + `.env.example` |
| Canais: e-mail, Discord e Telegram (decisão 8) | Task 7 + Task 8 |
| Regra sem posto e sem janela, padrão do resumo | Task 4 (checks) + Task 5 (`validarRegra`, `resumoJanelaRegra`) |
| `Canal` ganha `'email'`; `TipoRegra` ganha o valor novo | Task 8 e Task 5 |
| Não trava nada / não reenvia / não é por fornecedor | Nenhuma tarefa acrescenta trava nem filtro de fornecedor — por construção |
| Não mexe no "esqueci a senha" | Task 8 usa só o envio; o aviso está no cabeçalho de `email.ts` |
| Caso 1 (EMB aberta) | Task 4, teste T1 |
| Caso 2 (último item fecha → sai) | Task 4, teste T2 |
| Caso 3 (rodada seguinte → nada) | Task 4, teste T3 + sabotagem no Step 9 |
| Caso 4 (EMB limpa → manda, dizendo que fechou sem divergência) | Task 4, teste T4 + Task 5 (`textoEmb` com lista vazia) |
| Caso 5 (reprovado também é fim) | Task 4, teste T5 |
| Caso 6 (regra de um módulo não aparece no outro) | Task 1 teste T3 · Task 2 Step 12 · Task 3 Step 1 · Task 6 Step 5 |
| Caso 7 (quem administra só o Recebimento consegue usar) | Task 1 testes T3/T4/T5 · Task 2 Step 14 · Task 3 Step 6 |
| Caso 8 (botão de testar chega nos três canais) | Task 9, Step 6 (`enviarTeste` com e-mail) + smoke no Fechamento |
| Ordem de entrega em três pedaços, cada um entregável sozinho | Pedaços 1, 2 e 3 |

Nenhum requisito ficou sem tarefa.

**Consistência de nomes e tipos** (conferida entre tarefas):
`ModuloAlerta` · `MODULOS_ALERTA` · `ehModuloAlerta` · `NOME_MODULO_ALERTA` ·
`TIPOS_REGRA_POR_MODULO` · `tipoPertenceAoModulo` · `ROTA_ALERTAS` (Task 2 → Tasks 3, 5, 6) ·
`listarRegras(modulo)` · `listarDestinatarios(modulo)` · `listarOcorrencias(modulo, f)` (Task 2 →
Task 3) · `modulo` como **1º** parâmetro de toda action (Task 2 → Tasks 3, 6) ·
`DivergenciaEmb`/`textoEmb`/`JANELA_EMB`/`LIMITE_EMB` (Task 5 → Tasks 5, 6) ·
`EmailClient`/`ConfigEmail`/`lerConfigEmail`/`separarAssunto`/`criarEmail` (Task 8 → Task 9) ·
`emailOk` no TS × `email_ok` no banco (Task 7 → Task 9, mapeado em `listarDestinatarios`) ·
`alerta_emb_avisada (regra_id, emb)` (Task 4) · `rec_embs_fechadas(p_desde)` /
`rec_emb_divergencias(p_emb)` (Task 4) · as chaves do `dados` de tipo `'emb'` (Task 4 → Task 5).

**Pontos onde a implementação vai doer, avisados nas tarefas:**
1. A ordem das colunas do `union all` do `alerta_avaliar` (Task 4, Step 7) — posicional, 24 colunas,
   e `rg.modulo` entrou na 0149.
2. `create or replace` não troca o tipo de retorno: `alerta_destinatarios` precisa de `drop` **antes**
   do `create` na 0151, ao contrário de todas as outras (Task 7, Step 4).
3. `destinatariosSemCanal` indexava por canal e passaria a ler o endereço como booleano (Task 9,
   Step 2) — é bug real, pego por teste.
4. Os `Record<TipoRegra, ...>` do `regra-form.tsx` quebram a compilação quando `'emb'` entra, e isso
   é o compilador cobrando cobertura: **não** troque por `Partial<Record<...>>` (Task 5, Step 9).

---

## Entrega da execução

**Plano completo e salvo em `docs/superpowers/plans/2026-10-09-aviso-fim-de-emb.md`. Duas opções de
execução:**

**1. Subagent-Driven (recomendada)** — um subagente novo por tarefa, revisão entre tarefas, iteração
rápida. Use `superpowers:subagent-driven-development`.

**2. Execução inline** — as tarefas nesta sessão, em lotes com pontos de revisão. Use
`superpowers:executing-plans`.

**Qual das duas?**
