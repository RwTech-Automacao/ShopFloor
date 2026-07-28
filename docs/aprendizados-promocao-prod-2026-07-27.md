# Promoção pro Prod + Aprendizados — 2026-07-27

> Guia de estudo da sessão em que promovemos o **módulo ShopFloor + RBAC por módulo** pro
> Produção. Três partes: (1) **cada comando** que você rodou no terminal, explicado; (2) **resumo
> técnico** do que fizemos; (3) **aprendizados/conceitos** pra levar pra vida.

---

## Parte 1 — Os comandos que você rodou (explicados)

### 1.1 Backup do Prod (antes de qualquer migração)

```bash
pg_dump -Fc "postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres" \
  -f prod_backup_20260727_1423.dump
```
- **`pg_dump`**: ferramenta oficial do Postgres que tira uma "foto" completa do banco (schema + dados).
- **`-Fc`**: formato **c**ustom (comprimido, restaurável seletivamente com `pg_restore`). É o melhor formato pra backup/restore.
- **`-f arquivo`**: escreve no arquivo em vez da tela.
- A **connection string** aponta pro **Session pooler** (ver aprendizado 3.1), porta **5432**.

```bash
pg_restore -l prod_backup_20260727_1423.dump | grep -c "TABLE DATA"
```
- **`pg_restore -l`**: **l**ista o conteúdo do dump (não restaura). Serve pra **verificar** que o backup tem o que esperávamos.
- **`| grep -c "TABLE DATA"`**: conta quantas tabelas com dados o dump tem (deu **49**). É a prova de que o backup não saiu vazio.

```bash
rm -f prod_backup_20260727_1419.dump
```
- Removeu um dump **duplicado** (dois foram gerados por engano). `-f` = não reclama se não existir.

### 1.2 Variável de ambiente com o segredo (fica só no seu terminal)

```bash
export PROD='postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres'
```
- **`export`**: cria uma variável de ambiente `PROD` que os comandos seguintes usam como `"$PROD"`.
- **Por que fazer isso:** o segredo (senha do banco) **nunca aparece no comando** que você cola no chat — fica só na sua sessão de terminal. Regra de ouro: **segredo de Prod não entra no chat.**
- ⚠️ O `export` **não sobrevive** a fechar o terminal — se abrir outro, tem que re-exportar.

```bash
echo "${PROD:+ESTA_SETADA}"
```
- Truque pra **checar se a variável está setada sem imprimir o valor** (o segredo). `${VAR:+texto}` imprime `texto` só se `VAR` não estiver vazia. Se imprimiu `ESTA_SETADA`, está ok; se não imprimiu nada, a variável se perdeu.

### 1.3 Aplicar as migrações no Prod

```bash
SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go" \
  supabase db push --db-url "$PROD" --dry-run
```
- **`supabase db push`**: aplica as migrações pendentes (arquivos em `supabase/migrations/`) no banco, **em ordem de número**.
- **`--db-url "$PROD"`**: manda aplicar no banco apontado pela variável (o Prod), sem precisar "linkar" o projeto.
- **`--dry-run`**: **simula** — só mostra **quais** migrações aplicaria, **sem** aplicar. Sempre rode o dry-run antes pra conferir a lista.
- **`SUPABASE_GO_BINARY=...`**: aponta pro binário auxiliar que o CLI precisa (config específica do seu ambiente).

```bash
SUPABASE_GO_BINARY=... supabase db push --db-url "$PROD"      # sem --dry-run = aplica de verdade
```
- Aplicou **0028–0056** (primeira leva) e depois a **0057** (storage). Pede confirmação `[Y/n]` → você digitou `y`.
- O warning `failed to cache migrations catalog … Docker` é **normal** (o CLI tenta usar Docker pra um cache opcional; sem Docker, ele só pula — **não impede** a aplicação).

### 1.4 Verificações com `psql` (SQL direto no banco)

```bash
psql "$PROD" -P pager=off -c "SELECT ..."
```
- **`psql`**: cliente de linha de comando do Postgres. `"$PROD"` = conecta no banco da variável.
- **`-c "SQL"`**: roda **um** comando SQL e sai.
- **`-P pager=off`**: desliga o **pager** (o `less`). Sem isso, resultado grande abre no `less` e mostra `(END)` — você sai com **`q`** (não é erro, é só o paginador).

Queries que rodamos:
- **Saúde dos grants** (`perfil_permissao` por perfil × módulo): confirmar que Administrador/Supervisor têm `sistema ≥ 1` (não travaram) e que cada perfil manteve o Recebimento.
- **Políticas de storage** (`pg_policies WHERE schemaname='storage'`): capturar as 3 políticas do bucket `anexos-processos` pra reescrever por módulo.
- **Sessões ativas** (`auth.sessions`): ver se tinha gente usando antes do deploy (`ativos_5min`, `ativos_30min`).

### 1.5 Build local (rede de segurança antes do deploy)

