# Fluxo da OP embutido no Dashboard — plano de implementação (Parte A, lado ShopFloor)

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development.
> Os passos usam caixa (`- [ ]`).

**Objetivo:** o ShopFloor passa a servir a tela "Fluxo da OP" embutida num iframe do Dashboard
Enterplak, com sessão própria (conta compartilhada só-leitura), SSO servidor-a-servidor e um
endpoint que lista as OPs ativas.

**Spec:** `docs/superpowers/specs/2026-10-06-fluxo-embed-dashboard-design.md` — **só a Parte A**.
A Parte B é o outro repositório e **não** se mexe aqui. Leia a Parte A inteira antes de começar.

**Arquitetura:** nada é reconstruído. A tela embutida renderiza o **mesmo** `FluxoForm`; a sessão
embutida é o **mesmo** mecanismo de sessão, só gravado em outro cookie; o SSO é o **mesmo**
`generateLink` + `verifyOtp` que o SSO do Portal já usa.

**Stack:** Next.js 16 (App Router), React 19, TypeScript, Vitest, `jose`, Supabase (self-host).

## Restrições globais

- **Tudo em PT-BR**: identificadores, comentários, mensagens, textos de tela.
- **`--maxWorkers=2` é obrigatório** no vitest desta máquina (4 núcleos; sem isso exit 137).
- **`next build` NÃO roda nesta worktree** (Turbopack recusa `node_modules` symlinkado). A
  verificação é `npx tsc --noEmit` + eslint da pasta.
- **`'use server'` só exporta funções async.** Exportar um **tipo** de um arquivo `'use server'`
  **quebra o `next build` em silêncio** — nem tsc nem eslint avisam. Tipos vão para `domain/`.
- **Nunca logar token, URL com token, query string ou segredo.** O `/sso` atual documenta isso em
  `registrarFalha`; siga a mesma regra. Comparação de segredo em **tempo constante**.
- **`tem_permissao` sempre com 2 argumentos** (`modulo, acao`). A forma de 1 argumento checa
  permissão GLOBAL e anula o RBAC por módulo.
- Migração **idempotente**, corpo de função com `$func$` (o SQL Editor recusa `$$`, inclusive em
  comentário), `notify pgrst, 'reload schema';` no fim.
- **`git add` com caminhos explícitos** — nunca `git add -A` nem `git add .`.
- Commit termina com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Não existe teste de SQL neste projeto.** Lógica nova vai para TypeScript testado.

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `src/modules/auth/domain/sso-dashboard.ts` (**criar**) | `validarClaimsDashboard`, `validarNextEmbed` — puro |
| `src/shared/lib/supabase/embed.ts` (**criar**) | **fonte única** do que é "embed": `PREFIXO_EMBED`, `CABECALHO_EMBED`, `COOKIE_EMBED`, `ehCaminhoEmbed`, `opcoesCookieEmbed` |
| `middleware.ts` | injeta/apaga o cabeçalho embed; não manda `/embed/*` pro `/login` |
| `src/shared/lib/supabase/middleware.ts` | escolhe o cookie pelo caminho |
| `src/shared/lib/supabase/server.ts` | escolhe o cookie pelo cabeçalho |
| `src/modules/auth/application/sso-dashboard.ts` (**criar**) | `entrarPorSsoDashboard` |
| `src/app/embed/sso/route.ts` (**criar**) | `GET /embed/sso?token=&next=` |
| `src/app/embed/fluxo/[pmo]/[op]/page.tsx` (**criar**) | a tela embutida |
| `src/app/embed/embed-ponte.tsx` (**criar**) | o `postMessage` para o pai |
| `src/app/(app)/shopfloor/fluxo/fluxo-form.tsx` | props `opFixa` e `ocultarSeletor` |
| `src/app/api/dashboard/ops-ativas/route.ts` (**criar**) | a lista de OPs |
| `src/modules/shopfloor/domain/ops-ativas.ts` (**criar**) | validação de `dias` + ordenação — puro |
| `next.config.ts` | `frame-ancestors` por rota |
| `supabase/migrations/0139_perfil_dashboard.sql` (**criar**) | o perfil só-leitura |

⚠️ **O número da migração:** a branch `feat/alertas-por-horario` também está usando **0139**. Quem
chegar depois no merge **renumera** para 0140. Confira `ls supabase/migrations/ | tail -3` na hora.

