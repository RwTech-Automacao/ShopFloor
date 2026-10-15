# Dashboard de divergências do Recebimento — spec

**Data:** 14/10/2026 · **Branch:** `feat/recebimento-dashboard-divergencia` (da `main` em `64750c9`)
**Desenho aprovado pelo usuário em 14/10/2026.** Esta spec fixa o que o desenho deixou em aberto.

## 1. O que é, e para quem

Uma tela de **leitura** que responde, de relance: *quanto do que chegou veio com divergência de
quantidade, de quem, quando — e quanto ainda ninguém explicou?* É a contrapartida, no Recebimento,
do dashboard do ShopFloor, com o mesmo molde visual (filtros em cima, números grandes, gráficos
abaixo, clicar filtra a tela toda).

Quem usa: o gestor e o pessoal do Recebimento. Quem tem `recebimento.visualizar` vê; ninguém edita
nada aqui — justificar continua sendo na grade de Processos.

## 2. Onde mora

⚠️ **Correção ao que foi dito na conversa:** o Recebimento **não tem** item "Análise" no menu — essa
palavra só existe no ShopFloor. O menu do Recebimento hoje é: Importar Planilha · Processos · Fluxo ·
Registros · Importações · Etiquetas · Etiquetar rolo · Exportar Fotos.

**Proposta:** um item novo **"Dashboard"** no menu do Recebimento, entre **Fluxo** e **Registros**,
na rota `/recebimento/dashboard`, com o ícone de gráfico. Permissão: `recebimento.visualizar`.
O item entra em `src/shared/ui/app-shell.tsx` (o menu real; `recebimento-nav.ts` é código morto).

## 3. A régua — o que cada número conta

A unidade é o **item** (uma linha de `processos_recebimento`: um material de uma EMB). Tudo é
contado **pela data de chegada** (`data_chegada`), nunca pela data de lançamento.

| Número | Definição exata |
|---|---|
| **Itens** | linhas do recorte (filtros aplicados), `status <> 'cancelado'` |
| **Com divergência** | dos itens, os com `divergencia_num <> 0` |
| **Sem justificativa** | dos "com divergência", os com `btrim(divergencia_justificativa) = ''` |
| **Positiva** | `divergencia_num > 0` (chegou a mais) |
| **Negativa** | `divergencia_num < 0` (chegou a menos) |

**A regra de "tem divergência" é a mesma da grade de Processos** (`divergencia_num <> 0`, a coluna
gerada da 0147) e a mesma de `temDivergencia`/`rec_divergente`. **Os números do dashboard têm de
bater com o filtro rápido "Divergências" de Processos para o mesmo recorte** — é um teste (§8).

Linha sem `data_chegada` **não entra** em nenhum recorte por data (e o rodapé diz quantas ficaram
de fora quando há filtro de data). Linha com `divergencia_num` nulo (não conferida, texto) conta em
**Itens** e nunca em "Com divergência".

Cada número tem um **ⓘ** que mostra esta definição em português.

**Rodapé da contagem**, sempre visível: "137 de 1.284 itens (10,7%) em 42 EMBs". A porcentagem
**não é arredondada para 100** quando não é 100 (lição do dashboard do ShopFloor, 02/09).

## 4. Os filtros

Fornecedor · Comprador · EMB · Código do material · De · Até · **Limpar filtros**.

- **Fornecedor** e **Comprador:** lista suspensa com os valores distintos que existem (texto livre
  no banco, então "ACME" e "Acme" aparecem separados — a comparação é exata, sem tentar adivinhar).
- **EMB** e **Código do material:** campo de texto, comparação exata sem diferenciar maiúsculas.
- **De / Até:** sobre `data_chegada`, inclusivos. Padrão: **os últimos 90 dias** (um dashboard sem
  recorte de data sobre a tabela inteira mistura anos). O padrão aparece preenchido e dá para limpar.
- Clicar numa barra de fornecedor, numa semana ou numa fatia positiva/negativa **aplica o filtro
  correspondente** e a tela inteira recalcula. O filtro aplicado aparece como uma etiqueta
  removível, e **Limpar filtros** tira todas.

## 5. Os três gráficos

1. **Ranking por fornecedor** — barras horizontais, os **10** fornecedores com mais itens
   divergentes; cada barra mostra o nº de itens divergentes e, ao lado, "x% dos itens dele".
   Fornecedor em branco aparece como "(sem fornecedor)".
2. **Divergências por semana** — barras verticais, uma por semana (segunda a domingo) da
   `data_chegada`, no intervalo do recorte; semana sem divergência aparece com altura zero (o eixo
   não "pula" semanas). Duas séries empilhadas: **justificadas** e **sem justificativa**.
3. **Positivas × negativas** — duas barras (ou duas fatias) com a contagem de itens de cada sinal.

