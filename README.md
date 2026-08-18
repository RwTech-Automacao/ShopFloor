# ShopFloor — Enterplak MES

Sistema web modular de **Shop Floor / MES** para a indústria de manufatura eletrônica
Enterplak. Digitaliza e centraliza processos antes feitos em planilhas Excel, Google Forms
e Google Apps Script. Uso em produção, multi-setor, com arquitetura preparada para crescer.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** + **shadcn/ui** (Base UI) — ícones `lucide-react`, toasts `sonner`, temas `next-themes`
- **Supabase** (Postgres + Auth + RLS)
- **React Flow** (`@xyflow/react`) — canvas do Fluxo de Processos
- **SheetJS** (`xlsx`) — importação de planilhas no cliente
- **Supabase Storage / Cloudflare R2 / Google Drive** (`@aws-sdk/client-s3`, `googleapis`) — armazenamento de fotos (configurável via `FOTOS_STORAGE`)
- **Vitest** — testes de domínio/aplicação
- Conector Repinmetro (`tools/repinmetro-conector/`): **Node.js** + `pg` (node-postgres) + `fetch` nativo

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
tools/                       # utilitários fora da app (ex.: conector Repinmetro)
docs/                        # specs, planos e histórico
```

Autorização é decidida no banco (**RLS**) a partir de perfis com permissões granulares; a UI
apenas reflete. Toda mutação relevante gera um **log imutável** (auditoria).

## Módulos

- **Fundação** — autenticação, perfis/RBAC, layout, logs imutáveis.
- **Configurações & Logs** — Usuários, Perfis, Listas, Campos, Logs, Sobre.
- **Recebimento** — importação de planilhas → processos; formulário dinâmico; ciclo de vida
  (Aberto → Em Conferência → Finalizado/Cancelado); campos calculados (atraso, divergência,
  crítico, amostral/NQA, responsável); grade tipo Excel (ordenação/filtro por coluna, colunas
  configuráveis).
- **Etiquetas** — geração de etiquetas/Part Number por recebimento.
- **ShopFloor Processo** — rastreabilidade da montagem de PCB. Cadastro de OP (faixa de SN,
  postos ordenados, receita/BOM), **Lançamento por bipe** por posto (inspeção, teste, SPI, NQA,
  Burn-in, integração, embalagem — comportamento por **perfil de posto**), Manutenção/reparo,
  Pesquisa/Grade, Dashboard e **Fluxo de Processos** (acompanhamento em tempo real do caminho de
  cada peça, com linha do tempo por Nº de Série e **Modo TV**). **Modo Kiosk** para o chão de
  fábrica (trava o operador na tela, saída por login do supervisor).
- **Repinmetro** — integração que espelha os logs de teste de qualidade do sistema legado
  (Repinmetro) para consulta por Nº de Série/Modelo dentro do ShopFloor. Conector *outbound* em
  `tools/repinmetro-conector/` (lê o Postgres da intranet como read-only, sync incremental por
  marca d'água, roda agendado na máquina do banco). Ver o `README.md` da pasta do conector.

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
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Armazenamento de fotos: supabase (default) | r2 | drive
FOTOS_STORAGE=supabase
# Cloudflare R2 (quando FOTOS_STORAGE=r2) — API compatível com S3
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
# Google Drive (quando FOTOS_STORAGE=drive)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_FOLDER_ID=
```

> Lista completa em `.env.example`. O conector Repinmetro tem o **próprio** `.env` em
> `tools/repinmetro-conector/` (não é o `.env.local` da app).

### Banco de dados

As migrations em `supabase/migrations/` são a fonte da verdade do schema. Aplicadas ao
projeto Supabase via `supabase db push` (Supabase CLI vinculada ao projeto).

O primeiro usuário nasce com perfil **Consulta**; promova-o a Administrador seguindo
`docs/operacao/primeiro-admin.md`.

## Documentação

- Specs de design: `docs/superpowers/specs/`
- Planos de implementação: `docs/superpowers/plans/`
- Histórico/handoff da construção: `docs/historico/`