```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run build
```
- **`npm run build`**: roda `next build` — compila o app de produção + checa TypeScript + gera as rotas. É **o mesmo** que a Vercel roda.
- **`NODE_OPTIONS="--max-old-space-size=4096"`**: dá **4GB de heap** pro Node. O padrão (~2GB) estourava (`JavaScript heap out of memory`) na fase de checagem de tipos — não era erro de código, era **falta de RAM**.

### 1.6 Instalação do cliente Postgres 17 (PGDG)
Você adicionou o repositório oficial do Postgres (PGDG) e instalou o `postgresql-client-17`. O detalhe: o codename do **Linux Mint** ("zena") **não existe** no repo PGDG → foi preciso usar o codename do **Ubuntu base** ("**noble**") na linha do repositório. Ver aprendizado 3.2.

---

## Parte 2 — Resumo técnico do que fizemos

### 2.1 O que foi entregue
- **Módulo ShopFloor (Processo)** subiu pro Prod **escondido por permissão** (dark launch): Cadastro de OP, Lançamento, Integração (Receita/BOM), Manutenção, Pesquisa+Grade, Dashboard, Burn-in.
- **RBAC por módulo completo** (fonte da verdade = tabela `perfil_permissao(perfil_id, modulo, permissao)`):
  - **Fase 1 (app):** ~40 guards migrados de `podeFazer` (global) → `podeNoModulo(perfil, modulo, permissao)`.
  - **Fase 2a–2d (banco, RLS):** políticas por módulo nas tabelas `sf_*` (ShopFloor), Recebimento, Sistema (usuarios/perfis/logs) e **storage** (bucket de anexos). A função SQL `tem_permissao('modulo','permissao')` lê os grants.
  - Colunas `pode_*` mantidas por **compatibilidade** (derivadas por OR entre módulos).

### 2.2 Como foi a promoção (banco antes do código)
1. **Backup** do Prod (`pg_dump -Fc`, 383K/49 tabelas) — rollback garantido.
2. **Migrações 0028–0057** aplicadas no Prod via `supabase db push`.
   - **Ponto crítico:** a migração **0038** (seed dos grants a partir dos `pode_*`) roda **antes** das que ligam o RLS (0040/0051/0054). É isso que garante que os **admins do Prod não travem** ao ligar o RLS por módulo. Confirmado por query.
3. **Storage (0057):** reescreveu as 3 políticas do bucket `anexos-processos` de `tem_permissao('visualizar'/'editar')` global → `tem_permissao('recebimento', …)`.
4. **Verificação local:** 266 testes + build de produção (com 4GB de heap).
5. **Deploy via Pull Request:** push da branch → **PR #1** → Vercel gera **Preview** → smoke → **merge commit** → deploy de **Production** (zero-downtime).
6. **Smoke pós-deploy:** Recebimento ok, ShopFloor escondido, admins gerenciando normal.

### 2.3 Ajustes pós-deploy (PR #2)
- Tela **Sobre**: versão **1.1.0 → 1.0.0** e o card "Fluxo de Processos" removido (o módulo está em dark launch; sobe pra 1.1.0 e volta o card quando for liberado de fato).
- **Fix de build** (`force-dynamic` na página de usuários) — depois entendemos que a **causa raiz** era outra (ver 2.4); esse fix ficou como higiene inofensiva.

### 2.4 O episódio do build quebrado (e a causa raiz real)
- **Sintoma:** o build do **Preview** do PR #2 quebrava com `Failed to collect page data for /configuracoes/usuarios` (e depois `/recebimento/exportar-fotos`).
- **Investigação:** build local passava; Produção passava; só previews da branch `chore/...` falhavam. Você levantou a hipótese certa: **era relacionado à branch**.
- **Causa raiz:** as **3 variáveis do Supabase** na Vercel estavam com **escopo de Preview amarrado à branch `feat/shopfloor-lancamento`**. Previews de **outras** branches (chore/…) **não recebiam** essas credenciais → o fetch ao Supabase durante o build falhava.
- **Conclusão:** **Produção sempre esteve segura** (tem as vars no escopo Production). O problema era só de **configuração de env por branch** no Preview — não era código.

---

## Parte 3 — Aprendizados / conceitos

### 3.1 Conexão ao Postgres do Supabase: Direct × Session pooler × Transaction pooler
- **Direct connection** (`db.<ref>.supabase.co`): é **IPv6**. Se sua rede é só IPv4, **não conecta**.
- **Session pooler** (`aws-1-<região>.pooler.supabase.com:5432`, user `postgres.<ref>`): **IPv4**, mantém a sessão — serve pra **dump/migração/psql**. Foi o que usamos.
- **Transaction pooler** (porta **6543**): pool por transação — **NÃO** serve pra `pg_dump` (não segura sessão).
- **Dica:** resetar a senha do banco pra **alfanumérica** evita ter que "percent-encodar" caracteres especiais (`#`, `@`, etc.) na URL. E `#` na URL quebra tudo (vira "fragmento").

