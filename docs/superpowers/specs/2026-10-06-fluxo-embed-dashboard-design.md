# Fluxo da OP do ShopFloor dentro do Dashboard Enterplak

**Data:** 2026-10-06 · **Status:** aprovado no brainstorming, aguardando revisão do spec

## Objetivo

Cada OP em andamento no ShopFloor vira uma **aba do Dashboard Enterplak** que mostra a tela
**real** "Fluxo da OP" do ShopFloor, embutida (iframe), sem redirecionar o usuário. As abas de OP
se comportam como qualquer outra aba do dashboard: aparecem na barra, entram na rotação automática
(modo slide) e na navegação por setas.

## Decisões tomadas

| Tema | Decisão | Motivo |
|---|---|---|
| Forma | Embutir a tela real do ShopFloor (iframe), não reconstruir | Zero duplicação da lógica (peças vs bipes, minutos úteis, saldo de reprovados); melhorias no ShopFloor chegam sozinhas |
| Identidade | Conta compartilhada `dashboard@enterplak.com.br`, perfil só leitura | O público do dashboard não tem login no ShopFloor |
| Quais OPs | Automático: `status <> 'FINALIZADA'` **e** bipe nos últimos `dias` (provisório: 30) | Hoje ninguém finaliza OP; a finalização automática será implementada no ShopFloor. Depois disso, o dashboard para de mandar `dias` |
| Onde filtra | No ShopFloor (endpoint), com `dias` opcional | Os bipes estão no banco dele |
| Domínio | Dashboard passa a responder em `dashboard.enterplak.com.br` | Mesmo site que `shopfloor.enterplak.com.br` → o navegador envia o cookie de sessão dentro do iframe |
| Sessão | Cookie próprio `sf-embed-auth` com `Path=/embed` | O login do supervisor no ShopFloor (cookie normal) nunca é sobrescrito pela conta compartilhada |

## Arquitetura

```
Navegador
 dashboard.enterplak.com.br (Vercel, estático + funções /api)
   abas: [Compras]…[OP 2340/26][OP 2239/26]…[abas de imagem][Admin]
   └─ iframe → shopfloor.enterplak.com.br/embed/fluxo/<pmo>/<op>

 (1) lista de OPs:  dashboard JS → /api/shopfloor-ops (Vercel)
                    → GET shopfloor/api/dashboard/ops-ativas?dias=30  [Bearer DASHBOARD_API_SECRET]
 (2) SSO:           dashboard JS → /api/shopfloor-sso (Vercel) → JWT 60s
                    → iframe src = shopfloor/embed/sso?token=<jwt>&next=/embed/fluxo/<pmo>/<op>
```

As funções da Vercel só atendem quem está logado no dashboard **e** tem a permissão
`shopfloor_fluxo` (admin/moderador sempre têm).

---

## Parte A — ShopFloor (spec para a IA/equipe do ShopFloor)

Repositório: `RwTech-Automacao/ShopFloor`. Seguir os padrões do projeto (domínio puro testado,
infra, Vitest, migração SQL idempotente).

### A1. Tela embutida `/embed/fluxo/[pmo]/[op]`

- Rota **fora** do grupo `(app)`: sem menu lateral, sem cabeçalho; ocupa 100% da viewport.
- Renderiza o **mesmo** `FluxoForm` de `src/app/(app)/shopfloor/fluxo/`, com a OP pré-selecionada
  e o seletor de OP oculto. Mudança no `FluxoForm`: props opcionais (ex.: `opFixa?: {pmo, op}`,
  `ocultarSeletor?: boolean`). Nada de cópia do componente.
- Gate: `podeNoModulo(perfil, 'shopfloor', 'visualizar')`, igual à tela normal.
- `pmo`/`op` vêm na URL codificados (`encodeURIComponent`; a OP contém `/`). OP inexistente →
  tela simples "OP não encontrada".
- Modo TV, Defeitos, histórico, gráfico: tudo como na tela normal.

### A2. Sessão separada em `/embed`