---

### Task 1: Domínio — claims do SSO do dashboard e validação do `next`

**Arquivos:**
- Criar: `src/modules/auth/domain/sso-dashboard.ts`
- Testar: `src/modules/auth/domain/__tests__/sso-dashboard.test.ts`

**Leia primeiro** `src/modules/auth/domain/sso-token.ts`: ele é o irmão desta tarefa (claims do SSO
do Portal) e define o padrão — `{ ok: true; claims } | { ok: false; erro }`, normalização do
e-mail, e o comentário explicando que **assinatura, `exp`, `iss` e `aud` são da biblioteca de JWT**,
não daqui. Siga esse padrão. O `RegistroJti` de lá é **reaproveitado** na Task 3; não duplique.

**Interfaces produzidas:**

```ts
export interface ClaimsDashboard { email: string; jti: string }
export const EMISSOR_DASHBOARD = 'enterplak-dashboard'
export const AUDIENCIA_DASHBOARD = 'shopfloor-embed'

/** Confere o que a biblioteca de JWT não cobre. `emailAceito` vem do env (DASHBOARD_SSO_EMAIL). */
export function validarClaimsDashboard(
  bruto: Record<string, unknown>,
  emailAceito: string,
): { ok: true; claims: ClaimsDashboard } | { ok: false; erro: string }

/** O `next` só pode ser um caminho relativo dentro de /embed/. */
export function validarNextEmbed(valor: unknown): { ok: true; next: string } | { ok: false; erro: string }
```

- [ ] **Passo 1: escrever os testes que falham**

```ts
import { describe, expect, it } from 'vitest'
import { validarClaimsDashboard, validarNextEmbed } from '../sso-dashboard'

const ACEITO = 'dashboard@enterplak.com.br'

describe('validarClaimsDashboard', () => {
  it('aceita os claims da conta compartilhada', () => {
    const r = validarClaimsDashboard({ email: ACEITO, jti: 'abc-123' }, ACEITO)
    expect(r).toEqual({ ok: true, claims: { email: ACEITO, jti: 'abc-123' } })
  })

  it('normaliza o e-mail antes de comparar', () => {
    const r = validarClaimsDashboard({ email: '  DASHBOARD@Enterplak.com.BR ', jti: 'j1' }, ACEITO)
    expect(r.ok && r.claims.email).toBe(ACEITO)
  })

  it('RECUSA qualquer outro e-mail, mesmo válido', () => {
    const r = validarClaimsDashboard({ email: 'gestor@enterplak.com.br', jti: 'j1' }, ACEITO)
    expect(r).toEqual({
      ok: false,
      erro: 'Este emissor só pode entrar com a conta do dashboard.',
    })
  })

  it('recusa sem e-mail', () => {
    expect(validarClaimsDashboard({ jti: 'j1' }, ACEITO).ok).toBe(false)
  })

  it('recusa sem jti: sem ele não há anti-replay', () => {
    expect(validarClaimsDashboard({ email: ACEITO }, ACEITO)).toEqual({
      ok: false,
      erro: 'Token sem identificador (jti).',
    })
    expect(validarClaimsDashboard({ email: ACEITO, jti: '   ' }, ACEITO).ok).toBe(false)
  })

  it('recusa quando o e-mail aceito não está configurado', () => {
    expect(validarClaimsDashboard({ email: ACEITO, jti: 'j1' }, '').ok).toBe(false)
  })
})

describe('validarNextEmbed', () => {
  it('aceita caminho dentro de /embed/', () => {
    expect(validarNextEmbed('/embed/fluxo/PMOC13/2340%2F26')).toEqual({
      ok: true, next: '/embed/fluxo/PMOC13/2340%2F26',
    })
  })

  it('recusa URL absoluta', () => {
    expect(validarNextEmbed('https://evil.com/embed/x')).toEqual({
      ok: false, erro: 'Destino inválido.',
    })
  })

  it('recusa barra dupla (host relativo a esquema)', () => {
    expect(validarNextEmbed('//evil.com/embed/x').ok).toBe(false)
    expect(validarNextEmbed('/\\evil.com').ok).toBe(false)
  })

  it('recusa caminho fora de /embed/', () => {
    expect(validarNextEmbed('/home').ok).toBe(false)
    expect(validarNextEmbed('/shopfloor/fluxo').ok).toBe(false)
    expect(validarNextEmbed('/embedx/fluxo').ok).toBe(false)
  })

  it('recusa travessia de diretório, inclusive codificada', () => {
    for (const ruim of ['/embed/../home', '/embed/..%2Fhome', '/embed/%2e%2e/home', '/embed/a/../../home']) {
      expect(validarNextEmbed(ruim).ok).toBe(false)
    }
  })

  it('recusa ausente, vazio e o que não é string', () => {
    for (const ruim of [null, undefined, '', '   ', 42, {}]) {
      expect(validarNextEmbed(ruim).ok).toBe(false)
    }
  })

  it('recusa caractere de controle e nova linha (resposta partida)', () => {
    expect(validarNextEmbed('/embed/fluxo\r\nSet-Cookie: x=1').ok).toBe(false)
    expect(validarNextEmbed('/embed/fluxo\n').ok).toBe(false)
  })

  it('aceita exatamente /embed/ com algo depois, não /embed sozinho', () => {
    expect(validarNextEmbed('/embed').ok).toBe(false)
    expect(validarNextEmbed('/embed/').ok).toBe(true)
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run src/modules/auth/domain/__tests__/sso-dashboard.test.ts --maxWorkers=2`
Esperado: FAIL, "Failed to resolve import".

