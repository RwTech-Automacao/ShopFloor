# ShopFloor — Enterplak MES

Sistema web modular de **Shop Floor / MES** para a indústria de manufatura eletrônica
Enterplak. Digitaliza e centraliza processos antes feitos em planilhas Excel, Google Forms,
Google Apps Script e Looker Studio. Em uso em produção, multi-setor, com arquitetura preparada
para crescer.

**Produção:** `https://shopfloor.enterplak.com.br` (AWS).

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** + **shadcn/ui** (Base UI) — ícones `lucide-react`, toasts `sonner`, temas `next-themes`
- **Supabase** (Postgres + Auth + RLS) — em produção, **self-hosted** na AWS com o banco no **Amazon RDS**
- **React Flow** (`@xyflow/react`) — canvas do Fluxo de Processos
- **SheetJS** (`xlsx`) — importação de planilhas no cliente
- **Google Drive / Supabase Storage / Cloudflare R2** (`googleapis`, `@aws-sdk/client-s3`) — fotos (configurável via `FOTOS_STORAGE`; produção usa Drive)
- **`qrcode`** — QR Code da folha da caixa · **`jose`** — token do SSO do Portal RwTech
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
deploy/aws/                  # deploy na AWS (script, nginx, bootstrap do RDS, checklists)
tools/                       # utilitários fora da app (ex.: conector Repinmetro)
docs/                        # specs, planos, operação e histórico
```

Autorização é decidida no banco (**RLS**) a partir de perfis com permissões granulares por
módulo; a UI apenas reflete. Toda mutação relevante gera um **log imutável** (auditoria).

## Módulos

- **Fundação** — autenticação (e-mail/senha e **SSO pelo Portal RwTech**),
  perfis/RBAC por módulo, layout com menu retrátil, logs imutáveis.
- **Configurações** — Usuários, Perfis, Listas, Campos, Colunas, Criticidade, NQA, e os cadastros do
  ShopFloor (Postos, Defeitos, Consertos); Logs; Sobre.
- **Recebimento** — importação de planilhas → processos (com **trava de EMB repetida** e **correção
  da importação** reimportando a planilha); formulário dinâmico; ciclo de vida
  (Aberto → Em Conferência → Finalizado/Cancelado); campos calculados (atraso, divergência, crítico,
  amostral/NQA, responsável); grade tipo Excel; fotos; exportação de fotos.
- **Etiquetas** — geração de etiquetas/Part Number por recebimento, com histórico.
- **ShopFloor Processo** — rastreabilidade da montagem de PCB:
  - **Ordens de Produção** — faixa de Nº de Série, postos ordenados, receita/BOM.
  - **Operação** — **Lançamento por bipe** por posto, com comportamento definido pelo **perfil do
    posto** (inspeção, teste, SPI, Burn-in, integração, embalagem, NQA); lançamento coletivo e grupo
    entre postos; reprova com **catálogo de defeitos** e som de erro; **Integração** produto ↔ placas;
    **Embalagem por caixa** (folha com QR Code e CSV); **NQA por caixa** (caixa reprovada vira
    histórico e a remontagem herda o número); **Manutenção**/reparo com retorno por um posto de
    inspeção antes do reteste; cancelamento de lançamento.
  - **Análise** — **Dashboard** (métricas do relatório legado, "como é calculado" em cada número e
    filtro clicando nos gráficos), Pesquisa/Grade por Nº de Série, Burn-in, Caixas, Cancelamentos e
    **Repinmetro**.
  - **Fluxo de Processos** — caminho de cada peça em tempo real, WIP por posto, gráfico de produção,
    linha do tempo por Nº de Série e **Modo TV**.
  - **Registros** — grade dos bipes com filtros e exportação.
  - **Modo Kiosk** — trava o operador na tela; saída por login do supervisor.
- **Repinmetro** — espelho, somente leitura, do sistema legado de testes do REP (Postgres na intranet),
  consultado em **Análise → Repinmetro**:
  - **Testes** — testes de qualidade por Nº de Série/Modelo, com a **revenda** do REP e a data de saída.
  - **Integração** — testes de produção: quais peças foram montadas em cada REP (impressora, MRP,
    módulo biométrico, RFID, fonte, leitor de barras), buscando pelo REP ou pelo serial de uma peça.
  - Conector *outbound* em `tools/repinmetro-conector/`: lê a origem com usuário read-only, sync
    incremental por marca d'água, roda agendado na máquina do banco. Ver o `README.md` da pasta.

## Ambientes

| | Produção | Dev | Demo |
|---|---|---|---|
| App | `shopfloor.enterplak.com.br` (AWS Lightsail, pm2 + nginx) | `localhost:3000` e previews da Vercel por branch | Vercel (branch `main`) |
| Banco | Supabase self-hosted + Amazon RDS | Supabase cloud (projeto Dev) | Supabase cloud (projeto antigo, com cópia dos dados reais) |

As credenciais ficam em arquivos **locais e fora do git** (`.env.local`, `.env.*.local`). Nunca vão
pro repositório.

## Desenvolvimento

Pré-requisitos: Node.js 20+, um projeto Supabase.

```bash
npm install
cp .env.example .env.local   # preencha com as chaves do seu projeto Supabase
npm run dev                  # http://localhost:3000
npm test                     # testes
npm run lint
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
# Google Drive (quando FOTOS_STORAGE=drive)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_FOLDER_ID=
# Cloudflare R2 (quando FOTOS_STORAGE=r2) — API compatível com S3
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=