- Cookie de sessão próprio para a tela embutida: nome `sf-embed-auth` (via `cookieOptions.name`
  do `@supabase/ssr`), `Path=/embed`, `SameSite=Lax`, `Secure`, `HttpOnly` conforme o padrão atual.
- Os dois pontos que criam client autenticado escolhem o cookie pelo caminho da requisição:
  - `src/shared/lib/supabase/middleware.ts` (`updateSession`): se `pathname` começa com `/embed`,
    usa o cookie embed.
  - `src/shared/lib/supabase/server.ts` (`createServerSupabase`): idem. Sugestão: o middleware
    injeta um header de requisição (ex.: `x-sf-embed: 1`) e `createServerSupabase` lê via
    `headers()`. Server Actions disparadas pela tela embutida são POSTs para a própria URL
    `/embed/...`, então passam pelo mesmo caminho.
- Repositórios **não mudam**.
- Sem sessão válida em `/embed/*` (exceto `/embed/sso`): **não** redirecionar para `/login`.
  Responder uma página mínima que envia `postMessage` ao pai (ver A6) e mostra "Conectando…".
- A rota `/embed/*` nunca usa o cookie normal, e as rotas normais nunca usam o cookie embed.

### A3. SSO do dashboard `GET /embed/sso?token=<jwt>&next=<caminho>`

- JWT **HS256** assinado com `DASHBOARD_SSO_SECRET` (segredo **separado** do `RWTECH_SSO_SECRET`).
- Claims obrigatórios:
  - `iss = "enterplak-dashboard"`
  - `aud = "shopfloor-embed"`
  - `email = "dashboard@enterplak.com.br"` — **o ShopFloor só aceita este e-mail deste emissor**
    (constante/variável `DASHBOARD_SSO_EMAIL`); qualquer outro → 403.
  - `jti` (uuid), `iat`, `exp` (≤ 60s).
- Reaproveitar o mecanismo de `entrarPorSso` (validação, `RegistroJti` anti-replay, tolerância de
  relógio, `generateLink` + `verifyOtp`), mas gravando a sessão **no cookie embed**.
- `next` obrigatório e só aceito se for caminho relativo começando com `/embed/` (sem `//`, sem
  esquema, sem `..`). Inválido → 400. Sucesso → `307` para `next` (Location relativo, como o SSO atual).
- Usuário inexistente/inativo/sem perfil → 403 com página simples + `postMessage` de erro.
- Nunca logar a URL/token (mesma regra do SSO atual).
- O middleware deve deixar `/embed/sso` passar sem sessão (como `/sso` hoje).

### A4. Lista de OPs `GET /api/dashboard/ops-ativas?dias=<n>`

- Autenticação: header `Authorization: Bearer <DASHBOARD_API_SECRET>`, comparação em tempo
  constante. Sem/errado → 401. Rota fora do redirect para `/login` no middleware (como as de alertas).
- Consulta com service role, somente leitura.
- Regra: `sf_ordens.status` diferente de `FINALIZADA` (case-insensitive) **e**, se `dias` vier,
  ao menos um registro (bipe) da OP com data ≥ agora − `dias`. `dias` inteiro 1–365; inválido → 400.
- Resposta `200`:

```json
{
  "geradoEm": "2026-10-06T12:00:00Z",
  "ops": [
    { "pmo": "PMOC13", "op": "2340/26", "cliente": "VMI",
      "descricao": "PLACA MONTADA INDICADOR LED CERTIFICADO",
      "ultimoBipe": "2026-10-06T11:42:10Z" }
  ]
}
```

- Ordenada por `ultimoBipe` desc (OPs sem bipe por último). `Cache-Control: no-store`.

### A5. Exibição em iframe

- Rotas `/embed/*`: `Content-Security-Policy: frame-ancestors https://dashboard.enterplak.com.br`
  (lista configurável por env `EMBED_FRAME_ANCESTORS`, para incluir preview/dev quando preciso).
- Demais rotas: `frame-ancestors 'self'` (hoje não há nenhuma proteção contra embutir).

