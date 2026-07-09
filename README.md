# ShopFloor — Enterplak MES

Sistema web modular de **Shop Floor / MES** para a indústria de manufatura eletrônica
Enterplak. Digitaliza e centraliza processos antes feitos em planilhas Excel, Google Forms
e Google Apps Script. Uso em produção, multi-setor, com arquitetura preparada para crescer.

## Stack

- **Next.js 16** (App Router) + **TypeScript** (strict)
- **Tailwind CSS v4** + **shadcn/ui** (Base UI)
- **Supabase** (Postgres + Auth + RLS)
- **Vitest** (testes de domínio/aplicação)
- **SheetJS** (`xlsx`) para importação de planilhas no cliente

## Arquitetura

Monólito modular por feature. O domínio é TypeScript puro (sem dependência de Supabase/Next),
o que o torna testável e portável.

```
src/
  app/                       # rotas Next (App Router) — entrega
  modules/<feature>/
    domain/                  # regras de negócio (TS puro, testado)
    application/             # casos de uso / Server Actions finas
    infra/                   # repositórios (Supabase)
  shared/                    # design system, clients Supabase, utilidades
supabase/migrations/         # schema versionado (SQL)
docs/                        # specs, planos e histórico
```

Autorização é decidida no banco (**RLS**) a partir de perfis com permissões granulares; a UI
apenas reflete. Toda mutação relevante gera um **log imutável** (auditoria).

## Módulos

- **Fundação** — autenticação, perfis/RBAC, layout, logs imutáveis.
- **Configurações & Logs** — Usuários, Perfis, Listas, Campos, Logs, Sobre.
- **Recebimento** — importação de planilhas → processos; formulário dinâmico; ciclo de vida
  (Aberto → Em Conferência → Finalizado/Cancelado); campos calculados (atraso, divergência,
  crítico, amostral/NQA, responsável).
- **Etiquetas** — geração de CSV de Part Number *(planejado)*.

## Desenvolvimento

Pré-requisitos: Node.js 20+, uma conta/projeto Supabase.

```bash
npm install
cp .env.example .env.local   # preencha com as chaves do seu projeto Supabase
npm run dev                  # http://localhost:3000
npm test                     # testes
npm run build                # build de produção
```

### Variáveis de ambiente (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

### Banco de dados

As migrations em `supabase/migrations/` são a fonte da verdade do schema. Aplicadas ao
projeto Supabase via `supabase db push` (Supabase CLI vinculada ao projeto).

O primeiro usuário nasce com perfil **Consulta**; promova-o a Administrador seguindo
`docs/operacao/primeiro-admin.md`.

## Documentação

- Specs de design: `docs/superpowers/specs/`
- Planos de implementação: `docs/superpowers/plans/`
- Histórico/handoff da construção: `docs/historico/`
