# Histórico do Projeto — ShopFloor Enterplak

> Log fiel da construção (handoff). Leia a Seção "Estado atual e próximos passos" antes
> de retomar. Atualizado ao longo das sessões.

---

## 1. Contexto e método

Sistema **Shop Floor / MES** para a indústria eletrônica **Enterplak** (empresa rwtech),
substituindo planilhas Excel, Google Forms e Google Apps Script. Uso em produção,
multi-setor, arquitetura para crescer por anos. Regra do usuário: **implementação
correta > rápida**; explicar decisões.

**Stack:** Next.js 16 (App Router) + TypeScript strict + Tailwind v4 + shadcn/Base UI +
Supabase (Postgres/Auth/RLS). Hospedagem alvo: Vercel + Supabase Cloud. Cor `#8D2033`.

**Método:** desenvolvimento orientado a subagentes (plano → implementador TDD → revisor
adversarial → correção → review final). Revisão **pesada** em segurança/banco; **leve** em
telas CRUD repetidas (a pedido do usuário, para acelerar). Pegou vários bugs sérios antes
de produção (ver Seção 7).

**Arquitetura:** monólito modular por feature (`src/modules/<feature>/{domain,application,
infra}`); domínio TS puro (sem Supabase/Next); Server Actions finos que checam permissão +
logam; RLS como portão real no banco.

---

## 2. Módulos entregues (todos validados por smoke)

- **Fundação** — Auth Supabase + login (identidade Enterplak); RBAC por flags booleanas em
  `perfis` (Administrador/Supervisor/Recebimento/Consulta) lidas por RLS via
  `tem_permissao()`; layout autenticado com menu por perfil; **logs imutáveis**
  (UPDATE/DELETE/TRUNCATE bloqueados até para service_role).
- **Configurações & Logs** — telas admin (guard `administrar`): Usuários (cria conta no
  Supabase Auth via admin API service-role + anti-lockout), Perfis (CRUD flags +
  anti-lockout), Listas, Campos (`configuracao_campos`: obrigatoriedade E tipo
  configuráveis), Logs (read-only + filtros), Sobre. Auditoria: `registrarLog` +
  `calcularDiff`.
- **Recebimento 3A — Importação** — wizard (SheetJS no cliente → mapeamento manual →
  preview com validação → RPC transacional `importar_processos`, SECURITY INVOKER);
  parsing BR (milhar `1.500`→1500; data `dd/mm/aaaa`) + filtro de linhas em branco; listas
  de Processos e Importações.
- **Recebimento 3B — Processos** — formulário dinâmico (de `configuracao_campos`) + ciclo
  de vida Aberto→Em Conferência(auto 1º save)→Finalizado/Cancelado, Reabrir; máquina de
  estados testada; Cancelar/Reabrir só Supervisor/Admin; busca/filtros na lista.
- **Recebimento 3C — Campos calculados** — atraso (dias c/ sinal), divergência, crítico
  (whitelist de fornecedores: presença=Sim), amostral (tabela NQA), responsável
  (write-once). Cálculo compartilhado cliente(exibição)↔servidor(gravação autoritativa).
  Telas de config: Criticidade e Tabela NQA.
- **Etiquetas (Part Number)** — substitui o Apps Script. Busca por NF/EMB/Fornecedor →
  seleciona processos → gera CSV `[PARTNUMBER,CODIGO,VOLUME]` (download no navegador, não
  armazenado) + histórico (`geracoes_etiquetas`). **Formato validado empiricamente 1:1 com
  o Apps Script** (exemplo RWCN98 travado em teste). Permissão `gerar_etiqueta`.

---

## 3. Banco de dados (Supabase Cloud)
Projeto "Project Shop Floor" (ref `ykwkacfviarhfmxeisqk`, sa-east-1, PG17). Migrations
**0001–0012**. Tabelas: perfis, usuarios, listas/lista_itens, configuracao_campos,
importacoes, processos_recebimento, logs (imutável), criticidade_fornecedor, tabela_nqa,
geracoes_etiquetas. RLS em todas. RPC `importar_processos`.

## 4. GitHub
Repositório privado **github.com/MatheusSilvaRwTech/ShopFloor**, branch `main`. Higiene
feita (README, .gitignore; untrack de `.env.local`, `.claude/settings.local.json`,
`.superpowers/`, planilha real). Autenticação migrada para **chave SSH**
(`~/.ssh/id_ed25519_github`) — token antigo exposto no chat **deve ser revogado**. Commits
atribuídos a `MatheusSilvaRwTech <matheus.silva@rwtech.com.br>` (config local), com Claude
como co-autor. Tudo sincronizado com o remoto. ⚠️ **O local costuma ficar à frente do
remoto** — lembrar de `git push` após mudanças (produção republica a partir do `main`).

---

## 5. Estado atual e próximos passos (LER ANTES DE RETOMAR)

**Sistema FUNCIONALMENTE COMPLETO** (todos os fluxos das planilhas/Forms/Apps Script
reproduzidos, com auditoria/permissões). Dados de teste foram **limpos** (processos,
importações, gerações zerados; config preservada; logs imutáveis permanecem) para teste do
zero.

**UX/UI + responsividade: CONCLUÍDOS.** Redesign aplicado (identidade Enterplak vinho
`#8D2033`): split-login com painel de marca; **sidebar branca** com accordions e item ativo
em pill vinho (decisão do usuário: branca em vez de vinho); topbar enxuta; home só com o card
de Recebimento; tokens de tema, badges de status refinados, toasts (sonner). Responsividade
funcional em desktop/tablet/celular: **shell de viewport fixo** com scroll independente
(sidebar × conteúdo) e **tabelas que viram cards no mobile** (padrão replicado a ~11 telas).
`tsc`/lint/build limpos.