Gráficos desenhados em SVG à mão, como os do dashboard do ShopFloor (o projeto não usa biblioteca
de gráficos). Rótulos e eixos usam os tokens do tema, legíveis no claro e no escuro.

## 6. Banco — agregado lá, não no navegador

**Migração 0152** (as 0149–0151 estão na `feat/alertas-fim-de-emb`; a 0152 é a próxima livre),
**aditiva e idempotente**, só `create or replace function` + grants + um índice se a medição pedir.

Seguem o molde das `rec_*` da 0124 (não o da 0101): `language plpgsql`, `stable`, `security definer`,
`set search_path = public`, `$func$` (nunca dois cifrões, nem em comentário),
`revoke … from public, anon, authenticated` + `grant execute … to authenticated`, e a porta é
**`tem_permissao('recebimento', 'visualizar')` de DOIS argumentos** — a de um argumento aceita
qualquer módulo e anula o RBAC (achado da revisão de segurança de 21/09).

- **`rec_dashboard(p_fornecedor, p_comprador, p_emb, p_codigo, p_de, p_ate)` → `jsonb`**
  Devolve **tudo numa chamada só**: `totais` (itens, com divergência, sem justificativa, positivas,
  negativas, embs, fora_do_recorte_por_data), `fornecedores` (top 10), `semanas` (série contínua).
  Uma chamada porque o Fluxo do ShopFloor mostrou o custo de 12 requisições no carregamento.
  Texto vazio = sem filtro; datas nulas = sem recorte.
- **`rec_dashboard_opcoes()` → `jsonb`** `{ fornecedores: [...], compradores: [...] }` — os valores
  distintos, não vazios, ordenados, para as duas listas suspensas.

**Desempenho:** medir no Dev **com `set role`** (não como superusuário) e com `EXPLAIN (ANALYZE)`
antes de decidir por índice (lição da 0096: medir com a role errada esconde o problema). A 0147 já
tem o índice parcial em `divergencia_num <> 0`. Se `data_chegada` precisar de índice, ele entra na
mesma migração; se a medição mostrar que não precisa, não entra.

## 7. App (TypeScript)

- `src/modules/recebimento/domain/dashboard.ts` — tipos do resultado, `percentual` (sem arredondar
  para 100), padrão dos 90 dias, e o texto dos ⓘ. Puro, testável.
- `src/modules/recebimento/infra/dashboard-repository.ts` — as duas chamadas `rpc`.
- `src/app/(app)/recebimento/dashboard/page.tsx` (servidor, gate `recebimento.visualizar`) e os
  componentes de cliente: filtros, cartões, três gráficos. O estado dos filtros vive na URL
  (`searchParams`), como a grade de Processos — o link compartilhado reproduz a tela.
- Menu: um item em `app-shell.tsx`.

## 8. Testes

- **SQL (harness `rodar-recebimento-test.sh`):** a 0152 aplicada duas vezes; os totais contra um
  conjunto conhecido; **os números batem com `divergencia_num <> 0` / `> 0` / `< 0` da grade**;
  `cancelado` fora; `data_chegada` nula fora do recorte com data e contada no rodapé; semana vazia
  presente na série; permissão negada para quem só tem ShopFloor (`SEM_PERMISSAO`).
  Cada asserção precisa **falhar de verdade** se a regra estiver errada (sabotar para provar).
- **Vitest:** `percentual`, o padrão de 90 dias, a conversão filtros ↔ URL, e a página com o gate.
- **Smoke no Dev** contra a cópia dos dados reais, comparando 3 números com a grade de Processos.

## 9. Fora do escopo (de propósito)

Exportar para planilha · gráfico por comprador · soma de **peças** faltantes/sobrantes (a régua é
item, não quantidade) · abrir a grade de Processos já filtrada a partir de um número · alertas.
Qualquer um entra depois, em branch própria, se o uso pedir.

## 10. Decisões — resolvidas pelo usuário em 15/10/2026

O usuário aceitou todas as recomendações:

1. **Menu:** item novo **"Dashboard"**, entre Fluxo e Registros (§2).
2. **`cancelado` fora dos números, nos DOIS lugares:** o dashboard **e** os filtros de divergência da
   grade de Processos (a branch `feat/recebimento-filtros-divergencia` aplica a mesma exclusão).
   Assim os números dos dois continuam batendo para o mesmo recorte.
3. **Recorte padrão de 90 dias** (§4).
4. **Top 10** fornecedores (§5).
5. **Semana de segunda a domingo** (§5).

**Dependência entre branches:** o teste de "os números batem com o filtro da grade" (§8) só passa
depois que a branch dos filtros estiver na `main` (ou for trazida para esta). Até lá, o teste SQL
compara contra a CONDIÇÃO (`divergencia_num <> 0 and status <> 'cancelado'`), não contra a tela.