- [ ] **Passo 3: implementar**

Pontos obrigatórios:

- **O e-mail é comparado, não só validado.** O emissor `enterplak-dashboard` só pode entrar com a
  conta compartilhada: é isto que faz um segredo vazado não virar acesso como outra pessoa. Compare
  **depois** de normalizar os dois lados (minúsculas, aparado).
- `validarNextEmbed`: decodifique a travessia antes de recusar. A checagem tem que pegar
  `..` **depois** de `decodeURIComponent` (envolvido em try/catch: entrada que não decodifica é
  recusada, não estourada), e recusar qualquer caractere de controle (`/[\u0000-\u001f\u007f]/`).
  Comece recusando o que não é string ou está vazio, depois `//` e `/\`, depois exija
  `startsWith('/embed/')`, e só então a travessia.
- ⚠️ `validarNextEmbed` devolve o `next` **como veio** (ainda codificado), porque é isso que vai no
  `Location`. Não devolva a versão decodificada: a OP tem `/` no nome e precisa continuar escapada.

- [ ] **Passo 4: rodar e ver passar** + `npx tsc --noEmit`
- [ ] **Passo 5: commit**

```bash
git add src/modules/auth/domain/sso-dashboard.ts src/modules/auth/domain/__tests__/sso-dashboard.test.ts
git commit -m "fluxo embed: claims do SSO do dashboard e validação do next"
```

---

### Task 2: O cookie de sessão do `/embed`, numa fonte única

**Arquivos:**
- Criar: `src/shared/lib/supabase/embed.ts`
- Modificar: `middleware.ts` (raiz), `src/shared/lib/supabase/middleware.ts`, `src/shared/lib/supabase/server.ts`
- Testar: `src/shared/lib/supabase/__tests__/embed.test.ts`

**Leia primeiro** os três arquivos que vai modificar, inteiros.

**A decisão de desenho, e por que é assim:** a sessão do `/embed` é a conta compartilhada
só-leitura. Ela **não pode** sobrescrever o cookie do supervisor que está logado no ShopFloor em
outra aba. Então `/embed/*` usa um cookie próprio (`sf-embed-auth`, `Path=/embed`) e as rotas
normais usam o de sempre.

Os **repositórios não mudam**: eles chamam `createServerSupabase()` sem argumento, e são dezenas.
Por isso a escolha é feita por **cabeçalho de requisição** injetado pelo middleware
(`x-sf-embed: 1`), que `createServerSupabase` lê via `headers()`. Server Actions disparadas pela
tela embutida são POSTs para a própria URL `/embed/...`, então passam pelo mesmo caminho.

⚠️ **O cabeçalho é injetado E APAGADO, sempre.** Em caminho que não é `/embed`, o middleware tem
que **remover** `x-sf-embed` da requisição, mesmo que o cliente o tenha mandado. Sem isso, quem
tiver o cookie da conta compartilhada manda o cabeçalho numa rota normal e navega o app inteiro
como a conta do dashboard. É a diferença entre "o cabeçalho diz onde estou" e "o cabeçalho é um
pedido do cliente".

⚠️ **Fonte única.** `PREFIXO_EMBED`, o nome do cookie e as opções ficam **só** em
`supabase/embed.ts`, e os três arquivos importam de lá. Duas partes decidindo "isto é embed?" por
caminhos ligeiramente diferentes é a família de defeito que já custou seis correções neste projeto.

**Interfaces produzidas:**

```ts
export const PREFIXO_EMBED = '/embed'
export const CABECALHO_EMBED = 'x-sf-embed'
export const COOKIE_EMBED = 'sf-embed-auth'
/** `/embed` e tudo abaixo dele. `/embedx` NÃO é embed. */
export function ehCaminhoEmbed(pathname: string): boolean
/** O que vai em `cookieOptions` do createServerClient quando é embed; null quando não é. */
export function opcoesCookieEmbed(ehEmbed: boolean): { name: string; path: string } | undefined
```

- [ ] **Passo 1: escrever os testes que falham**

```ts
import { describe, expect, it } from 'vitest'
import { COOKIE_EMBED, ehCaminhoEmbed, opcoesCookieEmbed } from '../embed'

