# Dashboard do Recebimento: métricas novas (plano de implementação)

> **Para quem executa:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans. Passos com `- [ ]`.

**Meta:** acrescentar ao `/recebimento/dashboard` os blocos Volume, Qualidade, Atraso, Tempo e Pendências, **sem alterar** a `rec_dashboard` (0152) nem a tela atual.
**Spec:** `docs/superpowers/specs/2026-10-20-dashboard-recebimento-metricas-design.md` (branch `feat/dashboard-recebimento-metricas`).
**Arquitetura:** uma função SQL nova `rec_dashboard_metricas` (migração **0154**, uma chamada, no molde da `rec_dashboard`), um carregador novo no repositório, um tipo de domínio novo e componentes novos abaixo do que existe. Nada do que existe muda de comportamento.
**Pilha:** Postgres 15 (plpgsql, jsonb), Next.js 16 (App Router, Server Components), React 19, TypeScript, Vitest, Tailwind v4. **Ler `AGENTS.md`: este Next.js tem mudanças em relação ao que você conhece; consulte `node_modules/next/dist/docs/` antes de escrever código de rota.**

## Restrições globais (valem para todas as tarefas)

- PT-BR em toda a interface e nos comentários. `tem_permissao` **sempre com 2 argumentos**: `tem_permissao('recebimento','visualizar')`.
- Migração **aditiva e idempotente** (`create or replace`), corpo com `$func$` (o SQL Editor não aceita dois cifrões), `security definer`, `set search_path = public`, `notify pgrst, 'reload schema'` ao fim, `revoke` de `public`/`anon` e `grant execute` a `authenticated` (siga o fim da 0152).
- Item = linha de `processos_recebimento`; `status = 'cancelado'` fica **fora** de tudo. Filtros de texto passam por `rec_norm_texto` (da 0152); EMB e código comparam com `upper(...)`.
- **Não editar** `rec_dashboard`, `rec_dashboard_opcoes`, `domain/dashboard.ts` (apenas importar dele), nem os testes existentes. Código novo em arquivos novos, exceto a fiação mínima em `page.tsx` e `dashboard-recebimento.tsx`.
- Tema claro e escuro: cores só por tokens/classes do projeto (veja `graficos-dashboard.tsx`).
- Tabelas/arquivos de teste SQL rodam no Postgres descartável (Docker); **nada contra produção**.
- Commits pequenos, mensagem em PT-BR, terminando com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Regras de negócio (decididas com o usuário em 20/10)

1. **Reprovado e "com resultado":** o campo `resultado` pode vir vazio em itens já finalizados (o `status` terminal espelha o resultado; a lista "Resultado" é configurável). Por isso:
   `reprovado = lower(btrim(status)) = 'reprovado' OR lower(btrim(resultado)) = 'reprovado'`;
   `com_resultado = lower(btrim(status)) NOT IN ('aberto','em_conferencia') OR btrim(resultado) <> ''`.
   **Taxa de reprovação por item** = `reprovados ÷ com_resultado`. Peças (reprovadas ÷ recebidas) só na dica.
2. **De/Até** (sobre `data_chegada`, inclusivos) valem para **Volume, Qualidade, Atraso e Tempo (durações)**. **Não** valem para **Pendências** nem para **Parados** (são estado atual). Fornecedor, comprador, EMB e código valem para tudo.
3. **X dias** (parados) ∈ {3, 7, 15, 30}, padrão **7**; outro valor → `raise exception 'PARADO_INVALIDO'`.
4. Eixo mensal do **mais antigo para o mais novo**. Semana = segunda a domingo (igual à 0152).
5. "Hoje" = data de **São Paulo**: `(now() at time zone 'America/Sao_Paulo')::date`.

## O contrato do jsonb que `rec_dashboard_metricas` devolve (snake_case; números nunca nulos, exceto onde indicado)