### A6. Mensagens para o dashboard (`window.parent.postMessage`)

Sempre com `targetOrigin` = origem do dashboard (do env), nunca `*`.

| `type` | Quando |
|---|---|
| `sf-embed:ready` | Fluxo carregado |
| `sf-embed:login-required` | Sem sessão embed válida |
| `sf-embed:error` + `code` (`forbidden`, `op-not-found`, `inactive`) | Falhas de acesso/OP |

### A7. Conta e perfil

- Perfil **"Dashboard (somente leitura)"**: apenas `shopfloor: visualizar`.
- Usuário `dashboard@enterplak.com.br`, ativo, com esse perfil, **sem senha utilizável** (entra só
  por SSO). Se já houver `senha_provisoria`, garantir que não trave o fluxo de `/embed`.

### A8. Variáveis de ambiente novas (ShopFloor)

`DASHBOARD_SSO_SECRET`, `DASHBOARD_SSO_EMAIL`, `DASHBOARD_API_SECRET`, `DASHBOARD_ORIGIN`
(`https://dashboard.enterplak.com.br`), `EMBED_FRAME_ANCESTORS`.

### A9. Testes (Vitest)

- Claims: emissor errado, `aud` errado, e-mail diferente do fixo, sem `jti`, expirado, replay.
- `next`: aceita `/embed/fluxo/x/y`; recusa `https://…`, `//evil`, `/home`, `/embed/../home`.
- Escolha de cookie por caminho (`/embed/...` → embed; `/shopfloor/...` → normal).
- Filtro de OPs: FINALIZADA excluída; `dias` respeitado; sem `dias` → todas não finalizadas.
- Endpoint: 401 sem/errado Bearer.

---

## Parte B — Dashboard (este repositório)

### B1. Domínio
- Adicionar `dashboard.enterplak.com.br` no projeto da Vercel; CNAME no DNS de `enterplak.com.br`
  conforme a Vercel indicar. `dashboard-enterplak.vercel.app` continua respondendo (mas o iframe
  só funciona no domínio próprio — cookie mesmo-site).

### B2. Funções Vercel (`/api`, Node)
- `package.json` com `jose` e `@supabase/supabase-js` (sem build do site; continua estático).
- Comum às duas: recebe `Authorization: Bearer <access_token do Supabase do dashboard>`; valida com
  `supabase.auth.getUser(token)`; lê `profiles` (role, active) e `user_page_permissions` com o token
  do próprio usuário (RLS já permite ler o próprio). Autoriza se `active` e (`admin`|`moderador`
  ou possui `shopfloor_fluxo`). Senão 403.
- `GET /api/shopfloor-ops` → chama `SHOPFLOOR_URL/api/dashboard/ops-ativas?dias=30` com
  `DASHBOARD_API_SECRET`; repassa `ops`. `dias` vem de env `SHOPFLOOR_OPS_DIAS` (vazio = não manda).
- `POST /api/shopfloor-sso` body `{ next }` (valida `^/embed/`) → devolve
  `{ url: SHOPFLOOR_URL + "/embed/sso?token=…&next=…" }` com JWT conforme A3.
