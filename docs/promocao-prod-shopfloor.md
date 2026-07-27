# Roteiro de promoção pro Prod — Módulo ShopFloor + RBAC por módulo

> Passo a passo pra levar a branch `feat/shopfloor-lancamento` (migrações 0028–0055 + código) pro
> **Prod** (que está **vivo** com o Recebimento). Escrito em 2026-07-24. Fazer **banco antes, código depois**.
> O módulo ShopFloor sobe **escondido por permissão** (dark launch) — ninguém vê até você conceder grants.

## 0. Pré-requisitos / decisões
- [ ] Smoke do Recebimento no **preview** passou (foco no que o RBAC mexeu — ver checklist no fim).
- [ ] **Dados do ShopFloor no Prod:** as tabelas `sf_*` sobem **vazias** (o módulo fica escondido).
  Decisão: **não** bulk-importar OPs; cadastrar fresh pela tela quando for usar. O **catálogo de
  defeitos** (`sf_defeitos`) pode ser semeado depois (script `scripts/migrar-shopfloor.mjs`, só a parte
  de defeitos) — não é bloqueante pra promoção.
- [ ] Ter em mãos a **connection string do Prod** (Supabase → Project Settings → Database) e o
  `SUPABASE_GO_BINARY` configurado.

## 1. Backup do Prod (rollback) — INEGOCIÁVEL, antes de qualquer migração
Tira uma "foto" completa do banco de Prod. Se algo quebrar, você restaura.
```bash
# formato custom (schema + dados), o mais fácil de restaurar depois
pg_dump "postgresql://postgres:<SENHA>@<HOST-PROD>:5432/postgres" -Fc -f prod_backup_$(date +%Y%m%d_%H%M).dump
# (alternativa: supabase db dump --db-url "<PROD>" -f prod_backup.sql)
```
- [ ] Guardar o arquivo `.dump` em lugar seguro. **Confirmar que gerou** (tamanho > 0).
- **Restaurar (se precisar):** `pg_restore --clean --if-exists -d "postgresql://…PROD…" prod_backup_….dump`
  (isso volta o banco pro estado da foto — perde o que foi gravado depois dela).

## 2. Aplicar as migrações no Prod (banco primeiro)
As migrações são **aditivas** (criam `sf_*`, `perfil_permissao`, funções) + reescrevem RLS por módulo.
A ordem é automática (por número de arquivo). O Prod vai aplicar da 0028 até a 0055.
```bash
# a partir do repo, com o Prod linkado (ou --db-url do Prod)
SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go" supabase db push
```
- **Esperado:** aparece `Applying migration 0028…` … `0055…` e `Finished`. O warning
  `failed to cache migrations catalog … Docker` é **normal** (não impede a aplicação).
- **Ponto de atenção (revisado na chain):** o **0038** (seed dos grants a partir dos `pode_*`) roda
  **antes** do 0040/0051/0054 — é isso que garante que os **admins atuais do Prod mantenham acesso**
  (senão travariam ao ligar o RLS por módulo). Como a ordem é por número, isso é automático — mas
  **confirme no output** que 0038 aparece antes de 0040/0051/0054.
- Pode rodar com o Prod **em uso** (locks breves, sem downtime — DDL aditivo em tabelas novas/vazias).
  Ainda assim, prefira **horário de baixa utilização** por garantia.

## 3. Políticas de STORAGE (bucket de fotos) — só no Prod
As políticas do bucket `anexos-processos` (tabela `storage.objects`) **não existem no Dev** e hoje no
Prod usam a permissão **global** (`tem_permissao('visualizar'/'editar')`) → um usuário só-ShopFloor
conseguiria ler/escrever os **arquivos** de anexo. Precisa do mesmo padrão por módulo.

3a. **Capturar** as políticas atuais do Prod (pra reescrever com precisão):
```sql
-- rodar no SQL editor do Prod (ou via psql)
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname='storage' and tablename='objects'
  and (qual ilike '%tem_permissao%' or with_check ilike '%tem_permissao%');
```
3b. Pra **cada** política retornada, `drop policy … on storage.objects;` + recriar trocando
`tem_permissao('X')` → `tem_permissao('recebimento','X')` (preservando `bucket_id = 'anexos-processos'`
e o resto). Empacotar numa migração nova (ex.: `0056_rls_storage_recebimento.sql`) **só depois** de ver
as definições reais.
- [ ] Testar: usuário só-ShopFloor **não** baixa foto de anexo; usuário Recebimento baixa normalmente.

## 4. Merge + deploy do código
Depois do banco OK:
- [ ] Merge `feat/shopfloor-lancamento` → `main` (PR ou merge direto — sua escolha).
- [ ] Vercel builda e faz o deploy de **Produção** automático no push da `main`.
- ⚠️ **É o momento sensível pro Recebimento:** o código traz o RBAC Fase 1, que trocou ~40 guards
  (incluindo os do Recebimento) de `podeFazer` → `podeNoModulo`. Fazer num horário calmo.

## 5. Smoke pós-deploy no PROD (o crítico)
- [ ] **Recebimento (regressão):** logar com um usuário real de Recebimento → processos, importar,
  etiquetas, anexos, listas — tudo que ele fazia antes **continua funcionando**.
- [ ] **Admin de sistema:** gerencia usuários/perfis normalmente.
- [ ] **ShopFloor escondido:** um usuário **sem** grant de shopfloor **não vê** "Fluxo de Processos".
- [ ] (Opcional) conceder grant de shopfloor a **um** usuário de teste e confirmar que o módulo aparece
  e funciona.

## 6. Rollback (se algo quebrar)
1. **Código** (rápido): Vercel → Deployments → **Redeploy** do build anterior (ou `git revert` do merge
   + push). O app volta à versão de antes **na hora**.
2. **Banco** (só se o RLS travar acesso): reaplicar as políticas antigas do grupo afetado, **ou**
   `pg_restore` do `prod_backup` (perde o que foi gravado desde a foto).
- Como quase tudo é aditivo, o normal é **só o rollback de código** resolver; as tabelas `sf_*` novas
  ficam inofensivas.

## Revisão da chain (feita em 2026-07-24 — estática)
- Dependências OK: `perfil_permissao` (0038) < `tem_permissao(2-arg)` (0040→0043) < políticas Recebimento
  (0051) < Sistema (0054). Sem forward-reference.
- Debug (0044–0053) se auto-cancela (create+drop dentro da chain) → estado final limpo.
- Gap no número 0029 é benigno (Supabase aplica por ordem de arquivo; não precisa ser contíguo).
- **100% de certeza** só com um apply num banco vazio (precisa Docker/projeto descartável) — não feito
  por indisponibilidade de Docker no ambiente; a revisão estática não achou problemas.

## Depois do Prod (não-bloqueante)
- Higiene menor dos reviews (guard por página em usuarios/perfis/logs; `validarEdicaoPerfil` OR global;
  save de perfil sem transação).
- Remover a `tem_permissao(perm)` de 1 arg (exige migrar os 4 RPCs de `lancar`).
- Features do backlog (consolidar busca-por-SN, finalização de OP condicionada, etc.).
