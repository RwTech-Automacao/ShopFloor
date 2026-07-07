# ShopFloor Enterplak — Plano 1: Fundação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a base técnica do sistema — projeto Next.js configurado, schema completo no Supabase (8 tabelas + RLS + seed), autenticação, RBAC e layout base (login, menu lateral, home) com a identidade Enterplak — resultando em um app autenticado com navegação sensível ao perfil.

**Architecture:** Monólito modular por feature (`src/modules/<feature>/{domain,application,infra}`), com domínio em TypeScript puro (sem Supabase/Next), Server Actions finos e RBAC decidido no banco via RLS lendo flags de `perfis`. Migrations SQL versionadas em `supabase/migrations/`, aplicadas ao projeto Supabase Cloud pela Supabase CLI.

**Tech Stack:** Next.js (App Router) + TypeScript strict, Tailwind CSS + shadcn/ui, Supabase (Postgres/Auth/RLS), Vitest, Supabase CLI.

## Global Constraints

- **Idioma da UI e do código de domínio:** português (identificadores de domínio em pt-BR conforme o spec — ex.: `processos_recebimento`, `pode_finalizar`).
- **Cor primária Enterplak:** `#8D2033`. Logo em `Logo_Docs.png` (raiz do projeto).
- **TypeScript strict** habilitado; sem `any` implícito.
- **RLS obrigatório** em toda tabela; a UI nunca é a única barreira de permissão.
- **Logs imutáveis:** nenhuma tabela de log aceita UPDATE/DELETE (RLS + trigger).
- **Perfis:** Administrador, Supervisor, Recebimento, Consulta (ver matriz na Task 4).
- **Campos de lista** gravam valor-texto (snapshot), não FK.
- **1 processo = 1 material**; status ∈ `aberto|em_conferencia|finalizado|cancelado`.
- Spec de referência: `docs/superpowers/specs/2026-07-07-fundacao-recebimento-design.md`.

---

## Pré-requisitos de ambiente (executar uma vez, exige sudo)

Estes passos preparam a máquina (Linux Mint 22.3). Não são TDD; são setup de sistema.

- [ ] **P1: Instalar Node.js LTS (v20+)**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # espera v20.x
npm --version
```

- [ ] **P2: Instalar a Supabase CLI**

```bash
# via script oficial (não exige sudo se usar ~/.local/bin no PATH); alternativa: npm i -g supabase
curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz -o /tmp/supabase.tar.gz
sudo tar -xzf /tmp/supabase.tar.gz -C /usr/local/bin supabase
supabase --version
```

- [ ] **P3: Obter as chaves do projeto Supabase**

No painel Supabase → Project Settings → API, copiar:
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (secreta, só server-side)
- Em Project Settings → General, anotar o `Reference ID` (para `supabase link`).

Guardar temporariamente; serão gravadas em `.env.local` na Task 2.

---

## Task 1: Scaffold do projeto Next.js + ferramentas

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.eslintrc`, `.prettierrc`, `vitest.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `tailwind.config.ts`, `postcss.config.mjs`, `components.json` (shadcn)
- Test: `src/shared/lib/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: um projeto Next.js executável (`npm run dev`), Vitest configurado (`npm test`), Tailwind com token de cor `enterplak` (`#8D2033`).

- [ ] **Step 1: Criar o app Next.js com TypeScript e Tailwind**

Rodar na raiz do projeto (a pasta já contém `Logo_Docs.png`, a planilha e `docs/`; o create-next-app aceita diretório não-vazio desde que não haja conflito de arquivos gerados):

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor"
npx create-next-app@latest . \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-npm --no-turbopack
```

Responder "Yes" caso pergunte sobre sobrescrever, garantindo que `Logo_Docs.png` e `docs/` permaneçam.

- [ ] **Step 2: Habilitar TypeScript strict**

Editar `tsconfig.json` e garantir em `compilerOptions`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

- [ ] **Step 3: Instalar e configurar Vitest**

```bash
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths @testing-library/react @testing-library/jest-dom jsdom
```

Criar `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
})
```

Criar `vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

Adicionar ao `package.json` em `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Configurar a cor primária Enterplak no Tailwind**

Em `tailwind.config.ts`, dentro de `theme.extend.colors`:

```ts
colors: {
  enterplak: {
    DEFAULT: '#8D2033',
    600: '#8D2033',
    700: '#73182a',
    50: '#f7e9ec',
  },
},
```

- [ ] **Step 5: Instalar shadcn/ui**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button input label card dropdown-menu avatar sonner
```

Quando perguntado a cor base, aceitar o default (ajustaremos via token `enterplak`).

- [ ] **Step 6: Escrever o teste smoke**

Criar `src/shared/lib/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('ambiente de testes', () => {
  it('executa asserções básicas', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 7: Rodar o teste (deve passar) e o build**

```bash
npm test
# Espera: 1 passed
npm run build
# Espera: build concluído sem erros de tipo
```

- [ ] **Step 8: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js + TS strict + Tailwind + shadcn + Vitest"
```

---

## Task 2: Clients Supabase e validação de ambiente

**Files:**
- Create: `.env.local` (não versionado), `.env.example`
- Create: `src/shared/lib/env.ts`
- Create: `src/shared/lib/supabase/browser.ts`, `src/shared/lib/supabase/server.ts`, `src/shared/lib/supabase/service.ts`
- Create: `src/shared/lib/supabase/middleware.ts`
- Create: `middleware.ts` (raiz)
- Test: `src/shared/lib/__tests__/env.test.ts`

**Interfaces:**
- Produces:
  - `env` — objeto tipado com `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
  - `createBrowserSupabase(): SupabaseClient`
  - `createServerSupabase(): Promise<SupabaseClient>` (usa cookies da request, respeita RLS como o usuário logado)
  - `createServiceSupabase(): SupabaseClient` (service role; **somente** em código server confiável)
  - `updateSession(request): NextResponse` (refresh de sessão no middleware)

- [ ] **Step 1: Instalar dependências Supabase**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Criar `.env.example` e `.env.local`**

`.env.example` (versionado):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`.env.local` (NÃO versionado — já ignorado pelo `.gitignore` do Next): preencher com os valores reais da Task P3.

- [ ] **Step 3: Escrever o teste de validação de ambiente**

Criar `src/shared/lib/__tests__/env.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseEnv } from '../env'