```json
{
  "volume": {
    "semanas": [{ "inicio": "2026-09-07", "itens": 12, "embs": 3 }],
    "meses":   [{ "inicio": "2026-09-01", "itens": 40, "embs": 9 }]
  },
  "qualidade": {
    "totais": { "com_resultado": 100, "reprovados": 4, "pecas_recebidas": 52000, "pecas_reprovadas": 380 },
    "fornecedores": [{ "fornecedor": "ACME", "com_resultado": 20, "reprovados": 3 }],
    "materiais":    [{ "codigo": "RWPC99", "descricao": "Capacitor", "com_resultado": 8, "reprovados": 2 }],
    "motivos":      [{ "motivo": "Fora de especificação", "itens": 3 }]
  },
  "atraso": {
    "totais": { "com_prazo": 90, "atrasados": 30, "media_dias_atraso": 4.5 },
    "fornecedores": [{ "fornecedor": "ACME", "com_prazo": 10, "atrasados": 6, "media_dias": 5.2 }]
  },
  "tempo": {
    "recebimento": { "n": 70, "media_dias": 1.8, "mediana_dias": 1.0 },
    "qualidade":   { "n": 65, "media_dias": 3.2, "mediana_dias": 2.1 },
    "parados": { "dias": 7, "recebimento": 4, "qualidade": 9 },
    "sem_tempo": 12
  },
  "pendencias": {
    "total": 229,
    "faixas": { "no_prazo": 100, "d1_7": 40, "d8_30": 50, "d30_mais": 30, "sem_prevista": 9 },
    "fornecedores": [{ "fornecedor": "ACME", "pendentes": 12, "atrasados": 8 }]
  }
}
```

`media_dias_atraso`, `media_dias` e `mediana_dias` são **`null`** quando não há base (a tela mostra "—", nunca zero). Rankings: **top 10** (motivos: top 5), ordenados por quantidade desc e depois pelo nome, para a ordem não variar entre duas cargas iguais. Fornecedor/código em branco vêm como `''` (a tela escreve "(sem fornecedor)"). Casas decimais: 1.

