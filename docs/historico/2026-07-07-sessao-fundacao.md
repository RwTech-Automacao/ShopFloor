# Histórico da Sessão — ShopFloor Enterplak

> Registro fiel da sessão de desenvolvimento (Fundação → Configurações → Recebimento
> 3A/3B/3C). Serve de handoff: leia a Seção "Estado atual e próximos passos" antes de
> retomar / subir para o GitHub.

---

## 1. Contexto e método

Sistema **ShopFloor / MES** para a indústria eletrônica **Enterplak** (empresa rwtech),
substituindo planilhas Excel, Google Forms e Google Apps Script. Uso em produção,
multi-setor, arquitetura para crescer por anos. Regra-guia do usuário: **implementação
correta > rápida**; explicar decisões arquiteturais.

**Stack:** Next.js 16 (App Router) + TypeScript strict + Tailwind v4 + shadcn/Base UI +
Supabase (Postgres/Auth/RLS). Hospedagem alvo: Vercel + Supabase Cloud. Cor `#8D2033`.

**Método de trabalho:** desenvolvimento orientado a subagentes (Superpowers) — cada
tarefa: plano → implementador (TDD) → revisor adversarial → correção → review final do
módulo. Revisão **pesada** em segurança/banco; **leve** em telas CRUD repetidas (a pedido
do usuário, para acelerar). Esse método pegou vários bugs sérios antes de produção (ver
Seção 7).

**Arquitetura:** monólito modular por feature (`src/modules/<feature>/{domain,
application,infra}`); domínio em TS puro (sem Supabase/Next); Server Actions finos que
checam permissão + logam; RLS como portão real no banco.

---

## 2. Incrementos entregues

### Plano 1 — Fundação ✅ (completo e validado por smoke)
Auth Supabase + login (identidade Enterplak); RBAC por flags booleanas em `perfis`
(Administrador, Supervisor, Recebimento, Consulta) lidas pela RLS via `tem_permissao()`;
layout autenticado com menu por perfil; schema base; **logs imutáveis**
(UPDATE/DELETE/TRUNCATE bloqueados até para service_role); domínio de perfil (TS puro,
testado). Smoke validado: login + RBAC no navegador.

### Plano 2 — Configurações & Logs ✅ (completo, smoke OK)
Telas admin (guard `administrar`): **Usuários** (cria conta no Supabase Auth via admin API
service-role, com anti-lockout), **Perfis** (CRUD + flags + anti-lockout), **Listas**,
**Campos** (`configuracao_campos`: obrigatoriedade + tipo texto↔lista configuráveis),
**Logs** (read-only, filtros, paginação), **Sobre**. Infra de auditoria (`registrarLog` +
`calcularDiff`) — toda mutação gera log imutável.

### Plano 3A — Recebimento / Importação ✅ (completo e validado por smoke)
Wizard de importação (SheetJS no cliente → mapeamento manual → preview com validação →
RPC transacional `importar_processos`, SECURITY INVOKER); domínio de conversão com
**parsing BR** (milhar `1.500`→1500; data `dd/mm/aaaa`) e **filtro de linhas em branco**;
listas de Processos e Importações (menu Recebimento). Smoke validado: importou 32
processos da planilha real (`EMB341EA - ESTADOS UNIDOS.xlsx`, 115 linhas − 83 em branco) +
gerou log.

### Plano 3B — Recebimento / Processos ✅ (completo, smoke OK "no geral bom")
Formulário dinâmico (de `configuracao_campos`, por grupo/tipo); ciclo de vida
Aberto→Em Conferência(auto no 1º salvamento)→Finalizado/Cancelado, Reabrir; máquina de
estados (TS puro, testada); transições como Server Actions (permissão + log); busca/filtros
na lista. Permissões: Finalizar=`finalizar`; Cancelar=`excluir` (Sup/Admin); Reabrir=
`editar_finalizado` (Sup/Admin); reforço RLS (migration 0009). Fix wave do review final:
integridade de auditoria (update de 0 linhas falha em vez de fingir sucesso), `editar` nas
transições, Finalizar bloqueado com alterações não salvas.

### Plano 3C — Recebimento / Campos Calculados ✅ CÓDIGO COMPLETO (falta review final + smoke)
5 campos viraram automáticos (somente-leitura, cálculo ao vivo no form + recomputo
autoritativo no servidor):
- **Atraso** = Data Chegada − Data Prevista (dias com sinal)
- **Divergência** = Qtd. Recebida − Qtd. no Pedido
- **Crítico?** = lookup Fornecedor→Sim/Não (tabela configurável)
- **Amostral** = tabela NQA sobre Qtd. Recebida (tabela configurável)
- **Responsável** = usuário do 1º preenchimento (write-once)
Duas telas novas de config: **Criticidade por Fornecedor** e **Tabela NQA** (faixas AQL
padrão já semeadas, tamanhos em branco para o Admin preencher). Domínio de cálculo testado;
review opus confirmou que um payload forjado **não** persiste em campo calculado.