describe('parseEnv', () => {
  it('retorna as variáveis quando todas presentes', () => {
    const result = parseEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    })
    expect(result.SUPABASE_URL).toBe('https://x.supabase.co')
    expect(result.SUPABASE_ANON_KEY).toBe('anon')
  })

  it('lança erro quando falta uma variável obrigatória', () => {
    expect(() =>
      parseEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' }),
    ).toThrow(/SUPABASE_ANON_KEY/)
  })
})
```

- [ ] **Step 4: Rodar o teste (deve falhar)**

```bash
npm test -- env
# Espera: FAIL — Cannot find module '../env'
```

- [ ] **Step 5: Implementar `env.ts`**

Criar `src/shared/lib/env.ts`:

```ts
type RawEnv = Record<string, string | undefined>

export interface AppEnv {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

export function parseEnv(raw: RawEnv): AppEnv {
  const url = raw.NEXT_PUBLIC_SUPABASE_URL
  const anon = raw.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = raw.SUPABASE_SERVICE_ROLE_KEY

  const faltando: string[] = []
  if (!url) faltando.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!anon) faltando.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!service) faltando.push('SUPABASE_SERVICE_ROLE_KEY')
  if (faltando.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${faltando.join(', ')}`)
  }

  return {
    SUPABASE_URL: url!,
    SUPABASE_ANON_KEY: anon!,
    SUPABASE_SERVICE_ROLE_KEY: service!,
  }
}

export const env: AppEnv = parseEnv(process.env as RawEnv)
```

> Nota: `parseEnv` recebe o env como parâmetro para ser testável sem depender de `process.env`. O export `env` só é avaliado em runtime do servidor.

- [ ] **Step 6: Rodar o teste (deve passar)**

```bash
npm test -- env
# Espera: 2 passed
```

- [ ] **Step 7: Implementar os três clients**

`src/shared/lib/supabase/browser.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

`src/shared/lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // chamado de Server Component sem resposta mutável — ignorado
          }
        },
      },
    },
  )
}
```

`src/shared/lib/supabase/service.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import { env } from '../env'

/** Client com service role — USAR SOMENTE em código server confiável. Ignora RLS. */
export function createServiceSupabase() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
```

- [ ] **Step 8: Implementar o middleware de sessão**

`src/shared/lib/supabase/middleware.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login')
  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/home'
    return NextResponse.redirect(url)
  }

  return response
}
```

`middleware.ts` (raiz):

```ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/shared/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
}
```

- [ ] **Step 9: Rodar testes e build**

```bash
npm test
npm run build
# Espera: testes verdes; build sem erro de tipos
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: clients Supabase (browser/server/service) + validação de env + middleware de sessão"
```

---

## Task 3: Inicializar Supabase local e vincular ao projeto Cloud

**Files:**
- Create: `supabase/config.toml` (gerado)
- Create: `supabase/migrations/` (vazio, será populado)

**Interfaces:**
- Produces: diretório `supabase/` versionado, CLI vinculada ao projeto Cloud, pronto para `supabase db push`.

- [ ] **Step 1: Inicializar Supabase no projeto**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor"
supabase init
```

- [ ] **Step 2: Vincular ao projeto Cloud**

```bash
supabase login   # abre navegador para autenticar
supabase link --project-ref <REFERENCE_ID_DA_TASK_P3>
```

- [ ] **Step 3: Commit**

```bash
git add supabase/config.toml
git commit -m "chore: inicializa Supabase CLI e vincula ao projeto Cloud"
```

---

## Task 4: Migration — enums, `perfis`, `usuarios`, helpers RBAC e seed

**Files:**
- Create: `supabase/migrations/0001_perfis_usuarios.sql`

**Interfaces:**
- Produces (no banco):
  - tabela `perfis` com flags booleanas de permissão + coluna `sistema`
  - tabela `usuarios` (`id` = `auth.users.id`, `perfil_id`, `nome`, `email`, `ativo`)
  - função `public.tem_permissao(perm text) returns boolean`
  - trigger `handle_new_user` que cria `usuarios` ao criar `auth.users`
  - seed dos 4 perfis base

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/0001_perfis_usuarios.sql`:

```sql
-- ============ PERFIS ============
create table public.perfis (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  pode_visualizar boolean not null default false,
  pode_importar boolean not null default false,
  pode_editar boolean not null default false,
  pode_finalizar boolean not null default false,
  pode_editar_finalizado boolean not null default false,
  pode_excluir boolean not null default false,
  pode_gerar_etiqueta boolean not null default false,
  pode_administrar boolean not null default false,
  sistema boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ USUARIOS ============
create table public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  email text not null,
  perfil_id uuid not null references public.perfis(id),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ SEED DOS PERFIS ============
insert into public.perfis
  (nome, pode_visualizar, pode_importar, pode_editar, pode_finalizar,
   pode_editar_finalizado, pode_excluir, pode_gerar_etiqueta, pode_administrar, sistema)
values
  ('Administrador', true,  true,  true,  true,  true,  true,  true,  true,  true),
  ('Supervisor',    true,  true,  true,  true,  true,  true,  true,  false, true),
  ('Recebimento',   true,  true,  true,  true,  false, false, true,  false, true),
  ('Consulta',      true,  false, false, false, false, false, false, false, true);

-- ============ HELPER RBAC ============
create or replace function public.tem_permissao(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case perm
      when 'visualizar'         then p.pode_visualizar
      when 'importar'           then p.pode_importar
      when 'editar'             then p.pode_editar
      when 'finalizar'          then p.pode_finalizar
      when 'editar_finalizado'  then p.pode_editar_finalizado
      when 'excluir'            then p.pode_excluir
      when 'gerar_etiqueta'     then p.pode_gerar_etiqueta
      when 'administrar'        then p.pode_administrar
      else false
    end
    from public.usuarios u
    join public.perfis p on p.id = u.perfil_id
    where u.id = auth.uid() and u.ativo
  ), false);
