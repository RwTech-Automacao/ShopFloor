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
`.superpowers/`, planilha real). ⚠️ **O local costuma ficar à frente do remoto** — lembrar
de `git push` após mudanças (sem SSH/credential manager ainda; usa token — o token exposto
no chat deve ser revogado). Push inicial feito; **há commits novos não enviados** (fix do
Finalizar, Etiquetas, correções de UX).

---

## 5. Estado atual e próximos passos (LER ANTES DE RETOMAR)

**Sistema FUNCIONALMENTE COMPLETO** (todos os fluxos das planilhas/Forms/Apps Script
reproduzidos, com auditoria/permissões). Dados de teste foram **limpos** (processos,
importações, gerações zerados; config preservada; logs imutáveis permanecem) para teste do
zero.

**Fase atual: melhorias de UX/UI + responsividade.**
- Prioridade do usuário: **fazer tudo bonito e consistente de uma vez (foundation-first),
  evitando retrabalho.**
- Alvo responsivo: **desktop + tablet + celular** (mobile-first).
- **Referência visual (fornecida pelo usuário):** o CRM da própria RWTech ("MeuCRM").
  Linguagem: **split-login** (painel de marca à esquerda com headline/subtítulo + formas
  decorativas; formulário limpo à direita, show/hide senha, lembrar-me, footer); **sidebar
  de marca** (fundo vinho, logo, seção "MENU", itens com ícone + rótulo, item ativo em pill
  destacada, colapsável); **topbar** (busca global, notificações, avatar+usuário dropdown);
  **dashboard** com saudação, **cards de indicadores** (ícone + número grande + subtítulo) e
  painéis de conteúdo; toasts. Cor primária = **Enterplak #8D2033** (no lugar do azul do
  CRM). Prints em `docs/historico/` ou anexados na conversa.

**Plano de UX (a executar, foundation-first):**
1. Design system / tema: paleta Enterplak completa (vinho + neutros + estados), tipografia
   (corrigir a fonte Geist que não aplica), espaçamentos/raios; tokens Tailwind.
2. Esqueleto de layout responsivo: sidebar de marca colapsável (hambúrguer no mobile),
   topbar (busca/notificações/usuário), breadcrumbs.
3. Padrões base: tabela (cabeçalho fixo, zebra, ordenação, badges, empty state, skeleton →
   vira cards no mobile), formulário (grid reflui 3→1 col; grupos em seções/abas), toasts
   (Toaster) e diálogos de confirmação (no lugar de window.confirm).
4. Home vira **painel** com atalhos + indicadores (processos por status, últimas
   importações/gerações).
5. Aplicar tela por tela (login, configurações, recebimento, etiquetas) com a nova base.
   **Usar a skill frontend-design ao construir** (visual não-genérico).

**Depois do UX:** deploy na Vercel; backlog remanescente.

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