# SSO do Portal RwTech
RWTECH_SSO_SECRET=
RWTECH_SITE_ID=
```

> Lista de referência em `.env.example`. O conector Repinmetro tem o **próprio** `.env` em
> `tools/repinmetro-conector/` (não é o `.env.local` da app).
>
> `NEXT_PUBLIC_*` é embutido no **build**: mudou a URL do Supabase, precisa buildar de novo.

## Fluxo de trabalho e deploy

1. Uma **branch por feature**, a partir da `main`. O push gera um **preview na Vercel** apontando pro
   banco Dev.
2. Migração nova é aplicada **no Dev** e testada no preview (smoke).
3. Aprovada, a branch é **mergeada na `main`**.
4. **Produção (AWS):**
   1. aplicar as migrações novas no RDS com `psql` (a senha é digitada, nunca colada em chat ou arquivo);
   2. recarregar a API: `docker compose restart rest` na pasta do Supabase;
   3. na instância: `cd ~/ShopFloor && ./deploy/aws/deploy.sh` (pull → `npm ci` se as dependências
      mudaram → build → `pm2 restart`; se o build falhar, o app antigo continua no ar).

### Banco de dados

As migrations em `supabase/migrations/` são a fonte da verdade do schema, numeradas em ordem.
No Dev podem ir pelo SQL Editor do Supabase ou pela CLI (`supabase db push`); na produção (RDS),
por `psql`. Depois de criar ou alterar tabela/função, recarregar o schema do PostgREST
(`notify pgrst, 'reload schema'` ou reiniciar o container `rest`).

O primeiro usuário nasce com perfil **Consulta**; promova-o a Administrador seguindo
`docs/operacao/primeiro-admin.md`.

## Documentação

- Migração pra AWS (runbook): `docs/migracao-aws.md` e `deploy/aws/`
- Regras de negócio do ShopFloor: `docs/regras-de-negocio-shopfloor.md`
- Visão técnica e dívida técnica: `docs/visao-tecnica.md`, `docs/divida-tecnica.md`
- Escalabilidade e performance: `docs/estudo-escalabilidade.md`, `docs/plano-performance-2a-leva.md`
- Specs de design e planos: `docs/superpowers/specs/`, `docs/superpowers/plans/`
- Operação: `docs/operacao/`
- Histórico/handoff da construção: `docs/historico/`