$$;

-- ============ TRIGGER: novo auth.user -> usuarios (perfil Consulta) ============
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  perfil_padrao uuid;
begin
  select id into perfil_padrao from public.perfis where nome = 'Consulta' limit 1;
  insert into public.usuarios (id, email, nome, perfil_id)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', ''), perfil_padrao);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ RLS ============
alter table public.perfis enable row level security;
alter table public.usuarios enable row level security;

-- perfis: todos autenticados leem; só quem administra escreve
create policy perfis_select on public.perfis
  for select to authenticated using (true);
create policy perfis_insert on public.perfis
  for insert to authenticated with check (public.tem_permissao('administrar'));
create policy perfis_update on public.perfis
  for update to authenticated using (public.tem_permissao('administrar'));
create policy perfis_delete on public.perfis
  for delete to authenticated using (public.tem_permissao('administrar') and sistema = false);

-- usuarios: o próprio usuário lê a si mesmo; quem administra lê/escreve todos
create policy usuarios_select_self on public.usuarios
  for select to authenticated using (id = auth.uid() or public.tem_permissao('administrar'));
create policy usuarios_insert on public.usuarios
  for insert to authenticated with check (public.tem_permissao('administrar'));
create policy usuarios_update on public.usuarios
  for update to authenticated using (public.tem_permissao('administrar'));
create policy usuarios_delete on public.usuarios
  for delete to authenticated using (public.tem_permissao('administrar'));
```

- [ ] **Step 2: Aplicar a migration ao Cloud**

```bash
supabase db push
# Espera: "Applying migration 0001_perfis_usuarios.sql..." sem erros
```

- [ ] **Step 3: Verificar no banco**

```bash
supabase db remote query "select nome, pode_administrar from public.perfis order by nome;"
# Espera: 4 linhas — Administrador(t), Consulta(f), Recebimento(f), Supervisor(f)
```

Caso `db remote query` não esteja disponível na versão da CLI, verificar pelo SQL Editor do painel Supabase com a mesma query.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_perfis_usuarios.sql
git commit -m "feat(db): perfis, usuarios, helper tem_permissao, trigger de novo usuário e seed"
```

---

## Task 5: Migration — `listas` e `lista_itens`

**Files:**
- Create: `supabase/migrations/0002_listas.sql`

**Interfaces:**
- Produces: tabelas `listas` (chave única) e `lista_itens` (valor, ordem, ativo), com RLS (leitura para autenticados, escrita para `administrar`), e seed das listas base vazias (`tipo`, `resultado`, `tipo_entrega`, `fornecedor`, `comprador`, `atraso`, `critico`, `divergencia`, `amostral`).

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/0002_listas.sql`:

```sql
create table public.listas (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  nome text not null,
  descricao text not null default '',
  sistema boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.lista_itens (
  id uuid primary key default gen_random_uuid(),
  lista_id uuid not null references public.listas(id) on delete cascade,
  valor text not null,
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lista_id, valor)
);

create index lista_itens_lista_id_idx on public.lista_itens(lista_id);

insert into public.listas (chave, nome, sistema) values
  ('tipo',         'Tipo',          true),
  ('resultado',    'Resultado',     true),
  ('tipo_entrega', 'Tipo de Entrega', true),
  ('fornecedor',   'Fornecedor',    true),
  ('comprador',    'Comprador',     true),
  ('atraso',       'Atraso',        true),
  ('critico',      'Crítico?',      true),
  ('divergencia',  'Divergência',   true),
  ('amostral',     'Amostral',      true);

alter table public.listas enable row level security;
alter table public.lista_itens enable row level security;

create policy listas_select on public.listas
  for select to authenticated using (true);
create policy listas_write on public.listas
  for all to authenticated
  using (public.tem_permissao('administrar'))
  with check (public.tem_permissao('administrar'));

create policy lista_itens_select on public.lista_itens
  for select to authenticated using (true);
create policy lista_itens_write on public.lista_itens
  for all to authenticated
  using (public.tem_permissao('administrar'))
  with check (public.tem_permissao('administrar'));
```

- [ ] **Step 2: Aplicar e verificar**

```bash
supabase db push
supabase db remote query "select chave from public.listas order by chave;"
# Espera: 9 chaves
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0002_listas.sql
git commit -m "feat(db): listas e lista_itens configuráveis com RLS e seed"
```

---

## Task 6: Migration — `configuracao_campos` e seed dos 37 campos

**Files:**
- Create: `supabase/migrations/0003_configuracao_campos.sql`

**Interfaces:**
- Produces: tabela `configuracao_campos` (metadados por campo do processo) + seed com os 37 campos (grupo, origem, tipo, obrigatoriedades, ordem).

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/0003_configuracao_campos.sql`:

```sql
create table public.configuracao_campos (
  id uuid primary key default gen_random_uuid(),
  campo text not null unique,
  rotulo text not null,
  grupo text not null check (grupo in ('comercial','material','recebimento','qualidade')),
  tipo text not null default 'texto' check (tipo in ('texto','lista','numero','data')),
  lista_chave text references public.listas(chave),
  origem text not null check (origem in ('comercial','recebimento')),
  obrigatorio_importacao boolean not null default false,
  obrigatorio_finalizacao boolean not null default false,
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- campo, rotulo, grupo, tipo, lista_chave, origem, obrig_imp, obrig_fin, ordem
insert into public.configuracao_campos
  (campo, rotulo, grupo, tipo, lista_chave, origem, obrigatorio_importacao, obrigatorio_finalizacao, ordem) values
  -- Comercial
  ('numero_nf',          'Nº NF',              'comercial', 'texto',  null,          'comercial', false, true,  10),
  ('numero_emb',         'Nº EMB',             'comercial', 'texto',  null,          'comercial', false, false, 20),
  ('di_inpi',            'Nº DI/INPI',         'comercial', 'texto',  null,          'comercial', false, false, 30),
  ('acp_cliente',        'ACP/Cliente',        'comercial', 'texto',  null,          'comercial', false, false, 40),
  ('numero_pedido',      'Nº Pedido',          'comercial', 'texto',  null,          'comercial', true,  true,  50),
  ('data_chegada',       'Data Chegada',       'comercial', 'data',   null,          'comercial', false, true,  60),
  ('data_compra',        'Data Compra',        'comercial', 'data',   null,          'comercial', false, false, 70),
  ('data_prevista',      'Data Prevista',      'comercial', 'data',   null,          'comercial', false, false, 80),
  ('atraso',             'Atraso',             'comercial', 'lista',  'atraso',      'comercial', false, false, 90),
  ('tipo',               'Tipo',               'comercial', 'lista',  'tipo',        'comercial', false, false, 100),
  ('comprador',          'Comprador',          'comercial', 'lista',  'comprador',   'comercial', false, false, 110),
  ('fornecedor',         'Fornecedor',         'comercial', 'lista',  'fornecedor',  'comercial', false, true,  120),
  ('critico',            'Crítico?',           'comercial', 'lista',  'critico',     'comercial', false, false, 130),
  -- Material
  ('codigo_material',    'Código do Material', 'material',  'texto',  null,          'comercial', true,  true,  140),
  ('descricao_material', 'Descrição do Material','material','texto',  null,          'comercial', true,  true,  150),
  ('quantidade_pedido',  'Quantidade no Pedido','material', 'numero', null,          'comercial', true,  true,  160),
  -- Recebimento
  ('quantidade_recebida','Quantidade Recebida','recebimento','numero',null,          'recebimento', false, true, 170),
  ('volumes',            'Volumes',            'recebimento','numero',null,          'recebimento', false, true, 180),
  ('divergencia',        'Divergência',        'recebimento','lista', 'divergencia', 'recebimento', false, false, 190),
  ('responsavel_contagem','Responsável Contagem','recebimento','texto',null,         'recebimento', false, false, 200),
  ('tipo_entrega',       'Tipo de Entrega',    'recebimento','lista', 'tipo_entrega','recebimento', false, false, 210),
  ('amostral',           'Amostral',           'recebimento','lista', 'amostral',    'recebimento', false, false, 220),
  ('part_number_recebido','Part Number Recebido','recebimento','texto',null,         'recebimento', false, false, 230),
  -- Qualidade
  ('inscricoes',         'Inscrições',         'qualidade', 'texto',  null,          'recebimento', false, false, 240),
  ('fabricante',         'Fabricante',         'qualidade', 'texto',  null,          'recebimento', false, false, 250),
  ('medida_eletrica',    'Medida Elétrica',    'qualidade', 'texto',  null,          'recebimento', false, false, 260),
  ('coloracao',          'Coloração',          'qualidade', 'texto',  null,          'recebimento', false, false, 270),
  ('dimensional',        'Dimensional',        'qualidade', 'texto',  null,          'recebimento', false, false, 280),
  ('impressoes',         'Impressões',         'qualidade', 'texto',  null,          'recebimento', false, false, 290),
  ('data_validade',      'Data de Validade',   'qualidade', 'data',   null,          'recebimento', false, false, 300),
  ('revisao',            'Revisão',            'qualidade', 'texto',  null,          'recebimento', false, false, 310),
  ('material',           'Material',           'qualidade', 'texto',  null,          'recebimento', false, false, 320),
  ('resultado',          'Resultado',          'qualidade', 'lista',  'resultado',   'recebimento', false, true,  330),
  ('quantidade_reprovada','Quantidade Reprovada','qualidade','numero',null,          'recebimento', false, false, 340),
  ('motivo_reprovacao',  'Motivo da Reprovação','qualidade','texto',  null,          'recebimento', false, false, 350),
  ('rnc',                'RNC',                'qualidade', 'texto',  null,          'recebimento', false, false, 360),
  ('rac',                'RAC',                'qualidade', 'texto',  null,          'recebimento', false, false, 370),
  ('observacao',         'Observação',         'qualidade', 'texto',  null,          'recebimento', false, false, 380);

alter table public.configuracao_campos enable row level security;
create policy config_campos_select on public.configuracao_campos
  for select to authenticated using (true);
create policy config_campos_write on public.configuracao_campos
  for all to authenticated
  using (public.tem_permissao('administrar'))
  with check (public.tem_permissao('administrar'));
```

- [ ] **Step 2: Aplicar e verificar a contagem**

```bash
supabase db push
supabase db remote query "select count(*) from public.configuracao_campos;"
# Espera: 38 (13 comercial + 3 material + 7 recebimento + 15 qualidade)
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_configuracao_campos.sql
git commit -m "feat(db): configuracao_campos com seed dos campos do processo"
```

---

## Task 7: Migration — `importacoes` e `processos_recebimento`

**Files:**
- Create: `supabase/migrations/0004_importacoes_processos.sql`

