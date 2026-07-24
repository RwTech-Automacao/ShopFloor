# RBAC Fase 2a — RLS por módulo (só ShopFloor) — Design

> Torna as políticas de RLS das tabelas `sf_*` + o RPC de cancelar integração **conscientes de
> módulo** (`shopfloor`). Recebimento/Sistema ficam pra Fase 2b/2c. Decidido em 2026-07-24.

## Contexto
A Fase 1 entregou os grants (`perfil_permissao`) + enforcement no **app**. Mas o **RLS** ainda lê os
flags globais `pode_*` via `tem_permissao(perm)` (82 políticas). Como `pode_visualizar`/`pode_administrar`
são OR entre módulos, um perfil de **Recebimento** (viewer ou admin) alcançaria dados de **ShopFloor** por
API direta. A Fase 2a fecha isso **só nas tabelas sf_*** (Dev — ShopFloor não está em Prod, baixo risco).

## Decisão de escopo (usuário, 2026-07-24)
**Fase 2a = só ShopFloor** (sf_* + o RPC que vaza). Recebimento (Prod, 37 políticas) e Sistema (Prod,
auth) ficam pra fases próprias.

## Arquitetura

### Nova função `tem_permissao(modulo, perm)` (lê os grants)
```sql
create or replace function public.tem_permissao(modulo text, perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.usuarios u
    join public.perfil_permissao pp on pp.perfil_id = u.perfil_id
    where u.id = auth.uid() and u.ativo
      and pp.modulo = modulo and pp.permissao = perm
  );
$$;
```
- **Mantém** a `tem_permissao(perm text)` atual (Recebimento/Sistema + os RPCs de `lancar` seguem usando).
  As duas coexistem (arities diferentes → overload OK; não dropar a antiga).

### Políticas sf_* reescritas → `tem_permissao('shopfloor', <perm>)`
Tabelas: `sf_ordens`, `sf_ordem_postos`, `sf_ordem_componentes`, `sf_registros`, `sf_defeitos`,
`sf_postos`, `sf_integracoes`, `sf_integracao_itens`. Cada política `drop` + `create` com a forma de
dois argumentos, mesmo `perm`, módulo `'shopfloor'`. (visualizar→select; administrar→all; lancar→insert.)
- **Fecha o vazamento:** viewer/admin de Recebimento deixa de ler/escrever sf_*.
- Views `sf_ordem_resumo`/`sf_burnin_aberto` (security_invoker) herdam do RLS das tabelas base — nada a mudar.

### RPC `sf_cancelar_integracao` → `tem_permissao('shopfloor','administrar')`
Único RPC onde `administrar` vaza (admin de Recebimento cancelaria integração). Recriar com o check novo.

### RPCs de `lancar` — **inalterados** (premissa documentada)
`sf_lancar`/`sf_integrar`/`sf_burnin`/`sf_registrar_reparo` checam `tem_permissao('lancar')` (antiga).
Como **`lancar` só existe no módulo `shopfloor`**, `pode_lancar ≡ shopfloor.lancar` — o check já é
equivalente ao módulo. Não recriar (evita reproduzir corpos grandes e o risco de regressão). Premissa:
se um dia `lancar` for adicionado a outro módulo, revisar estes 4 RPCs.

## O que NÃO muda
`tem_permissao(perm)` antiga; políticas de Recebimento/Sistema; `pode_*` (seguem derivadas/mantidas).
App (Fase 1) já enforça — o RLS aqui é **defesa em profundidade**.

## Casos de borda
- Um perfil ShopFloor **sem** `shopfloor.visualizar` não lê sf_* (correto). Admin (todos os módulos) segue lendo tudo.
- `tem_permissao(modulo,perm)` com `auth.uid()` nulo (service-role/sem sessão) → false (fecha).

## Testes
- **Inspeção**: `pg_policies` — todas as políticas sf_* referenciam `tem_permissao('shopfloor', …)`;
  a função de 2 args existe. Nenhuma sf_* ainda usa a antiga.
- **Lógica**: query direta simulando um perfil (via `perfil_permissao`) confirma o esperado.
- **Isolamento real (visual)**: logar como perfil só-Recebimento e confirmar bloqueio em sf_* por API
  (o app já esconde; aqui é o backstop). Registrar como teste manual no preview.

## Migração
`0040` (função de 2 args + reescrita das políticas sf_* + `sf_cancelar_integracao`). Só no Dev.
Não dropar a `tem_permissao(perm)` antiga (Fase 2b/2c ainda a usam).
