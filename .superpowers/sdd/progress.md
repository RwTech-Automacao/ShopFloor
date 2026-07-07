# Progresso — Plano 1: Fundação

Plano: docs/superpowers/plans/2026-07-07-fundacao-base.md

## Pré-requisitos
- P1 Node.js 20 LTS: OK (v20.20.2)
- P2 Supabase CLI: OK (2.109.1)
- P3 Chaves Supabase: pendente (usuário preenche .env.local na Task 2)

## Tasks
- [x] Task 1: Scaffold Next.js + TS + Tailwind + shadcn + Vitest
- [x] Task 2: Clients Supabase + env + middleware
- [x] Task 3: supabase init + link (interativo — usuário)
- [x] Task 4: Migration perfis/usuarios + RBAC + seed
- [x] Task 5: Migration listas
- [x] Task 6: Migration configuracao_campos
- [x] Task 7: Migration importacoes/processos
- [x] Task 8: Migration logs imutáveis
- [x] Task 9: Domínio perfil/permissões (TS)
- [x] Task 10: Sessão + mapeamento perfil
- [ ] Task 11: Login + actions auth
- [ ] Task 12: Layout autenticado + menu por perfil + home
- [ ] Task 13: Doc bootstrap admin

Task 1: complete (commits 16661c4..1224ced, review PASS)
  - Minor (p/ review final): globals.css `--font-sans` autorreferente → Geist Sans não aplica (fix 1 linha: `--font-sans: var(--font-geist-sans)`).
  - Nota de stack: Next 16, React 19, Tailwind v4 (@config), shadcn/Base UI (não Radix).

Task 2: complete (commits 1224ced..3bd2a3d, review PASS)
  - Minor (review final): browser/server/middleware não passam por env.ts (intencional: evita vazar service_role no bundle client; considerar validador env client-safe).
  - Minor (review final): adicionar `import 'server-only'` em service.ts quando ganhar consumidor (Task 10/logs).

Task 3: complete — supabase init + login + link ao projeto "Project Shop Floor" (ref ykwkacfviarhfmxeisqk, sa-east-1, PG17). Conexão remota OK via `migration list` (sem senha). db push liberado.

Tasks 4-8: complete (commits cd86721..f7dd506) — review opus FAIL→corrigido em 0006 (commit 1d9b925).
  - C1 (Crítico) resolvido: logs imutáveis contra TRUNCATE (trigger statement + REVOKE), live-tested.
  - I1 (Importante) resolvido: processos_update agora gateia finalização em 'finalizar'; edição de finalizado em 'editar_finalizado'.
  - Minors resolvidos: log não-forjável (usuario_id=auth.uid()), handle_new_user tolera email nulo, listas_delete com guarda sistema=false, search_path nas funções util.
  - Nota: `supabase db query --linked` executa SQL arbitrário (verificação).

Tasks 9-10: complete — domínio de perfil/permissões (TDD), mapearPerfil (TDD), usuario-repository e getSessao (aplicação/infra). `npm test` (7/7) e `npm run build` verdes.