**Interfaces:**
- Produces: tabelas `importacoes` e `processos_recebimento` (todas as colunas do spec 4.5), sequência `numero`, `updated_at` trigger e RLS por permissão (incluindo bloqueio de edição de finalizados exceto `editar_finalizado`).

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/0004_importacoes_processos.sql`:

```sql
-- trigger utilitário de updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ============ IMPORTACOES ============
create table public.importacoes (
  id uuid primary key default gen_random_uuid(),
  arquivo_nome text not null,
  formato text not null check (formato in ('xlsx','csv')),
  total_linhas int not null default 0,
  total_processos_criados int not null default 0,
  mapeamento jsonb not null default '{}'::jsonb,
  usuario_id uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

-- ============ PROCESSOS ============
create sequence public.processos_numero_seq;

create table public.processos_recebimento (
  id uuid primary key default gen_random_uuid(),
  numero bigint not null default nextval('public.processos_numero_seq') unique,
  importacao_id uuid references public.importacoes(id),
  status text not null default 'aberto'
    check (status in ('aberto','em_conferencia','finalizado','cancelado')),
  -- comercial
  numero_nf text, numero_emb text, di_inpi text, acp_cliente text, numero_pedido text,
  data_chegada date, data_compra date, data_prevista date,
  atraso text, tipo text, comprador text, fornecedor text, critico text,
  -- material
  codigo_material text, descricao_material text, quantidade_pedido numeric,
  -- recebimento
  quantidade_recebida numeric, volumes integer, divergencia text,
  responsavel_contagem text, tipo_entrega text, amostral text, part_number_recebido text,
  -- qualidade
  inscricoes text, fabricante text, medida_eletrica text, coloracao text,
  dimensional text, impressoes text, data_validade date, revisao text, material text,
  resultado text, quantidade_reprovada numeric, motivo_reprovacao text,
  rnc text, rac text, observacao text,
  -- auditoria
  criado_por uuid references public.usuarios(id),
  atualizado_por uuid references public.usuarios(id),
  finalizado_por uuid references public.usuarios(id),
  finalizado_em timestamptz,
  cancelado_por uuid references public.usuarios(id),
  motivo_cancelamento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index processos_status_idx on public.processos_recebimento(status);
create index processos_importacao_idx on public.processos_recebimento(importacao_id);

create trigger processos_updated_at
  before update on public.processos_recebimento
  for each row execute function public.set_updated_at();

-- ============ RLS ============
alter table public.importacoes enable row level security;
alter table public.processos_recebimento enable row level security;

create policy importacoes_select on public.importacoes
  for select to authenticated using (public.tem_permissao('visualizar'));
create policy importacoes_insert on public.importacoes
  for insert to authenticated with check (public.tem_permissao('importar'));

create policy processos_select on public.processos_recebimento
  for select to authenticated using (public.tem_permissao('visualizar'));

create policy processos_insert on public.processos_recebimento
  for insert to authenticated with check (public.tem_permissao('importar') or public.tem_permissao('editar'));

-- update: precisa de 'editar'; se o registro está finalizado, precisa de 'editar_finalizado'
create policy processos_update on public.processos_recebimento
  for update to authenticated
  using (
    public.tem_permissao('editar')
    and (status <> 'finalizado' or public.tem_permissao('editar_finalizado'))
  )
  with check (
    public.tem_permissao('editar')
    and (status <> 'finalizado' or public.tem_permissao('editar_finalizado'))
  );

create policy processos_delete on public.processos_recebimento
  for delete to authenticated using (public.tem_permissao('excluir'));
```

- [ ] **Step 2: Aplicar e verificar**

```bash
supabase db push
supabase db remote query "select count(*) from information_schema.columns where table_name='processos_recebimento';"
# Espera: > 45 colunas
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_importacoes_processos.sql
git commit -m "feat(db): importacoes e processos_recebimento com RLS e ciclo de vida"
```

---

## Task 8: Migration — `logs` imutáveis

**Files:**
- Create: `supabase/migrations/0005_logs.sql`

**Interfaces:**
- Produces: tabela `logs` append-only (RLS: insert por autenticados, select por `visualizar`; UPDATE/DELETE bloqueados por trigger para todos, inclusive service role).

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/0005_logs.sql`:

```sql
create table public.logs (
  id uuid primary key default gen_random_uuid(),
  entidade text not null,
  entidade_id uuid,
  acao text not null check (acao in
    ('criar','importar','alterar_campo','mudar_status','gerar_etiqueta','excluir','login')),
  descricao text not null default '',
  dados jsonb not null default '{}'::jsonb,
  usuario_id uuid references public.usuarios(id),
  usuario_nome text not null default '',
  created_at timestamptz not null default now()
);

create index logs_entidade_idx on public.logs(entidade, entidade_id);
create index logs_created_at_idx on public.logs(created_at desc);

-- imutabilidade: bloqueia UPDATE/DELETE para QUALQUER papel (inclusive service_role)
create or replace function public.prevent_log_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Logs são imutáveis e não podem ser alterados ou removidos';
end; $$;

create trigger logs_no_update
  before update on public.logs
  for each row execute function public.prevent_log_mutation();
create trigger logs_no_delete
  before delete on public.logs
  for each row execute function public.prevent_log_mutation();

alter table public.logs enable row level security;
create policy logs_select on public.logs
  for select to authenticated using (public.tem_permissao('visualizar'));
create policy logs_insert on public.logs
  for insert to authenticated with check (true);
-- sem policies de update/delete => negados por RLS; o trigger reforça mesmo para service_role
```

- [ ] **Step 2: Aplicar e verificar a imutabilidade**

```bash
supabase db push
supabase db remote query "insert into public.logs (entidade, acao, descricao) values ('teste','login','x') returning id;"
# copie o id retornado e tente atualizar:
supabase db remote query "update public.logs set descricao='y' where entidade='teste';"
# Espera: ERROR — "Logs são imutáveis..."
supabase db remote query "delete from public.logs where entidade='teste';"
# Espera: ERROR — "Logs são imutáveis..."
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_logs.sql
git commit -m "feat(db): tabela de logs append-only com imutabilidade garantida por trigger"
```

---

## Task 9: Domínio de perfis e permissões (TS puro)

**Files:**
- Create: `src/modules/auth/domain/perfil.ts`
- Test: `src/modules/auth/domain/__tests__/perfil.test.ts`

**Interfaces:**
- Produces:
  - `type Permissao = 'visualizar' | 'importar' | 'editar' | 'finalizar' | 'editar_finalizado' | 'excluir' | 'gerar_etiqueta' | 'administrar'`
  - `interface Perfil { id: string; nome: string; permissoes: Record<Permissao, boolean>; sistema: boolean }`
  - `function podeFazer(perfil: Perfil | null, acao: Permissao): boolean`

- [ ] **Step 1: Escrever o teste**

Criar `src/modules/auth/domain/__tests__/perfil.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { podeFazer, type Perfil } from '../perfil'

const consulta: Perfil = {
  id: '1',
  nome: 'Consulta',
  sistema: true,
  permissoes: {
    visualizar: true, importar: false, editar: false, finalizar: false,
    editar_finalizado: false, excluir: false, gerar_etiqueta: false, administrar: false,
  },
}

describe('podeFazer', () => {
  it('retorna true para permissão concedida', () => {
    expect(podeFazer(consulta, 'visualizar')).toBe(true)
  })
  it('retorna false para permissão negada', () => {
    expect(podeFazer(consulta, 'importar')).toBe(false)
  })
  it('retorna false quando o perfil é nulo', () => {
    expect(podeFazer(null, 'visualizar')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

```bash
npm test -- perfil
# Espera: FAIL — Cannot find module '../perfil'
```

- [ ] **Step 3: Implementar**

Criar `src/modules/auth/domain/perfil.ts`:

```ts
export type Permissao =
  | 'visualizar'
  | 'importar'
  | 'editar'
  | 'finalizar'
  | 'editar_finalizado'
  | 'excluir'
  | 'gerar_etiqueta'
  | 'administrar'

export interface Perfil {
  id: string
  nome: string
  permissoes: Record<Permissao, boolean>
  sistema: boolean
}

export function podeFazer(perfil: Perfil | null, acao: Permissao): boolean {
  if (!perfil) return false
  return perfil.permissoes[acao] === true
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

```bash
npm test -- perfil
# Espera: 3 passed
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/domain/
git commit -m "feat(auth): domínio de perfil e verificação de permissão (TS puro, testado)"
```

---

## Task 10: Sessão do usuário e mapeamento perfil (application/infra)

**Files:**
- Create: `src/modules/auth/infra/usuario-repository.ts`
- Create: `src/modules/auth/application/get-sessao.ts`
- Create: `src/modules/auth/application/__tests__/mapear-perfil.test.ts`
- Create: `src/modules/auth/domain/mapear-perfil.ts`

**Interfaces:**
- Consumes: `Perfil`, `Permissao` (Task 9); `createServerSupabase` (Task 2).
- Produces:
  - `mapearPerfil(row): Perfil` — converte a linha da tabela `perfis` no tipo de domínio.
  - `interface Sessao { usuarioId: string; nome: string; email: string; perfil: Perfil }`
  - `getSessao(): Promise<Sessao | null>` — lê o usuário autenticado + seu perfil.

- [ ] **Step 1: Escrever o teste de mapeamento**

Criar `src/modules/auth/application/__tests__/mapear-perfil.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapearPerfil } from '../../domain/mapear-perfil'

describe('mapearPerfil', () => {
  it('converte a linha do banco no tipo de domínio', () => {
    const perfil = mapearPerfil({
      id: 'p1',
      nome: 'Recebimento',
      pode_visualizar: true,
      pode_importar: true,
      pode_editar: true,
      pode_finalizar: true,
      pode_editar_finalizado: false,
      pode_excluir: false,
      pode_gerar_etiqueta: true,
      pode_administrar: false,
      sistema: true,
    })
    expect(perfil.nome).toBe('Recebimento')
    expect(perfil.permissoes.finalizar).toBe(true)
    expect(perfil.permissoes.administrar).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

```bash
npm test -- mapear-perfil
# Espera: FAIL — Cannot find module
```

- [ ] **Step 3: Implementar `mapear-perfil.ts`**

Criar `src/modules/auth/domain/mapear-perfil.ts`:

```ts
import type { Perfil } from './perfil'

export interface PerfilRow {
  id: string
  nome: string
  pode_visualizar: boolean
  pode_importar: boolean
  pode_editar: boolean
  pode_finalizar: boolean
  pode_editar_finalizado: boolean
  pode_excluir: boolean
  pode_gerar_etiqueta: boolean
  pode_administrar: boolean
  sistema: boolean
}

export function mapearPerfil(row: PerfilRow): Perfil {
  return {
    id: row.id,
    nome: row.nome,
    sistema: row.sistema,
    permissoes: {
      visualizar: row.pode_visualizar,
      importar: row.pode_importar,
      editar: row.pode_editar,
      finalizar: row.pode_finalizar,
      editar_finalizado: row.pode_editar_finalizado,
      excluir: row.pode_excluir,
      gerar_etiqueta: row.pode_gerar_etiqueta,
      administrar: row.pode_administrar,
    },
  }
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

```bash
npm test -- mapear-perfil
# Espera: 1 passed
```

- [ ] **Step 5: Implementar repository e getSessao**

Criar `src/modules/auth/infra/usuario-repository.ts`:

```ts
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { mapearPerfil, type PerfilRow } from '../domain/mapear-perfil'
import type { Perfil } from '../domain/perfil'

export interface UsuarioComPerfil {
  usuarioId: string
  nome: string
  email: string
  perfil: Perfil
}

export async function buscarUsuarioAutenticado(): Promise<UsuarioComPerfil | null> {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nome, email, ativo, perfis(*)')
    .eq('id', user.id)
    .single()

  if (error || !data || !data.ativo || !data.perfis) return null

  return {
    usuarioId: data.id,
    nome: data.nome,
    email: data.email,
    perfil: mapearPerfil(data.perfis as unknown as PerfilRow),
  }
}
```

Criar `src/modules/auth/application/get-sessao.ts`:

```ts
import { buscarUsuarioAutenticado } from '../infra/usuario-repository'
import type { Perfil } from '../domain/perfil'

export interface Sessao {
  usuarioId: string
  nome: string
  email: string
  perfil: Perfil
}

export async function getSessao(): Promise<Sessao | null> {
  return buscarUsuarioAutenticado()
}
```

- [ ] **Step 6: Rodar testes e build**

```bash
npm test
npm run build
# Espera: verdes
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/auth/
git commit -m "feat(auth): mapeamento de perfil + carregamento da sessão do usuário"
```

---

## Task 11: Página de login e Server Actions de autenticação

**Files:**
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/login/login-form.tsx`
- Create: `src/modules/auth/application/actions.ts`
- Create: `src/app/(auth)/layout.tsx`

**Interfaces:**
- Consumes: `createServerSupabase` (Task 2).
- Produces:
  - Server Action `entrar(formData): Promise<{ erro?: string }>`
  - Server Action `sair(): Promise<void>`
  - rota `/login` funcional (design com painel lateral vinho e logo, conforme mockup).

- [ ] **Step 1: Implementar as Server Actions**

Criar `src/modules/auth/application/actions.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export async function entrar(
  _prev: { erro?: string } | undefined,
  formData: FormData,
): Promise<{ erro?: string }> {
  const email = String(formData.get('email') ?? '')
  const senha = String(formData.get('senha') ?? '')

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
  if (error) {
    return { erro: 'Usuário ou senha inválidos.' }
  }
  redirect('/home')
}

export async function sair(): Promise<void> {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  redirect('/login')
}
```

- [ ] **Step 2: Implementar o formulário (client component)**

Criar `src/app/(auth)/login/login-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { entrar } from '@/modules/auth/application/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginForm() {
  const [state, formAction, pending] = useActionState(entrar, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Usuário</Label>
        <Input id="email" name="email" type="email" placeholder="Digite seu usuário" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="senha">Senha</Label>
        <Input id="senha" name="senha" type="password" placeholder="Digite sua senha" required />
      </div>
      {state?.erro && <p className="text-sm text-red-600">{state.erro}</p>}
      <Button type="submit" disabled={pending} className="bg-enterplak hover:bg-enterplak-700">
        {pending ? 'Entrando...' : 'Entrar'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Implementar a página e o layout de auth**

Criar `src/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen">{children}</div>
}
```

Criar `src/app/(auth)/login/page.tsx`:

```tsx
import Image from 'next/image'
import { LoginForm } from './login-form'

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden items-center justify-center bg-enterplak p-12 lg:flex">
        <div className="text-center">
          <Image src="/Logo_Docs.png" alt="Enterplak" width={320} height={110} priority
            className="mx-auto brightness-0 invert" />
          <p className="mt-6 text-lg text-white/90">Sistema de Gestão Shop Floor</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold">Acesse sua conta</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Informe suas credenciais para entrar no sistema
          </p>
          <LoginForm />
          <p className="mt-8 text-center text-xs text-muted-foreground">Versão 1.0.0</p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Copiar a logo para `public/`**

```bash
cp "Logo_Docs.png" public/Logo_Docs.png
```

- [ ] **Step 5: Verificar manualmente**

```bash
npm run dev
```

Abrir `http://localhost:3000` → deve redirecionar para `/login` e exibir o painel vinho com a logo e o formulário. Testar login com um usuário criado no painel Supabase (Authentication → Users → Add user). Login válido → redireciona para `/home` (ainda 404 até a Task 12).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): página de login com identidade Enterplak e ações entrar/sair"
```

---

## Task 12: Layout autenticado — menu lateral (por perfil), header e home

**Files:**
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/home/page.tsx`
- Create: `src/shared/ui/sidebar.tsx`
- Create: `src/shared/ui/nav-config.ts`
- Create: `src/shared/ui/user-menu.tsx`
- Test: `src/shared/ui/__tests__/nav-config.test.ts`

**Interfaces:**
- Consumes: `getSessao` (Task 10), `podeFazer` (Task 9), `sair` (Task 11).
- Produces: shell autenticado com menu lateral filtrado por permissão, header e página inicial de boas-vindas.

- [ ] **Step 1: Escrever o teste de filtragem do menu**

Criar `src/shared/ui/__tests__/nav-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { itensVisiveis, NAV_ITENS } from '../nav-config'
import type { Perfil } from '@/modules/auth/domain/perfil'

const perfil = (over: Partial<Perfil['permissoes']>): Perfil => ({
  id: 'x', nome: 'T', sistema: false,
  permissoes: {
    visualizar: true, importar: false, editar: false, finalizar: false,
    editar_finalizado: false, excluir: false, gerar_etiqueta: false, administrar: false,
    ...over,
  },
})

describe('itensVisiveis', () => {
  it('mostra Configurações apenas para quem administra', () => {
    const semAdmin = itensVisiveis(NAV_ITENS, perfil({}))
    const comAdmin = itensVisiveis(NAV_ITENS, perfil({ administrar: true }))
    expect(semAdmin.some((i) => i.chave === 'configuracoes')).toBe(false)
    expect(comAdmin.some((i) => i.chave === 'configuracoes')).toBe(true)
  })

  it('sempre mostra Recebimento para quem visualiza', () => {
    expect(itensVisiveis(NAV_ITENS, perfil({})).some((i) => i.chave === 'recebimento')).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

```bash
npm test -- nav-config
# Espera: FAIL — Cannot find module '../nav-config'
```

- [ ] **Step 3: Implementar `nav-config.ts`**

Criar `src/shared/ui/nav-config.ts`:

```ts
import { podeFazer, type Perfil, type Permissao } from '@/modules/auth/domain/perfil'

export interface NavItem {
  chave: string
  rotulo: string
  href: string
  permissao: Permissao
}

export const NAV_ITENS: NavItem[] = [
  { chave: 'home', rotulo: 'Home', href: '/home', permissao: 'visualizar' },
  { chave: 'recebimento', rotulo: 'Recebimento', href: '/recebimento/processos', permissao: 'visualizar' },
  { chave: 'configuracoes', rotulo: 'Configurações', href: '/configuracoes/usuarios', permissao: 'administrar' },
]

export function itensVisiveis(itens: NavItem[], perfil: Perfil | null): NavItem[] {
  return itens.filter((i) => podeFazer(perfil, i.permissao))
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

```bash
npm test -- nav-config
# Espera: 2 passed
```

- [ ] **Step 5: Implementar sidebar, user-menu e layout**

Criar `src/shared/ui/user-menu.tsx`:

```tsx
'use client'

import { sair } from '@/modules/auth/application/actions'
import { Button } from '@/components/ui/button'

export function UserMenu({ nome, perfil }: { nome: string; perfil: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-sm font-medium">{nome}</p>
        <p className="text-xs text-muted-foreground">{perfil}</p>
      </div>
      <form action={sair}>
        <Button variant="ghost" size="sm" type="submit">Sair</Button>
      </form>
    </div>
  )
}
```

Criar `src/shared/ui/sidebar.tsx`:

```tsx
import Link from 'next/link'
import Image from 'next/image'
import { itensVisiveis, NAV_ITENS } from './nav-config'
import type { Perfil } from '@/modules/auth/domain/perfil'

export function Sidebar({ perfil }: { perfil: Perfil }) {
  const itens = itensVisiveis(NAV_ITENS, perfil)
  return (
    <aside className="flex w-64 flex-col border-r bg-white">
      <div className="p-6">
        <Image src="/Logo_Docs.png" alt="Enterplak" width={140} height={48} />
      </div>
      <nav className="flex flex-col gap-1 px-3">
        {itens.map((i) => (
          <Link key={i.chave} href={i.href}
            className="rounded-md px-3 py-2 text-sm hover:bg-enterplak-50 hover:text-enterplak">
            {i.rotulo}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
```

Criar `src/app/(app)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { Sidebar } from '@/shared/ui/sidebar'
import { UserMenu } from '@/shared/ui/user-menu'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao()
  if (!sessao) redirect('/login')

  return (
    <div className="flex min-h-screen">
      <Sidebar perfil={sessao.perfil} />
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-end border-b bg-white px-6">
          <UserMenu nome={sessao.nome} perfil={sessao.perfil.nome} />
        </header>
        <main className="flex-1 bg-gray-50 p-8">{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Implementar a home**

Criar `src/app/(app)/home/page.tsx`:

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'

export default async function HomePage() {
  const sessao = await getSessao()
  return (
    <div>
      <h1 className="text-2xl font-semibold">
        Bem-vindo, {sessao?.nome || sessao?.email} 👋
      </h1>
      <p className="mt-2 text-muted-foreground">Selecione uma opção para começar</p>
    </div>
  )
}
```

- [ ] **Step 7: Verificar manualmente o RBAC**

```bash
npm run dev
```

- Logar com um usuário **Consulta** (perfil padrão): a sidebar mostra Home e Recebimento, **sem** Configurações.
- No painel Supabase, alterar `usuarios.perfil_id` desse usuário para o id do perfil **Administrador** e recarregar: Configurações aparece. Isso valida o RBAC ponta a ponta.

- [ ] **Step 8: Rodar toda a suíte e o build**

```bash
npm test
npm run build
# Espera: todos os testes verdes; build limpo
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: layout autenticado com menu lateral por perfil, header e home"
```

---

## Task 13: Bootstrap do primeiro Administrador (documentação operacional)

**Files:**
- Create: `docs/operacao/primeiro-admin.md`

**Interfaces:**
- Produces: procedimento para promover o primeiro usuário a Administrador (o trigger cria todos como Consulta).

- [ ] **Step 1: Documentar o procedimento**

Criar `docs/operacao/primeiro-admin.md`:

```markdown
# Promover o primeiro Administrador

Todo novo usuário criado no Supabase Auth nasce com o perfil **Consulta**
(trigger `on_auth_user_created`). Para promover o primeiro Administrador,
rode uma vez no SQL Editor do Supabase:

​```sql
update public.usuarios
set perfil_id = (select id from public.perfis where nome = 'Administrador')
where email = 'EMAIL_DO_ADMIN';
​```

A partir daí, esse Administrador gerencia os demais usuários pela própria
interface (módulo Configurações › Usuários — Plano 2).
```

- [ ] **Step 2: Commit**

```bash
git add docs/operacao/primeiro-admin.md
git commit -m "docs: procedimento de bootstrap do primeiro administrador"
```

---

## Self-Review (executado pelo autor do plano)

**1. Cobertura do spec (Fundação):**
- Auth Supabase → Tasks 2, 11 ✅
- RBAC configurável (flags em `perfis`, RLS lê flags) → Tasks 4, 9, 10, 12 ✅
- Layout base (login, menu lateral, home) com identidade Enterplak → Tasks 11, 12 ✅
- Schema completo (perfis, usuarios, listas, lista_itens, configuracao_campos, importacoes, processos_recebimento, logs) → Tasks 4–8 ✅
- Logs imutáveis (RLS + trigger) → Task 8 ✅
- Listas configuráveis (estrutura + seed) → Task 5 ✅
- `configuracao_campos` (obrigatoriedade + tipo configuráveis; 37 campos) → Task 6 ✅
- Três clients Supabase (browser/server/service) → Task 2 ✅
- Separação de camadas (domain/application/infra) → Tasks 9, 10 ✅
- Telas de CRUD de Configurações e fluxo de Recebimento → **fora do Plano 1** (Planos 2 e 3) — intencional.

**2. Placeholders:** nenhum "TBD/TODO/etc." — todo passo traz código/SQL/comando reais.

**3. Consistência de tipos:** `Permissao`, `Perfil`, `mapearPerfil`, `getSessao`, `podeFazer`, `itensVisiveis`, `NAV_ITENS` usados de forma idêntica entre tasks 9–12. Flags de `perfis` (SQL) ↔ chaves de `permissoes` (TS) ↔ argumentos de `tem_permissao` (SQL) alinhados: visualizar, importar, editar, finalizar, editar_finalizado, excluir, gerar_etiqueta, administrar.

**Observação de contagem:** o seed da Task 6 tem 38 linhas (o spec resume como "15 Comercial + 22 Recebimento = 37" agrupando código+descrição como material; a diferença é apenas de categorização — os campos batem com a seção 4.5 do spec). A verificação da Task 6 espera 38.