Definições dos blocos (todas pelas regras acima):
- **Volume:** por `data_chegada` (só linhas com data); `itens` = contagem; `embs` = EMBs distintas não vazias. Séries contínuas (período sem nada = zero), de `coalesce(p_de, primeira chegada)` até `coalesce(p_ate, última chegada limitada a hoje + 52 semanas)`; teto de 520 semanas e de 120 meses (como o teto da 0152).
- **Qualidade:** sobre itens `com_resultado` no recorte. `pecas_*` somam `quantidade_recebida` e `quantidade_reprovada` desses itens (nulo = 0). `fornecedores`/`materiais` só com `reprovados > 0`; material = `codigo_material` não vazio, `descricao` = `max(descricao_material)`. `motivos` = `motivo_reprovacao` não vazio dos itens reprovados.
- **Atraso:** itens do recorte com `data_prevista` **e** `data_chegada`; dias = `data_chegada − data_prevista`; atrasado = dias > 0; `media_dias_atraso` = média só dos atrasados. A coluna de texto `atraso` **não** é usada. `fornecedores` só com `atrasados > 0`.
- **Tempo:** a primeira conferência vem de `logs` (`entidade = 'processo'`, `acao = 'mudar_status'`, `dados->>'para' = 'em_conferencia'`; `min(created_at)`), a última entrada na Qualidade é o `max(created_at)` desse mesmo log. `recebimento` = dias de `data_chegada` até a primeira conferência (itens do recorte com `data_chegada` e log; mínimo 0). `qualidade` = dias de `primeira` até `finalizado_em` (itens do recorte finalizados, com log; mínimo 0). `mediana_dias` = `percentile_cont(0.5)`. **Parados** (sem recorte de data): `recebimento` = `status = 'aberto'` com `data_chegada` e `hoje − data_chegada > X`; `qualidade` = `status = 'em_conferencia'` com log e `now() − ultima > X dias`. `sem_tempo` = itens do recorte com `status <> 'aberto'` e **sem** log de entrada na Qualidade.
- **Pendências** (sem recorte de data): `status = 'aberto'` e `data_chegada is null`. Faixa por `hoje − data_prevista`: `<= 0` no prazo, `1..7`, `8..30`, `> 30`; sem `data_prevista` = `sem_prevista`. `fornecedores` = top 10 por `atrasados` (dias > 0).

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/0154_rec_dashboard_metricas.sql` | criar | a função `rec_dashboard_metricas` |
| `supabase/tests/recebimento_dashboard_metricas_esquema.sql` | criar | colunas extras e a tabela `logs` mínima para o banco de teste |
| `supabase/tests/recebimento_dashboard_metricas_massa.sql` | criar | massa com números conhecidos para cada bloco |
| `supabase/tests/recebimento_dashboard_metricas_test.sql` | criar | asserts de cada bloco, da porta e dos filtros |
| `supabase/tests/rodar-recebimento-test.sh` | modificar (acrescentar no fim) | roda a 0154 duas vezes e o teste novo num **banco próprio** (`dashmet`) |
| `src/modules/recebimento/domain/dashboard-metricas.ts` | criar | tipos `MetricasDashboard`, `PARADOS_OPCOES`, `paradoDaUrl`, formatadores e textos `EXPLICA_METRICAS` |
| `src/modules/recebimento/infra/dashboard-metricas-repository.ts` | criar | `carregarMetricas(filtros, paradoDias)` chamando a RPC |
| `src/app/(app)/recebimento/dashboard/metricas-dashboard.tsx` | criar | a seção de métricas (cartões + 5 blocos) |
| `src/app/(app)/recebimento/dashboard/graficos-metricas.tsx` | criar | barras de ranking genéricas, colunas de volume, faixas de pendência |
| `src/app/(app)/recebimento/dashboard/page.tsx` | modificar (mínimo) | carregar as métricas em paralelo, falhando **separado** do resto |
| `src/app/(app)/recebimento/dashboard/dashboard-recebimento.tsx` | modificar (mínimo) | renderizar `MetricasDashboard` abaixo do conteúdo atual |
| testes: `domain/__tests__/dashboard-metricas.test.ts`, `infra/__tests__/dashboard-metricas-repository.test.ts`, `dashboard/__tests__/metricas-dashboard.test.tsx` | criar | cobertura de cada arquivo novo |

## Tarefa 1 (frente BANCO): a função e seus testes SQL

**Interface produzida:** `public.rec_dashboard_metricas(p_fornecedor text default null, p_comprador text default null, p_emb text default null, p_codigo text default null, p_de date default null, p_ate date default null, p_parado_dias integer default 7) returns jsonb`, exatamente com o contrato acima.

- [ ] **1.1** Ler `supabase/migrations/0152_rec_dashboard.sql` (estrutura da função, `rec_norm_texto`, `not materialized`, teto das séries, grants) e `supabase/tests/recebimento_dashboard_{esquema,massa,test}.sql` + `rodar-recebimento-test.sh` (como o banco próprio `dashboard` é montado).
- [ ] **1.2** Criar o esquema extra do banco de teste: o do dashboard **mais** as colunas `resultado text`, `data_prevista date`, `data_compra date`, `finalizado_em timestamptz`, `quantidade_recebida numeric`, `quantidade_reprovada numeric`, `motivo_reprovacao text`, `descricao_material text` em `processos_recebimento`, e a tabela `logs (id uuid pk default gen_random_uuid(), entidade text, entidade_id uuid, acao text, descricao text, dados jsonb, usuario_id uuid, usuario_nome text, created_at timestamptz default now())` com o índice `(entidade, entidade_id)`. Os nomes e tipos são os do banco real.
- [ ] **1.3** Escrever a **massa** (ids e datas fixos, hoje relativo a `current_date` onde precisar) cobrindo, com números **conhecidos e anotados no cabeçalho do arquivo**: itens aprovados e reprovados (alguns com `resultado` vazio e `status` terminal, outros com `resultado` preenchido); item `cancelado` (tem de ficar de fora de tudo); itens em duas semanas e dois meses diferentes; atrasados e no prazo; um fornecedor com todos no prazo; um item sem `data_prevista`; abertos **sem** `data_chegada` em cada faixa de atraso, e um sem `data_prevista`; aberto **com** `data_chegada` antiga (parado no Recebimento); `em_conferencia` com log antigo e outro com log recente (parados × não); finalizados com e sem log (um entra em `sem_tempo`); EMBs repetidas para provar o `count(distinct)`; fornecedor em branco.
- [ ] **1.4** Escrever o **teste** (modelo: `recebimento_dashboard_test.sql`, com `pg_temp.confere`): a porta (`SEM_PERMISSAO` sem `recebimento.visualizar`; permissão de outro módulo não abre), `PARADO_INVALIDO` para 5, cada bloco com os números da massa, **De/Até** (valem para Volume/Qualidade/Atraso/Tempo e **não** para Pendências/Parados), cada filtro de texto, o X em 3/7/15/30 mudando os parados, `null` onde não há base, ordem determinística dos rankings, séries contínuas e o teto.
- [ ] **1.5** Rodar o teste e **ver falhar** (função inexistente).
- [ ] **1.6** Escrever a migração `0154_rec_dashboard_metricas.sql` (cabeçalho no estilo da 0152 explicando o quê/por quê, as regras de negócio acima e a decisão de **não** mexer na `rec_dashboard`).
- [ ] **1.7** Acrescentar ao `rodar-recebimento-test.sh`, depois do bloco do dashboard da 0152, o banco próprio `dashmet`: esquema extra → 0142/0143/0147 → 0152 → massa → 0154 **duas vezes** com `psql -1` → teste. Rodar `supabase/tests/rodar-recebimento-test.sh` inteiro: **tem de terminar verde**, com os testes antigos intactos.
- [ ] **1.8** Medir: no banco `dashmet`, gerar ~300 mil linhas (como `recebimento_dashboard_massa.sql` já faz para a 0152, se houver) e comparar `EXPLAIN ANALYZE` de `rec_dashboard_metricas` como `authenticated` (`set role`), mediana de 3, recorte de 90 dias. **Meta: abaixo de 250 ms.** Se passar, anotar o número no cabeçalho da migração e propor o índice (por exemplo parcial em `logs` ou em `processos_recebimento (data_chegada)`), sem criá-lo sem medir.
- [ ] **1.9** Commit: `git add` só dos arquivos desta tarefa.

## Tarefa 2 (frente TELA): domínio, repositório e fiação

**Consome:** o contrato jsonb acima. **Produz:** `MetricasDashboard` (camelCase), `carregarMetricas`, `paradoDaUrl`.

- [ ] **2.1** Ler `domain/dashboard.ts` (padrão de tipos, `filtrosDaUrl`, `formatarNumero`, `formatarPercentual`, `percentual`, `rotuloFornecedor`) e `infra/dashboard-repository.ts` (padrão do RPC).
- [ ] **2.2** `domain/dashboard-metricas.ts`: tipos em camelCase espelhando o contrato; `PARADOS_OPCOES = [3, 7, 15, 30] as const`, `PARADOS_PADRAO = 7`; `paradoDaUrl(sp)` (valida, cai em 7); `formatarDias(n: number | null): string` (`null` → `'—'`; `1,8 d`; vírgula decimal pt-BR); `faixasPendencias(faixas)` devolvendo as linhas rotuladas (No prazo · 1 a 7 dias · 8 a 30 dias · Mais de 30 dias · Sem data prevista); `taxaPorItem(reprovados, comResultado)` reaproveitando `percentual`; e o objeto `EXPLICA_METRICAS` com o texto de ajuda (ⓘ) de cada bloco, em PT-BR claro, dizendo a régua (por item, por `data_chegada`, que Pendências e Parados ignoram De/Até).
- [ ] **2.3** Testes de domínio **primeiro** (falhando), depois a implementação.
- [ ] **2.4** `infra/dashboard-metricas-repository.ts` (`'server-only'`): `carregarMetricas(filtros: FiltrosDashboard, paradoDias: number): Promise<MetricasDashboard>` chamando `supabase.rpc('rec_dashboard_metricas', {...})` com os mesmos parâmetros da `carregarDashboard` mais `p_parado_dias`; `error` lança; `null` lança (**nunca** devolver zeros no lugar de falha); converte snake_case → camelCase com `Number(...)`; `null` de média permanece `null`. Teste com o supabase simulado (modelo: `regras-repository-modulo.test.ts`).
- [ ] **2.5** `page.tsx`: carregar `carregarMetricas` **em paralelo** (`Promise.all` com os outros) mas em `try/catch` **próprio**: se só as métricas falharem, a página mostra os blocos antigos e uma mensagem **na seção nova**; passar `metricas` e `paradoDias` ao componente. `dashboard-recebimento.tsx`: renderizar `MetricasDashboard` abaixo do conteúdo existente, sem mudar o que já existe.

## Tarefa 3 (frente TELA): componentes dos blocos

- [ ] **3.1** Ler `graficos-dashboard.tsx` (como `CartaoGrafico`, `RankingFornecedores`, `GraficoSemanas` e as cores por classe são feitos) e `cartoes-dashboard.tsx` (`Cartao`, `Explica`).
- [ ] **3.2** `graficos-metricas.tsx`: `BarrasRanking` (linhas `{rotulo, valor, total?, texto}`, com `ativo` e `onClique`, mesmo molde visual de `RankingFornecedores`), `ColunasVolume` (colunas de itens por período, com a dica de EMBs; eixo do mais antigo para o mais novo; acessível, com `aria-label`), `FaixasPendencias` (cinco barras horizontais). Estados vazios com texto claro ("Nenhum item no período"), nunca gráfico em branco.
- [ ] **3.3** `metricas-dashboard.tsx` (client): fileira de **quatro números** (% atrasados, taxa de reprovação, mediana na Qualidade, parados há mais de X dias) e os cinco blocos, cada um num `CartaoGrafico` com ⓘ de `EXPLICA_METRICAS`. Volume tem alternador **Semana | Mês**; Tempo tem o **seletor de X** (3, 7, 15, 30), que navega para a URL com `parado=<X>` (e **só** põe `parado` na URL quando ≠ 7), preservando os outros parâmetros. Clicar num fornecedor ou material **filtra a página inteira** pelas mesmas funções `aplicarClique`/`urlDosFiltros` de `domain/dashboard.ts` (material usa o filtro de código; se `aplicarClique` não aceitar `{ codigo }`, **não editar** o domínio existente: montar `{ ...filtros, codigo }` e navegar com `urlDosFiltros`). Valores nulos → "—".
- [ ] **3.4** Testes de componente **primeiro** (`@testing-library/react`, modelo: `filtros-cartoes.test.tsx` e `graficos-dashboard.test.tsx`): números e rótulos, "—" para nulo, alternador Semana/Mês, seletor de X navegando, clique filtrando, estado vazio, e erro **só da seção** de métricas sem derrubar a página.
- [ ] **3.5** Commit por tarefa; **nunca** commitar HAR, segredo ou arquivo fora da lista.

## Tarefa 4 (controle, depois das frentes): verificação e prova local

- [ ] **4.1** `npx tsc --noEmit` limpo; `npx vitest run --maxWorkers=2` **inteiro** verde (a suíte tinha 241 arquivos e 2.672 testes antes desta branch).
- [ ] **4.2** `rodar-recebimento-test.sh` verde de ponta a ponta.
- [ ] **4.3** `NODE_OPTIONS="--max-old-space-size=4096" npx next build` sem erro.
- [ ] **4.4** Aplicar a 0154 no banco **local** (Docker `supabase_db_shopfloor-filtros-local`), subir o app local em `http://localhost:3500` (não `127.0.0.1`), abrir `/recebimento/dashboard` e conferir a tela nos temas claro e escuro, em largura de celular, com e sem filtros. **Entregar prints/descrição ao usuário antes de qualquer deploy.**
- [ ] **4.5** Registrar o número medido e o resultado em `docs/superpowers/specs/2026-10-20-dashboard-recebimento-metricas-design.md` (seção "Medições").

## Fora do escopo (YAGNI)

Exportar para Excel, alertas sobre as métricas, metas por fornecedor, índice novo sem medição, qualquer mudança na `rec_dashboard`, na grade de Processos ou no Fluxo.
