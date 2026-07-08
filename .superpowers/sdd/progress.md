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
- [x] Task 11: Login + actions auth
- [x] Task 12: Layout autenticado + menu por perfil + home
- [x] Task 13: Doc bootstrap admin

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

Tasks 9-10: complete (commits b14cec1, 92ba2b5, review PASS) — mapeamento 8 flags verificado vs migration; domínio puro.
  - Minor (review final): teste de mapearPerfil cobre só 2/8 flags; considerar teste que cobre as 8.

Tasks 11-12: complete (commits c770a8c, beb20e6, review PASS) — login + layout por perfil; nav filtrado server-side; identidade Enterplak OK.
  - IMPORTANTE (p/ review final / fix): loop de redirect para usuário autenticado-porém-inativo (ativo=false) ou órfão — middleware só vê sessão Supabase e devolve p/ /home; layout devolve p/ /login. Fix: tratar auth-mas-sem-sessão-de-app (ex.: rota /sem-acesso ou signOut ao detectar inativo).
  - Minor: home/page.tsx chama getSessao() de novo (redundante com o layout).
  - Smoke manual de login (fluxo + toggle RBAC) PENDENTE — requer usuário/navegador.

## Review final do branch (opus) — 16661c4..6bbf28b
Sem Critical. RBAC coerente (TS/DB/tem_permissao 1:1; sem auto-escalação; 0006 consistente).
Fix wave (commit 5c6c6cd) aplicou:
- IMPORTANTE resolvido: loop de sessão inativa/órfã — middleware valida ativo+perfil, faz signOut e propaga cookies no redirect.
- server-only em service.ts; getSessao com cache(); --font-sans corrigido; lang="pt-BR"; teste mapearPerfil cobre 8 flags.
- Migration 0007: INSERT de processo 'finalizado' exige 'finalizar' (paridade com UPDATE). Aplicada e verificada.
Branch: 9/9 testes, build+lint limpos. 16 migrations→0007 aplicadas no remoto.

## PENDENTE (requer usuário)
- Smoke manual: criar usuário no Supabase Auth → login em /login → validar RBAC (Consulta sem "Configurações"; promover a Administrador → aparece). Ver docs/operacao/primeiro-admin.md.
- Ativos p/ Incremento 2: Google Apps Script de etiquetas.

## STATUS: Plano 1 (Fundação) COMPLETO — pronto para Plano 2 (Configurações & Logs).
