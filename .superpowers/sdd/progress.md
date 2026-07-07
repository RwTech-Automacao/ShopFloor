# Progresso — Plano 1: Fundação

Plano: docs/superpowers/plans/2026-07-07-fundacao-base.md

## Pré-requisitos
- P1 Node.js 20 LTS: OK (v20.20.2)
- P2 Supabase CLI: OK (2.109.1)
- P3 Chaves Supabase: pendente (usuário preenche .env.local na Task 2)

## Tasks
- [x] Task 1: Scaffold Next.js + TS + Tailwind + shadcn + Vitest
- [x] Task 2: Clients Supabase + env + middleware
- [ ] Task 3: supabase init + link (interativo — usuário)
- [ ] Task 4: Migration perfis/usuarios + RBAC + seed
- [ ] Task 5: Migration listas
- [ ] Task 6: Migration configuracao_campos
- [ ] Task 7: Migration importacoes/processos
- [ ] Task 8: Migration logs imutáveis
- [ ] Task 9: Domínio perfil/permissões (TS)
- [ ] Task 10: Sessão + mapeamento perfil
- [ ] Task 11: Login + actions auth
- [ ] Task 12: Layout autenticado + menu por perfil + home
- [ ] Task 13: Doc bootstrap admin

Task 1: complete (commits 16661c4..1224ced, review PASS)
  - Minor (p/ review final): globals.css `--font-sans` autorreferente → Geist Sans não aplica (fix 1 linha: `--font-sans: var(--font-geist-sans)`).
  - Nota de stack: Next 16, React 19, Tailwind v4 (@config), shadcn/Base UI (não Radix).