---

## 3. Banco de dados (Supabase Cloud)
Projeto "Project Shop Floor" (ref `ykwkacfviarhfmxeisqk`, sa-east-1, PG17). Migrations
**0001–0010** aplicadas. Tabelas: `perfis`, `usuarios`, `listas`/`lista_itens`,
`configuracao_campos` (+ calculado/formula/formula_config), `importacoes`,
`processos_recebimento`, `logs` (imutável), `criticidade_fornecedor`, `tabela_nqa`. RLS em
todas. RPC transacional `importar_processos`.

---

## 4. Estado atual e próximos passos (LER ANTES DE RETOMAR)
- **Git:** ~57 commits em `master`. **Sem remoto ainda** → o plano é **subir para o GitHub
  amanhã**. `.env.local` (segredos) está git-ignored — não sobe. Há um `.~lock…xlsx#`
  (lock do LibreOffice) e mudanças em `.claude/settings.local.json` no working tree — não
  versionar.
- **Pendente do 3C:** (1) review final do branch 3C; (2) **smoke** no navegador dos campos
  calculados (abrir um processo, ver Atraso/Divergência/Amostral/Crítico/Responsável
  calculando; popular as tabelas Criticidade e NQA em Configurações). Só depois considerar
  o 3C 100%.
- **Próximo incremento:** **Etiquetas** (Incremento 2) — geração de CSV de Part Number.
  ⚠️ Depende do **Google Apps Script atual** (o usuário precisa fornecer).

### Para subir ao GitHub (amanhã)
1. Criar repositório no GitHub (privado). 2. `git remote add origin …`. 3. Conferir que
`.env.local` e segredos não vão (já ignorados). 4. `git push -u origin master`.

---

## 5. Backlog (registrado em `.superpowers/sdd/progress.md`)
- `xlsx@0.18.5` tem CVEs (baixo risco: arquivos internos) — avaliar migrar p/ build oficial SheetJS.
- Sugestão automática de mapeamento na importação não casou (colunas do Comercial ≠ rótulos) — melhorar heurística/aliases.
- Warning Base UI (Button render=Link) na paginação — trocar por `<button>`/`nativeButton=false`.
- Fonte Geist Sans não aplica (`--font-sans` autorreferente no globals.css do scaffold).
- Adicionar script `typecheck` (`tsc --noEmit`) ao CI (o `next build` não cobre `__tests__`).
- Minors: save sem alterações grava log de diff vazio; catch genérico não loga erro real; mensagem de erro de reset de senha; sem "último admin"/redefinir; melhorias pontuais que o usuário notou (a detalhar).
- (3A opcional) calcular Atraso/Crítico já na importação (hoje calculam ao abrir/salvar).

---

## 6. Decisões-chave (para não re-discutir)
1 processo = 1 material; ciclo Aberto→Em Conferência→Finalizado(+Cancelado); importação com
mapeamento manual a cada vez; campos de lista guardam valor-texto (snapshot); obrigatoriedade
E tipo de campo configuráveis; Cancelar/Reabrir só Sup/Admin; Atraso em dias com sinal;
Amostral sobre Qtd. Recebida; Crítico Sim/Não; Responsável fixa no 1º preenchimento; tabelas
Criticidade e NQA configuráveis pelo Admin.

## 7. Bugs sérios pegos pela revisão (valor do método)
- Logs apagáveis via `TRUNCATE` (a imutabilidade só cobria UPDATE/DELETE) → corrigido.
- RLS impedia o perfil Recebimento de **finalizar** processos → corrigido.
- Conta de usuário ficava **órfã** em falha parcial de cadastro → rollback.
- Campo podia ser corrompido (promoção indevida de tipo) → travado.
- **Parsing BR**: "1.500" virava 1,5 e "01/06" virava janeiro → corrigido (achado só com dados reais no smoke).
- **Linhas em branco** da planilha travavam a importação → ignoradas (achado no smoke).
- Salvar processo podia gravar sem RLS e **logar mudança que não ocorreu** → guarda de 0 linhas.

---

## 8. Artefatos
Specs: `docs/superpowers/specs/`. Planos: `docs/superpowers/plans/`. Ledger de execução:
`.superpowers/sdd/progress.md`. Procedimento de 1º admin: `docs/operacao/primeiro-admin.md`.
Memória do projeto: `~/.claude/.../memory/projeto-shopfloor.md`.