**Deploy na Vercel: CONCLUÍDO (2026-07-10).** Sistema no ar. Ver **Seção 10**.

**Fase atual / próximos passos:** domínio próprio `shopfloor.enterplak.com.br` **pausado**
(ver Seção 10); backlog remanescente (Seção 6). Sistema em produção e em uso.

---

## 6. Backlog (em `.superpowers/sdd/progress.md`)
CVE do `xlsx` (avaliar build oficial SheetJS); coluna "Nº" da lista de etiquetas mostra
índice, não o `numero`; sugestão automática de mapeamento na importação; gate `typecheck`
(tsc --noEmit) no CI; eventual trava de status na geração de etiquetas (hoje sem trava, por
decisão do usuário); `formatarPedido` fallback sem teste; melhorias pontuais de UX que
surgirem.

## 7. Bugs pegos pela revisão / testes (valor do método)
- Logs apagáveis via `TRUNCATE` → corrigido (trigger statement + REVOKE).
- RLS impedia o perfil Recebimento de **finalizar** → corrigido.
- Conta de usuário ficava **órfã** em falha parcial de cadastro → rollback.
- Campo podia ser corrompido (promoção indevida de tipo) → travado.
- **Parsing BR**: "1.500"→1,5 e "01/06"→janeiro → corrigido (achado no smoke).
- Linhas em branco travavam a importação → ignoradas (achado no smoke).
- Salvar processo podia gravar sem RLS e **logar mudança que não ocorreu** → guarda de 0 linhas.
- **Finalizar travava após o 1º salvamento** (dirty considerava campos calculados) → corrigido.
- Selects mostravam o **valor cru** (id/enum/chave) no lugar do rótulo (Base UI Select.Value)
  → corrigido em Perfil, Logs (Entidade/Ação), Processos (Status), Campos (Tipo/Lista).
- Ação sem permissão fazia **redirect silencioso** → agora esconde o item do menu + tela
  "Acesso restrito" (Importar/Etiquetas).

## 8. Decisões-chave (não re-discutir)
1 processo = 1 material; ciclo Aberto→Em Conferência→Finalizado(+Cancelado); importação com
mapeamento manual a cada vez; campos de lista guardam valor-texto (snapshot); obrigatoriedade
E tipo de campo configuráveis; Cancelar/Reabrir só Sup/Admin; Atraso em dias com sinal;
Amostral sobre Qtd. Recebida; Crítico = whitelist de fornecedores (Sim/Não); Responsável fixa
no 1º preenchimento; tabelas Criticidade e NQA configuráveis; geração de etiqueta sem trava de
status (por ora); Part Number = CÓDIGO-PEDIDOFMT+DOC+SEQ (validado).

## 9. Artefatos
Specs: `docs/superpowers/specs/`. Planos: `docs/superpowers/plans/`. Ledger de execução:
`.superpowers/sdd/progress.md`. Bootstrap admin: `docs/operacao/primeiro-admin.md`. Memória:
`~/.claude/.../memory/projeto-shopfloor.md`.

---

## 10. Sessão 2026-07-10 — Deploy em produção (Vercel)

**Resultado: ShopFloor no ar 24/7 em `https://shop-floor-blush.vercel.app`.** Saiu do
localhost; setores da fábrica acessam por esse endereço.

**Modelo de deploy:** Vercel conectada ao GitHub → **deploy automático via Git** (produção =
branch `main`; nada vai ao ar sem `commit`+`push`). Decisão do usuário: **conta Vercel nova e
separada** ("Matheus RwTech", login pelo GitHub `MatheusSilvaRwTech`, dono do repo) para
**isolar produção da máquina local** — por isso NÃO usamos a CLI (que publicaria código local
direto). Framework Next.js autodetectado.

**Variáveis de ambiente na Vercel** (as 3 do `.env.local`, inseridas pelo usuário no painel,
nunca no chat): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`. O app não tem env de URL própria, então nada muda ao trocar de
domínio.

**Percalços resolvidos:**
- Vercel não enxergava o GitHub certo (conta Vercel estava atada a outro GitHub). Solução:
  criar conta Vercel logada com `MatheusSilvaRwTech`.
- **Dois projetos criados sem querer** — o primeiro (`shop-floor-w7sj`) tinha **Deployment
  Protection / Vercel Authentication** ligada (muro que exige login na Vercel; barraria a
  fábrica). Diagnóstico via WebFetch (redirect p/ `vercel.com/sso-api`). Mantido o
  `shop-floor-blush` (público, ok); `shop-floor-w7sj` **excluído**.

**Supabase — URL Configuration** (Authentication): Site URL = `https://shop-floor-blush.vercel.app`
(sem curinga — não é permitido ali); Redirect URLs = `https://shop-floor-blush.vercel.app/**`
+ `http://localhost:3000/**`. Hoje o login é por senha/cookie e **não usa** esses redirects;
é preparação para futuros fluxos de e-mail (reset de senha/magic link).

**Domínio próprio `shopfloor.enterplak.com.br` — PAUSADO** (imprevistos; usuário
testando/corrigindo). Adicionado no painel Vercel (Production). ⚠️ Descoberta importante: o
**DNS do `enterplak.com.br` é gerenciado na LOCAWEB** (nameservers `ns1/ns2/ns3.locaweb.com.br`)
— NÃO no Registro.br e NÃO na hospedagem do site (FTP em `ftp.enterplak.hospedagemdesites.ws`,
provedor diferente). **Retomar:** criar registro **CNAME `shopfloor` → `cname.vercel-dns.com`**
em `painel.locaweb.com.br → Domínios → Zona de DNS`; confirmar o valor exato na tela da Vercel;
após propagar, atualizar Site URL/Redirect no Supabase para o domínio novo.