describe('ehCaminhoEmbed', () => {
  it('reconhece /embed e o que está abaixo', () => {
    for (const p of ['/embed', '/embed/', '/embed/sso', '/embed/fluxo/PMOC13/2340%2F26']) {
      expect(ehCaminhoEmbed(p)).toBe(true)
    }
  })
  it('NÃO confunde com caminho que só começa parecido', () => {
    for (const p of ['/embedx', '/embedded/fluxo', '/home', '/', '/shopfloor/fluxo', '/api/embed']) {
      expect(ehCaminhoEmbed(p)).toBe(false)
    }
  })
})

describe('opcoesCookieEmbed', () => {
  it('no embed devolve o cookie próprio, com Path=/embed', () => {
    expect(opcoesCookieEmbed(true)).toEqual({ name: COOKIE_EMBED, path: '/embed' })
  })
  it('fora do embed não devolve nada: vale o cookie padrão', () => {
    expect(opcoesCookieEmbed(false)).toBeUndefined()
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**
- [ ] **Passo 3: implementar `embed.ts`** e ver os testes passarem
- [ ] **Passo 4: ligar nos três arquivos**

1. **`middleware.ts` (raiz):** antes de chamar `updateSession`, monte os cabeçalhos da requisição:
   com `ehCaminhoEmbed(pathname)` **verdadeiro**, `set(CABECALHO_EMBED, '1')`; **falso**,
   `delete(CABECALHO_EMBED)`. Passe adiante com
   `NextResponse.next({ request: { headers } })`. Mantenha a saída de `ehRotaPublicaDeAlertas` como
   primeira coisa, e **nela também apague o cabeçalho**.
2. **`supabase/middleware.ts` (`updateSession`):** passe `cookieOptions: opcoesCookieEmbed(...)` ao
   `createServerClient`. E no bloco de redirecionamento, **não** mande `/embed/*` pro `/login`:
   - `/embed/sso` passa sem sessão (é ele que cria), como `/sso` já faz;
   - qualquer outro `/embed/*` sem sessão válida **segue adiante** (`return response`) — a página
     responde "Conectando…" e avisa o pai (Task 4). Nunca redirect.
   - `senhaProvisoria` **não** redireciona dentro de `/embed` (a conta compartilhada entra só por
     SSO; um redirect pra `/definir-senha` dentro do iframe travaria o dashboard).
3. **`supabase/server.ts` (`createServerSupabase`):** leia `headers()` e passe
   `cookieOptions: opcoesCookieEmbed(h.get(CABECALHO_EMBED) === '1')`.
   ⚠️ `headers()` é assíncrono no Next 16 — a função já é `async`, então é só `await`.

- [ ] **Passo 5: conferir que nada regrediu**

```bash
npx vitest run src/shared src/modules/auth --maxWorkers=2
npx tsc --noEmit
npx eslint middleware.ts src/shared/lib/supabase
```

⚠️ Responda no relatório, **citando o arquivo e a linha**: (a) onde o cabeçalho é APAGADO em
caminho não-embed? (b) `/embed/*` sem sessão pode cair em `redirectTo` por algum caminho?
(c) `createServerSupabase` continua funcionando igual em rota normal?

- [ ] **Passo 6: commit**

```bash
git add src/shared/lib/supabase/embed.ts src/shared/lib/supabase/__tests__/embed.test.ts src/shared/lib/supabase/middleware.ts src/shared/lib/supabase/server.ts middleware.ts
git commit -m "fluxo embed: cookie de sessão próprio para /embed"
```

---

### Task 3: `GET /embed/sso` — a entrada do dashboard

**Arquivos:**
- Criar: `src/modules/auth/application/sso-dashboard.ts`, `src/app/embed/sso/route.ts`
- Testar: `src/modules/auth/application/__tests__/sso-dashboard.test.ts`

**Interfaces consumidas:** `validarClaimsDashboard`, `validarNextEmbed`, `EMISSOR_DASHBOARD`,
`AUDIENCIA_DASHBOARD` (Task 1); `RegistroJti` de `domain/sso-token.ts`; o cookie embed (Task 2).

**Leia primeiro, e siga como molde:** `src/modules/auth/application/sso-portal.ts` inteiro, e
`src/app/sso/route.ts`. Esta tarefa é o **irmão** deles. O que repete: `jwtVerify` HS256 com
tolerância de relógio, `RegistroJti` com folga **derivada** da tolerância, busca do usuário com
service role, `generateLink` + `verifyOtp`, `Location` **relativo** no 307, e o log que **nunca**
imprime o token.

O que muda:
- segredo `DASHBOARD_SSO_SECRET` (**separado** do `RWTECH_SSO_SECRET`);
- `issuer: EMISSOR_DASHBOARD`, `audience: AUDIENCIA_DASHBOARD`;
- o e-mail tem que ser **exatamente** `DASHBOARD_SSO_EMAIL`;
- a sessão é gravada no **cookie embed** (o `createServerSupabase` já escolhe pelo cabeçalho, e a
  rota está sob `/embed`, então isso sai de graça — **confirme no relatório** que sai mesmo);
- o destino é o `next` validado, não `/home`;
- `exp ≤ 60s`: se o token trouxer `exp` mais longe que 60s do `iat`, **recuse** (a spec exige o
  teto; `jwtVerify` só confere que não expirou).

**Interface produzida:**

```ts
export type ResultadoSsoDashboard =
  | { ok: true; next: string }
  | { ok: false; status: 400 | 401 | 403 | 503; erro: string; codigo: 'forbidden' | 'inactive' | null }
export async function entrarPorSsoDashboard(
  token: string | null, next: string | null,
): Promise<ResultadoSsoDashboard>
```

- [ ] **Passo 1: escrever os testes que falham**

Cubra (A9 da spec): emissor errado · `aud` errado · e-mail diferente do fixo · sem `jti` ·
expirado · **replay (o mesmo token duas vezes)** · `exp` além de 60s · `next` inválido →
400 · usuário inexistente → 403 · usuário inativo → 403 com `codigo: 'inactive'` ·
segredo não configurado → 503 · sucesso → `{ ok: true, next }`.

Mocke `@/shared/lib/supabase/service` e `@/shared/lib/supabase/server`.
⚠️ **Confirme que os mocks pegam** o caminho certo: se o caminho do mock estiver errado, o teste
passa testando nada. Prove com um teste que falha quando o mock devolve erro.

- [ ] **Passo 2: rodar e ver falhar**
- [ ] **Passo 3: implementar a aplicação e a rota**

A rota: `export const dynamic = 'force-dynamic'`; sucesso → `307` com `Location` = o `next`
validado (relativo); falha → **página HTML mínima** (não JSON) que mostra o motivo em PT-BR e
manda `postMessage` de erro pro pai, reaproveitando a ponte da Task 4.

- [ ] **Passo 4: rodar `npx vitest run src/modules/auth --maxWorkers=2` + `tsc` + eslint**
- [ ] **Passo 5: commit**

```bash
git add src/modules/auth/application/sso-dashboard.ts src/modules/auth/application/__tests__/sso-dashboard.test.ts src/app/embed/sso/route.ts
git commit -m "fluxo embed: SSO do dashboard em /embed/sso"
```

---

### Task 4: A tela `/embed/fluxo/[pmo]/[op]` e a ponte com o pai

**Arquivos:**
- Criar: `src/app/embed/layout.tsx`, `src/app/embed/fluxo/[pmo]/[op]/page.tsx`, `src/app/embed/embed-ponte.tsx`
- Modificar: `src/app/(app)/shopfloor/fluxo/fluxo-form.tsx`
- Testar: `src/app/embed/__tests__/fluxo-embed.test.tsx`

**Leia primeiro:** `src/app/(app)/shopfloor/fluxo/page.tsx` (20 linhas — o molde do gate e dos
dados) e `fluxo-form.tsx:430` (`export function FluxoForm({ ops, ordensDashboard })`). Veja como o
estado `sel` codifica a OP escolhida e **pré-selecione** por esse mesmo caminho.

**O que fazer:**

1. `FluxoForm` ganha **duas props opcionais**: `opFixa?: { pmo: string; op: string }` e
   `ocultarSeletor?: boolean`. Com `opFixa`, o estado inicial já é aquela OP e a busca dispara no
   primeiro render; com `ocultarSeletor`, o seletor não é renderizado.
   ⚠️ **Nada de cópia do componente.** E sem as props, o comportamento atual tem que ficar
   **idêntico** — há testes da tela normal que precisam continuar passando sem alteração.
2. `src/app/embed/layout.tsx`: 100% da viewport, **sem** menu lateral e **sem** cabeçalho. Não
   reaproveite o `app-shell`.
3. A página: gate `podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')`; `pmo`/`op` vêm
   codificados na URL (a OP contém `/`) → `decodeURIComponent`; OP inexistente → tela simples
   "OP não encontrada" + `postMessage` `op-not-found`; sem sessão → "Conectando…" +
   `postMessage` `login-required`.
4. `embed-ponte.tsx` (client): manda `window.parent.postMessage({ type, code? }, ORIGEM)` com
   `ORIGEM` = `DASHBOARD_ORIGIN` do env — **nunca `'*'`**. Os tipos são
   `sf-embed:ready` · `sf-embed:login-required` · `sf-embed:error` (+ `code`
   `forbidden`|`op-not-found`|`inactive`).

- [ ] **Passo 1: escrever os testes que falham**

- `FluxoForm` **sem** as props novas: igual a hoje (o seletor aparece, nada pré-selecionado).
- `FluxoForm` com `opFixa` + `ocultarSeletor`: o seletor não aparece e a OP já está escolhida.
- A ponte manda `postMessage` com a origem do env, **nunca** `'*'` — afirme o segundo argumento.
- Sem permissão → não renderiza o fluxo e manda `error`/`forbidden`.

- [ ] **Passo 2: rodar e ver falhar**
- [ ] **Passo 3: implementar**
- [ ] **Passo 4: rodar a suíte do fluxo normal E a nova** (a antiga **não pode** mudar)

```bash
npx vitest run "src/app/(app)/shopfloor/fluxo" src/app/embed --maxWorkers=2
npx tsc --noEmit
```

- [ ] **Passo 5: commit**

---

### Task 5: `GET /api/dashboard/ops-ativas`

**Arquivos:**
- Criar: `src/modules/shopfloor/domain/ops-ativas.ts`, `src/app/api/dashboard/ops-ativas/route.ts`
- Modificar: `src/modules/alertas/domain/rotas.ts` (ou onde fica a lista de rotas públicas do middleware)
- Testar: `src/modules/shopfloor/domain/__tests__/ops-ativas.test.ts`

**Leia primeiro:** `src/app/api/alertas/avaliar/route.ts` (o molde do Bearer + `segredoConfere`,
que já compara em tempo constante) e `src/modules/alertas/domain/rotas.ts`
(`ehRotaPublicaDeAlertas`, a saída do middleware para rota sem sessão).

⚠️ Esta rota **precisa** ficar fora do redirect pro `/login`, igual às dos alertas. Se o nome
`ehRotaPublicaDeAlertas` não couber mais, **renomeie** para algo honesto (ex.: `ehRotaSemSessao`) e
atualize quem usa — melhor renomear do que pôr rota de dashboard dentro de uma função que diz
"alertas".

**Domínio puro a testar:** `validarDias(valor): number | null | 'invalido'` — ausente → `null`
(não filtra), inteiro de 1 a 365 → o número, qualquer outra coisa → `'invalido'` (vira 400).
Cubra: `'30'` · `'1'` · `'365'` · `'0'` · `'366'` · `'abc'` · `'1.5'` · `'-5'` · `''` · ausente.

A rota: Bearer `DASHBOARD_API_SECRET` em tempo constante (401 sem/errado) · service role, só
leitura · `status` diferente de `FINALIZADA` **case-insensitive** · com `dias`, exige bipe
≥ `agora - dias` · ordenado por `ultimoBipe` desc, **OPs sem bipe por último** ·
`Cache-Control: no-store` · corpo exatamente no formato da spec (A4).

- [ ] **Passos 1–5** no mesmo ritmo das tarefas anteriores (teste que falha → implementação →
      suíte verde → `tsc` → eslint → commit)

---

### Task 6: `frame-ancestors` — quem pode embutir

**Arquivos:**
- Modificar: `next.config.ts`
- Testar: `src/shared/lib/__tests__/cabecalhos-embed.test.ts`

⚠️ **Fato a conferir antes de escrever:** a spec afirma que *"hoje não há nenhuma proteção contra
embutir"*. **Não é confiável.** `X-Frame-Options` não aparece em lugar nenhum deste repositório,
o que indica que ele é posto pelo **nginx do servidor** (a revisão de segurança de 21/09 ligou
HSTS, X-Frame e nosniff). `X-Frame-Options` é honrado pelo navegador **independentemente** do
`frame-ancestors` do CSP: se o nginx manda `SAMEORIGIN`, o iframe **não carrega** por mais certo
que esteja o CSP da aplicação.

**Primeiro passo da tarefa é medir**, não codar:

- [ ] **Passo 1: medir o que o servidor manda hoje**

```bash
curl -sSI https://shopfloor.enterplak.com.br/login | grep -iE "x-frame|content-security|strict-transport"
```

Anote a saída **literal** no relatório. Se `X-Frame-Options` aparecer, a tarefa **não se resolve só
no `next.config.ts`**: escreva no relatório o que o nginx precisa mudar (uma exceção de `location
/embed`) e marque como **BLOCKED até o TI**, porque mudança de nginx no servidor de produção não é
feita por subagente.

- [ ] **Passo 2: no `next.config.ts`**, `headers()` com duas regras: `/embed/:path*` recebe
  `Content-Security-Policy: frame-ancestors <EMBED_FRAME_ANCESTORS ou DASHBOARD_ORIGIN>`; todas as
  outras recebem `frame-ancestors 'self'`.
- [ ] **Passo 3: teste** da função que monta o valor do cabeçalho a partir do env (puro): origem
  única, lista com duas, env vazio → `'self'` (fecha, não abre).
- [ ] **Passo 4: `tsc` + eslint + commit**

---

### Task 7: Migração — o perfil "Dashboard (somente leitura)"

**Arquivos:**
- Criar: `supabase/migrations/0139_perfil_dashboard.sql` (**confira o número livre antes**)

**Leia primeiro** a migração que cria perfis e a que define `tem_permissao`, e veja como um perfil
guarda as permissões por módulo. O perfil novo tem **só** `shopfloor: visualizar`.

- [ ] **Passo 1:** `insert ... on conflict do nothing` do perfil, idempotente
- [ ] **Passo 2:** `notify pgrst, 'reload schema';`
- [ ] **Passo 3: conferir a idempotência por leitura** (rodar duas vezes não pode dar erro)
- [ ] **Passo 4: commit**

⚠️ **O usuário `dashboard@enterplak.com.br` NÃO é criado por migração.** Ele precisa existir no
GoTrue (`auth.users`) e em `public.usuarios`, e isso é operação — não vai em SQL versionado. Escreva
o procedimento em `docs/operacao/` e deixe para o Matheus executar.

---

## Depois das tarefas

1. **Revisão de branch inteira** no modelo mais capaz disponível.
2. **Segredos:** `openssl rand -base64 48` para `DASHBOARD_SSO_SECRET` e `DASHBOARD_API_SECRET`.
   Nunca no git, nunca no chat — quem gera e cadastra é o Matheus.
3. **Migração no Dev** → `docker compose restart rest` → criar o usuário do dashboard → smoke.
4. **Smoke:** os critérios de aceite da spec, com atenção especial em *"supervisor logado no
   ShopFloor em outra aba continua logado como ele"* — é o teste do cookie separado, e é o que
   quebra se a Task 2 estiver errada.
5. **Depende do lado do Dashboard (Parte B)** para o teste de ponta a ponta: domínio
   `dashboard.enterplak.com.br` no ar e as funções da Vercel publicadas.