### 3.2 Codename de distro derivada (Mint) × repositório upstream (Ubuntu)
O Linux Mint tem codenames próprios ("zena") que **não existem** nos repositórios da Ubuntu/PGDG. Ao adicionar um repo upstream, use o codename do **Ubuntu base** correspondente (Mint 22.x → **noble**). Senão dá **404** no `apt`.

### 3.3 Segredos de produção — higiene
- **Nunca** colar senha/keys de Prod no chat. Use `export VAR='...'` no seu terminal e passe adiante só resultados **não-secretos**.
- Se um segredo vazar (foi colado em algum lugar), trate como **comprometido**: **rotacione** (reset) imediatamente.
- No repo: **nunca commitar** dumps/dados de Prod (por isso `*.dump` e `prod_*.sql` no `.gitignore`).

### 3.4 Banco antes do código, e migrações aditivas
- Promoção segura = **aplicar o banco primeiro**, depois o código. As migrações eram **aditivas** (criam tabelas/funções novas) + reescrevem RLS — o código **antigo** continua funcionando no banco novo durante a janela.
- **Ordem das migrações importa:** quem semeia dados/estado (0038) tem que vir **antes** de quem depende deles (o RLS). O número do arquivo garante a ordem.

### 3.5 RLS por módulo e a "pegadinha" do sombreamento
- **RLS (Row Level Security):** políticas no Postgres que filtram linhas por usuário — a separação real de acesso mora **no banco**, não só no app.
- **Pegadinha de SQL (sombreamento):** numa função, um nome **não-qualificado** igual a uma **coluna** liga na **coluna**, não no **parâmetro**. Isso causou um bug crítico numa fase anterior (a função de permissão lia a coluna em vez do argumento). Solução: **prefixar os parâmetros** (ex.: `p_modulo`, `p_perm`) pra nunca colidir com nomes de coluna.

### 3.6 Deploy na Vercel: Preview × Production, zero-downtime, env por branch
- Cada branch/PR ganha um **Preview** automático; a `main` faz o **Production**.
- **Zero-downtime:** o build novo só vira "produção" quando termina; quem está usando não cai.
- **Env vars têm escopo:** por **ambiente** (Production/Preview/Development) **e** por **branch** (no Preview). Se amarrar uma var a uma branch específica, **só** os previews **daquela** branch recebem — foi o que causou o build quebrado nas outras branches.
- **Regra prática:** as credenciais de **Dev/Preview** devem valer pra **"All Preview branches"** (todo dev testa contra o Dev), e as de **Prod** ficam no escopo **Production** apontando pro banco de Prod.

### 3.7 Fluxo de Pull Request (o jeito "profissional")
- PR é **por branch**, não por commit: junta **todos** os commits da branch que ainda não estão na base.
- Vantagens vs. merge direto: **diff revisável**, **preview automático** pra smoke, **gatilho explícito** do deploy no merge.
- **Excluir 1 commit do PR:** você mexe na **branch** (o PR segue ela) — `git revert <hash>` (seguro, cria commit que desfaz) ou `git rebase -i` + `--force-with-lease` (reescreve, só em branch sua).
- **Abrir PR manualmente:** `New pull request` na UI, ou a URL `compare/<base>...<sua-branch>?expand=1`, ou `gh pr create`.

### 3.8 Versão e tags (semver)
- Versão do app (tela Sobre) e **tag git** devem **casar** — tagueie **depois** do merge que sobe a versão.
- **Semver:** `1.0.0 → 1.1.0` = nova funcionalidade; `1.0.1` = correção.
- Tag/Release no GitHub (`v1.1.0`) cria um **ponto de rollback nomeado** + changelog.

### 3.9 Next.js 16: renderização dinâmica × estática no build
- O `next build` tenta **avaliar** cada página pra otimizar (prerender/coleta de dados). Páginas que buscam dados **por requisição** (autenticadas) devem ser **dinâmicas** — senão o build pode tentar rodá-las e falhar.
- **`export const dynamic = 'force-dynamic'`**: força render por requisição e faz o build **pular** essa avaliação. Vale no "modelo anterior" (Cache Components desligado); no Next 16 esse config muda quando Cache Components está ligado — **por isso a gente leu a doc da versão** (`AGENTS.md` manda).
- **Aprendizado maior:** "funciona local mas quebra no deploy" quase sempre é **diferença de ambiente** (env var, rede, versão) — não de código. Investigue o ambiente antes de mexer no código.

### 3.10 Debugar por correlação (o que você fez de certo)
O build quebrava "aleatório"? Não — **correlacionava com a branch** (feat passava, chore falhava). Olhar o **padrão** (o que é diferente entre o que funciona e o que não funciona) levou direto à causa raiz (env por branch). **Correlação primeiro, hipótese depois, confirmação por evidência** (a tela de env vars) — é assim que se debuga de verdade.
