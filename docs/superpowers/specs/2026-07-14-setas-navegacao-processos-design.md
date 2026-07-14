# Spec — Setas de navegação entre processos (feature #2)

## Contexto
Feature #2 do roadmap (`docs/roadmap-pos-apresentacao.md`): na tela de **detalhe** do processo,
setas **‹ ›** para ir ao processo **anterior/próximo** sem voltar à lista. Decisão do usuário:
seguir **a ordem da lista** (não numérica pura). A lista hoje (feature 3b) é agrupada por mês:
**"Aguardando data de chegada" (sem data) no topo → meses do mais recente ao mais antigo → dentro
de cada grupo, número desc**, respeitando os filtros de busca/status. Requisitos aprovados;
ambiente Dev ainda não existe (migração roda em produção, sem dados reais).

## Objetivo
Navegar entre processos na **ordem exata da lista filtrada**, de forma **contínua** (atravessando
as fronteiras de mês), a partir do rodapé da tela de detalhe.

## Requisitos (confirmados)
1. Duas setas **‹** (anterior) e **›** (próximo), **juntas no canto direito** do **rodapé** do
   detalhe, na **mesma reta do botão Finalizar** (`[Finalizar/Reabrir] ........ [‹] [›]`).
2. As setas **aparecem sempre** (navegação independe do status). Finalizar aparece só em
   `em_conferencia`, Reabrir só em terminal — quando não há ação, o rodapé mostra **só as setas**.
3. Ordem de navegação = a **ordem global da lista**: sem_data → meses desc → número desc, cruzando
   fronteiras de mês (**opção A**). Respeita os filtros de **busca/status** ativos na lista.
4. Setas **desabilitadas nas pontas** (1º processo → ‹ off; último → › off).

## Design

### Ordem (fonte única da verdade)
A ordenação usada pela navegação é **idêntica** à da lista:
```
order by (data_chegada is not null) asc,   -- nulos (sem_data) primeiro
         date_trunc('month', data_chegada) desc,  -- meses do mais recente ao mais antigo
         numero desc                        -- dentro do grupo
```

### RPC `processos_vizinhos` (migração 0016)
Uma função no banco devolve os uuids vizinhos do processo atual **no conjunto filtrado**, via
`LAG`/`LEAD` sobre a ordenação acima. **SECURITY INVOKER** (respeita o RLS — só considera processos
que o usuário pode ver). Filtros opcionais de status (igualdade) e busca livre (ilike nas mesmas
colunas de `COLUNAS_BUSCA_PROCESSO`: numero_nf, numero_pedido, fornecedor, codigo_material,
descricao_material; termo já sanitizado pelo app).

```sql
create or replace function public.processos_vizinhos(
  p_id uuid, p_busca text default null, p_status text default null
)
returns table (anterior uuid, proximo uuid)
language sql stable security invoker set search_path = public
as $$
  with ordenados as (
    select id,
      lag(id)  over w as ant,
      lead(id) over w as prox
    from public.processos_recebimento
    where (p_status is null or status = p_status)
      and (p_busca is null
           or numero_nf ilike '%'||p_busca||'%'
           or numero_pedido ilike '%'||p_busca||'%'
           or fornecedor ilike '%'||p_busca||'%'
           or codigo_material ilike '%'||p_busca||'%'
           or descricao_material ilike '%'||p_busca||'%')
    window w as (
      order by (data_chegada is not null) asc,
               date_trunc('month', data_chegada) desc,
               numero desc
    )
  )
  select ant, prox from ordenados where id = p_id;
$$;
grant execute on function public.processos_vizinhos(uuid, text, text) to authenticated;
```
- `anterior` = processo **acima** na lista (uuid) ou `null` (é o 1º).
- `proximo` = processo **abaixo** ou `null` (é o último).
- Se `p_id` não estiver no conjunto filtrado (filtros mudaram / não casa mais), a query devolve
  **zero linhas** → o app trata como ambos `null` (setas desabilitadas).

### Fluxo (dados)
1. **Lista → detalhe:** os links de "abrir processo" (`linhas-processos.tsx`) passam a incluir os
   filtros ativos como query params: `/recebimento/processos/{id}?busca=…&status=…`. Para isso,
   `linhas-processos.tsx` recebe os `filtros` (via `ProcessosPorMes`, que já os tem).
2. **Detalhe:** `[id]/page.tsx` lê `busca`/`status` de `searchParams`, chama
   `buscarVizinhos(id, { busca, status })` (infra → RPC) e obtém `{ anterior, proximo }`.
3. **Setas:** renderizadas no rodapé; cada uma é um **Link** para
   `/recebimento/processos/{anterior|proximo}?busca=…&status=…` (carrega os filtros adiante,
   mantendo a mesma ordem). Quando o alvo é `null`, renderiza um botão **desabilitado** (não link).

### Camadas
- **domain (opcional, pequeno):** helper puro `queryProcessos(filtros)` que monta a query-string
  `?busca=…&status=…` (omitindo vazios) — reaproveitado pela lista e pelas setas, testável (TDD).
- **infra (`processo-detalhe-repository.ts`):** `buscarVizinhos(id, filtros): Promise<{ anterior:
  string | null; proximo: string | null }>` chamando `supabase.rpc('processos_vizinhos', ...)`.
  Erro → retorna `{ anterior: null, proximo: null }` (fail-safe, não quebra a página).
- **UI:**
  - `linhas-processos.tsx`: recebe `filtros` e inclui os params no href de abrir.
  - `processos-por-mes.tsx`: repassa `filtros` para `LinhasProcessos`.
  - `[id]/page.tsx`: lê searchParams, chama `buscarVizinhos`, monta o rodapé.
  - **Rodapé:** o `acoes-processo` (ou um novo wrapper de rodapé) passa a **sempre** renderizar —
    ações (Finalizar/Reabrir, quando aplicáveis) à esquerda e as **duas setas no canto direito**.
    Um pequeno componente `NavegacaoProcesso({ anterior, proximo, filtros })` renderiza as setas.

### Tratamento de erros / bordas
- 1º/último → a seta correspondente vem desabilitada.
- Filtros mudaram e o processo não casa mais → ambas desabilitadas (RPC devolve 0 linhas).
- Falha na RPC → ambas desabilitadas; a página não quebra.

### Testes
- **domain:** `queryProcessos(filtros)` (monta/omite params) — teste unitário (TDD).
- **RPC + wiring:** a ordenação/vizinhança é SQL — validada por `npm run build` + **smoke** (padrão
  do projeto para código que fala com Supabase). Conferir no smoke: navegar cruzando meses,
  respeitando busca/status, e as pontas desabilitadas.

## Migração em produção
A RPC 0016 é criada em produção (sem dados reais). Reaplicar o schema-cache reload do PostgREST se
necessário (como na 0014). Não altera dados nem outras tabelas.

## Fora de escopo
- Atalhos de teclado (setas ←/→) — possível depois; não agora (YAGNI).
- Pré-carregar/prefetch do próximo processo.

## Relação com outras features
- Depende da ordenação da **3b** (lista por mês) — reusa a mesma ordem.
- Independente da **#7/#3a** (status) — só usa o número/data/filtros, não o status na ordenação.