- Env na Vercel: `SHOPFLOOR_URL`, `DASHBOARD_SSO_SECRET`, `DASHBOARD_API_SECRET`,
  `SHOPFLOOR_OPS_DIAS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

### B3. Permissão
- Linha em `public.pages`: `('shopfloor_fluxo', 'Fluxo ShopFloor', 'fixed', …)`. Aparece no
  painel Admin para marcar por usuário; **não** vira aba por si só (as abas fixas são listadas
  explicitamente em `renderPageTabs`).

### B4. Abas de OP (`index.html`)
- Id da aba: `op:<pmo>:<op>`; rótulo `OP <op>`; `title` = `<cliente> — <descricao>`.
- Posição: depois das abas fixas, antes das abas de imagem. Ordem = a do endpoint.
- Entram em `getPageIds()` → participam da rotação automática e das setas, como as demais.
- `canSeePage('op:…')` = `canSeePage('shopfloor_fluxo')`.
- Carga da lista: no login e junto do `syncPagesFromAPI` (5 min). OP que sumiu e está ativa →
  `switchPage` para a primeira aba permitida (comportamento atual). Falha ao buscar → sem abas de
  OP, resto do dashboard normal, erro no console.
- Botão "Atualizar" na aba de OP: recarrega o iframe.

### B5. Página da OP (iframe)
- **Um iframe por vez**: criado ao entrar na aba, descartado ao sair (evita várias telas
  consultando o ShopFloor a cada 20s em segundo plano).
- `src` inicial: `SHOPFLOOR_URL/embed/fluxo/<pmo>/<op>` (codificados). `allow="fullscreen"`.
- Ouve `message` **só** da origem do ShopFloor:
  - `login-required` → `POST /api/shopfloor-sso` → troca o `src` pela URL de SSO. No máx. 1
    tentativa por carga (evita loop); se falhar, mostra erro.
  - `ready` → esconde o "Carregando…".
  - `error` → card de erro conforme `code`.
- Timeout de 20s sem `ready` → card "Não foi possível carregar o fluxo da OP" + **Tentar novamente**.
- Mensagens de erro: `inactive`/`forbidden` → "Acesso ao ShopFloor desativado. Fale com o
  administrador."; `op-not-found` → "OP não encontrada no ShopFloor."

### B6. Cabeçalhos
- `vercel.json` hoje manda `X-Frame-Options: SAMEORIGIN` — vale só para o dashboard ser embutido,
  não afeta o iframe do ShopFloor. Sem mudança.

---

## Segurança — resumo

- Segredos só em env (Vercel e servidor do ShopFloor), nunca no HTML nem no git.
- Token de SSO: 60s, uso único, e-mail fixo da conta compartilhada → vazamento do segredo não
  permite entrar como outra pessoa; perfil só leitura limita o estrago.
- `next` restrito a `/embed/` → sem open redirect.
- `frame-ancestors` restringe quem pode embutir; `postMessage` com origem verificada nos dois lados.
- Endpoint de OPs exige segredo servidor-a-servidor; o navegador nunca o vê.
- Funções da Vercel conferem login + permissão do dashboard antes de qualquer coisa.

## Ordem de entrega

1. DNS/domínio `dashboard.enterplak.com.br` (B1).
2. Gerar segredos (`openssl rand -base64 48`) e cadastrar nos dois lados.
3. ShopFloor: A1–A9 no ambiente Dev → smoke → Produção.
4. Dashboard: B2–B5. Sem ninguém com `shopfloor_fluxo` além de admin/moderador até o smoke passar.
5. Smoke de ponta a ponta (abaixo) e liberar a permissão aos usuários.

## Critérios de aceite (smoke)

- [ ] Usuário com `shopfloor_fluxo` vê uma aba por OP ativa com bipe ≤ 30 dias; sem a permissão, nenhuma.
- [ ] Abrir a aba mostra o Fluxo real da OP, sem menu do ShopFloor e sem seletor de OP.
- [ ] Supervisor logado no ShopFloor em outra aba continua logado como ele após abrir OPs no dashboard.
- [ ] Rotação automática passa pelas abas de OP; setas funcionam fora do iframe.
- [ ] Modo TV do ShopFloor abre em tela cheia dentro do dashboard.
- [ ] Finalizar uma OP no ShopFloor → a aba some em até 5 min.
- [ ] ShopFloor fora do ar → card de erro com "Tentar novamente"; resto do dashboard funciona.
- [ ] `/embed/fluxo/...` aberto fora de `dashboard.enterplak.com.br` (outro site) é bloqueado.
- [ ] Token de SSO reutilizado → recusado.

## Fora de escopo

- Finalização automática da OP (será feita no ShopFloor, separadamente).
- Ocultar/fixar OPs manualmente no dashboard.
- Login individual (cada pessoa com sua conta no ShopFloor).
- Outras telas do ShopFloor além do Fluxo da OP.
