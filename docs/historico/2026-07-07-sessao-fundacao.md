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

---

## 11. Sessão 2026-07-10 — Refinamentos pós-deploy (já em produção)

Ajustes feitos após o deploy, cada um verificado (typecheck + lint + testes + build) e
publicado via push (deploy automático). Testes ao fim: **101 passando**.

- **Fuso horário dos registros** — os `timestamptz` vêm em UTC do banco e as telas renderizam
  no servidor (UTC na Vercel), o que mostrava os horários **+3h**. Fixado `timeZone:
  'America/Sao_Paulo'` nos formatadores de **Logs**, **Importações** e **Histórico de
  Etiquetas**, e no carimbo do **nome do CSV** de etiquetas. Só exibição; dados no banco
  seguem em UTC.
- **Colunas fantasma na importação** — Excel/Sheets guardam a "área usada" maior que os dados
  reais; o SheetJS expunha colunas de cabeçalho vazio como "(vazias)" no mapeamento.
  `ler-planilha.ts` passou a **descartar** colunas sem cabeçalho E sem dados (coluna com dado
  é sempre mantida, mesmo sem cabeçalho — não perde informação). Com teste
  (`ler-planilha.test.ts`).
- **"Código do Material" → "Item Recebido"** — alinhado à planilha atual da Enterplak.
  Migração **0013** troca o rótulo de `codigo_material` (reflete no formulário do processo, na
  importação e na tela de Campos, que leem o rótulo do banco) + coluna da lista de Processos
  (texto fixo no código). A coluna `codigo_material` do banco permanece.
- **Campos calculados** (Atraso, Crítico, Divergência, Responsável, Amostral) — são
  preenchidos pelo sistema: **removidos do mapeamento de importação** (`carregarCamposComerciais`
  passou a filtrar `calculado=false`; some Atraso e Crítico, que vazavam) e **somente-leitura
  na tela de Campos** (selo "Calculado" + cadeado no lugar do lápis, com trava também no
  servidor: `salvarCampo` rejeita campo calculado). Decisão do usuário: manter visíveis (não
  esconder) para transparência do inventário de campos.
- **Menu Configurações** virou **accordion de topo**, com sub-accordion **"Ajustes
  Recebimento"** (Listas, Campos, Criticidade, Tabela NQA); Usuários/Perfis/Logs soltos.
- **Tela Sobre** reformulada (layout em cards) e **movida de `/configuracoes/sobre` →
  `/sobre`**, saindo do guard de admin de `/configuracoes` (que redireciona não-admin para a
  Home). Agora **"Ajuda → Sobre o Sistema" é visível e acessível a TODOS os usuários logados**.
  Removido `config-nav.ts` (código morto, só usado pelo próprio teste, que passou a contradizer
  a realidade).

### ⚠️ Decisão pendente: isolar ambientes Dev × Produção (banco)

**Problema:** hoje o **local** (`.env.local`) e a **produção** (Vercel) apontam para o **mesmo
projeto Supabase**. Testar/desenvolver localmente escreve em dados de produção. Quando a
fábrica estiver usando de verdade, não dá para testar sem sujar/arriscar os dados reais.

**Solução recomendada:** um **2º projeto Supabase** ("ShopFloor Dev/Homologação" — o free tier
permite 2 projetos por organização). O **local** aponta para o **Dev**; a **Vercel** continua
no **Prod**. As migrations (`supabase/migrations/`) são aplicadas nos dois via `supabase db
push` — no Dev primeiro (testar a migração), depois no Prod. Alternativas: Supabase local via
**Docker** (`supabase start` — mais isolado, mas exige instalar Docker; hoje não instalado) ou
**Supabase Branching** (recurso do plano Pro, pago). **Ainda não implementado** — o usuário vai
primeiro apresentar o sistema para a equipe (usando produção com dados reais só para demonstrar
exemplos de uso) e depois decide.

---

## 12. Sessão 2026-07-13 — Roadmap pós-apresentação (features 3b e #7+#3a)

Duas features grandes do roadmap (`docs/roadmap-pos-apresentacao.md`) entregues em produção, via
**subagent-driven-development** (implementador + revisor por task + review final adversarial), direto
na `main` (sem dados reais em produção). Fluxo: brainstorming → spec → plano → execução.

### 3b — Lista de Processos em accordions por mês
- A lista virou **accordions por mês da data de chegada** (grupo **"Aguardando data de chegada"** no
  topo p/ sem data; meses do mais recente ao mais antigo), com **carregamento sob demanda** (linhas
  de cada mês carregam ao abrir; abrem por padrão o topo + mês mais recente).
- **Escala:** a contagem por mês roda no banco via **RPC `processos_meses`** (migração **0014**,
  GROUP BY, SECURITY INVOKER) — sem o teto de linhas do PostgREST. Filtro de status e badges seguem.
- Correções do review: `key` no accordion (remonta ao trocar filtro), vazio sensível a filtro, guard
  de `chave`. Spec/plano: `docs/superpowers/{specs,plans}/2026-07-13-processos-abas-por-mes*`.

### #7 + #3a — Seções Recebimento/Qualidade + status dinâmico (migração 0015)
- **Formulário em 2 seções independentes** (Recebimento, Qualidade), cada uma com **Salvar próprio**;
  qualquer Salvar grava **Comercial + Material + a sua seção** e carimba o **responsável da seção**
  (`responsavel_recebimento`/`responsavel_qualidade`, último que salvou; exibidos por **nome** —
  resolvido via **service client** porque o RLS de `usuarios` bloquearia o nome de outro usuário).
- **"Part Number recebido"** foi para a seção Qualidade (1º item). **Removidos:** `responsavel_contagem`
  (campo/coluna/cálculo), o **Salvar único** e o **Cancelar** (botão/ação/status).
- **Status dinâmico:** fixos `aberto`/`em_conferencia` + **terminais = valores da lista "Resultado"**
  (Aprovado/Reprovado, e o que o Admin adicionar). A **constraint de status saiu do banco**; a máquina
  de estados virou predicados (`ehTerminal`/`podeFinalizar`/`podeReabrir`/`podePromoverParaConferencia`).
  **Finalizar** (mantido) exige só o campo `resultado` e grava `status = valor`; **guard** rejeita
  `resultado`='aberto'/'em_conferencia'. **Reabrir** → em_conferencia. **RLS `processos_update`**:
  "concluído" = status não-base (aberto/em_conferencia) → exige `editar_finalizado`.
- Review final (Opus): **READY TO MERGE**; 1 Important corrigido (guard de status reservado) + 1
  Critical corrigido no extra dos responsáveis (nome via service client). Spec/plano:
  `docs/superpowers/{specs,plans}/2026-07-13-recebimento-qualidade-status*`.

### Bug diagnosticado — exclusão de listas suspensas
Reportado "não dá pra excluir listas". **Não é bug de código:** todas as listas atuais são
`sistema=true` e a policy `listas_delete` (0006) bloqueia exclusão de listas de sistema **por design**
(os campos/status dependem delas) — mensagem correta "Listas do sistema não podem ser excluídas.".
Listas criadas pelo usuário nascem `sistema=false` e são excluíveis. Pendente: decidir UX (esconder
botão de excluir em lista de sistema) e/ou desmarcar `sistema` de listas específicas que o usuário
queira remover (após confirmar que nenhum campo as usa).

---

## 13. Sessão 2026-07-14 — Roadmap: #2, #5, #4, #1 (anexos A+B) + correções

Todas via **subagent-driven-development** (implementador + revisor por task + review final Opus
adversarial), direto na `main` (sem dados reais em produção), fluxo brainstorming → spec → plano →
execução. Deploy automático na Vercel (`git push` → main). Domínio: MES Enterplak. Migrações
aplicadas em produção pelo controller (com reload do schema cache do PostgREST).

### #2 — Setas de navegação entre processos (migração 0016)
Setas ‹ › no rodapé do detalhe (canto direito) para o processo **anterior/próximo na ordem da lista
filtrada**, atravessando meses. RPC **`processos_vizinhos`** (migração **0016**); os filtros de
busca/status seguem por query param (lista → detalhe → setas). Depois, ajuste visual: setas em
**vinho-outline** (identidade Enterplak) — sem competir com o Finalizar (vinho cheio).

### #5 — Trava de geração de etiqueta por elegibilidade (sem migração)
Etiqueta só é gerada quando o processo está **terminal (`ehTerminal`) E com campos completos**
(Item Recebido, Nº Pedido, DI/INPI-ou-NF, Volumes ≥ 1). Domínio `elegivelParaEtiqueta`
(motivo `aguardando`|`incompleto`); `ProcessoEtiqueta` ganhou `status`; a UI mostra **todos** os
processos com **badge de status** e desabilita a seleção dos não elegíveis com o motivo; o servidor
(autoritativo) pula os não elegíveis na geração. Review Opus: READY TO MERGE.

### Fix — processo concluído é somente-leitura
Bug reportado: dava para editar um processo finalizado sem reabrir. Corrigido: processo em status
**terminal** é **somente-leitura** — nem quem tem `editar_finalizado` edita direto; para editar é
preciso **Reabrir** (volta a Em conferência). `editar_finalizado` passou a significar só "pode
reabrir". Aplicado na tela (`editavelPorStatus=false` em terminal) e no servidor
(`salvarSecaoProcesso` rejeita terminal). RLS `processos_update` mantida (o app é o portão).

### #4 — Adicionar processo manual (sem migração)
Botão **"Adicionar processo"** no topo da lista (gate `editar`) → página `/recebimento/processos/novo`
com formulário dos grupos **Comercial + Material**, seguindo **as mesmas regras da importação**:
obrigatórios = `obrigatorio_importacao` (novo `obrigatorioImportacao` em `CampoFormulario`),
calculados computados no servidor, **campos de lista validados** (valor fora da lista → erro),
processo nasce `aberto` com `numero` automático. Backend: `criarProcesso` (INSERT, exclui
`status`/`numero`, whitelist `COLUNAS_GRAVAVEIS` + `criado_por`) + Server Action `criarProcessoManual`
(log `criar`). `CampoControle` **extraído** para módulo compartilhado (reuso detalhe ↔ criação).
RLS de INSERT já aceitava `editar`. Review Opus: READY TO MERGE (Minor de validação de lista
resolvido antes do push).

### #1 — Anexos de foto por processo (o maior; decomposto em A + B — os dois em produção)
Supabase Storage era greenfield. Decisões do usuário: **compressão teto 1 MB**, **máx 3 fotos** por
processo, **upload imediato** (não staged), rename `pedido-item-pNº-i`, **limpeza em 2 passos manuais**.

- **A — núcleo (migração 0017):** bucket privado `anexos-processos` + tabela `anexos_processo` +
  RLS via `tem_permissao` (ver=`visualizar`, anexar/excluir=`editar`). Card **"Fotos (N/3)"** no
  detalhe (abaixo da Qualidade): captura câmera/arquivo → **compressão no cliente só se > 1 MB**
  (`browser-image-compression`) → **upload imediato** via Server Actions `anexarFoto`/`removerFoto`
  (gate `editar`; **terminal bloqueado**; limite 3; rollback de órfão; log `alterar_campo`/`excluir`);
  miniatura via **signed URL**; `bodySizeLimit` das Server Actions elevado a **5 MB** (senão o Next
  barraria foto > 1 MB — pego no review). Review Opus corrigiu 1 Important: `listarAnexosComUrl`
  resiliente (URL falha não derruba a página) + `removerFoto` apaga metadado antes do objeto.
- **B — export mensal + limpeza (migração 0018):** RPCs `anexos_meses` + `anexos_do_mes`. Tela
  **"Exportar Fotos"** (gate `administrar`): lista meses (por `data_chegada`) com contagem; por mês
  **[Exportar ZIP]** — montado **no navegador** com `jszip` (evita o teto de resposta serverless;
  assina URLs em **lote** via `createSignedUrls`) com fotos renomeadas `{pedido}-{item}-p{numero}-{i}.ext`
  (domínio puro `nomeArquivoFoto`, sanitiza acento/inválidos, fallback `p{numero}`, único) — e
  **[Limpar fotos do mês]** separado, com confirmação (apaga **em lotes**: metadado antes do objeto;
  log `excluir`). As actions/repository do B usam o **client de serviço** (server-only) com gate
  `administrar` como portão. Google Drive API = **v2 futura** (arquivamento manual). Review Opus
  (NEEDS WORK borderline) corrigiu 2 Important de escala (assinatura/limpeza em lote) antes do push.

### Correção do menu + faxina de código morto
"Exportar Fotos" não aparecia: tinha sido adicionado ao `RECEBIMENTO_NAV` (`recebimento-nav.ts`), que
**não é consumido pela barra lateral** — o menu real é a constante `RECEBIMENTO` dentro de
`app-shell.tsx`. Corrigido lá (ícone `ImageDown`, gate `administrar`). Depois, **faxina:** removido o
`recebimento-nav.ts` + teste (código morto, 0 referências fora do próprio teste — verificado).
Lição registrada na memória: menu é SEMPRE no `app-shell.tsx`.

### Estado do roadmap ao fim da sessão
- **Entregues em produção:** #2 (setas), 3b (accordions/mês), #7+#3a (seções + status dinâmico),
  #5 (trava etiqueta), #4 (processo manual), #1 A+B (anexos completos), + fixes (terminal read-only,
  cor das setas, menu, código morto).
- **Pendentes (no fim da 1ª parte da sessão):** #6; bug das listas; ambiente Dev × Prod; domínio;
  smokes. (Ver seções 14 e 15 abaixo — bug das listas e domínio foram concluídos na mesma sessão.)

### Bug das listas — concluído (migrações 0019 + 0020)
- **0019:** removida a trava `sistema=false` do RLS `listas_delete` — agora dá pra excluir qualquer
  lista (gate `administrar`). Proteção que ficou: **lista em uso por um campo é bloqueada com aviso**
  nomeando o campo (`camposQueUsamLista`), e a lista **`resultado`** tem trava direta (é load-bearing
  p/ os status). Review Opus pegou que a proteção da `resultado` era só incidental → trava direta.
- **0020 (follow-up):** os campos **calculados** (Amostral/Atraso/Crítico?/Divergência) mantinham um
  `lista_chave` obsoleto (sobra da 0010) → davam falso "em uso". A 0020 limpou (`update ... set
  lista_chave=null where calculado=true`) e `camposQueUsamLista` passou a ignorar calculados. Agora
  essas 4 listas são excluíveis. Regra: **campo calculado não deve ter `lista_chave`**.
- Entregue via subagent-driven; a branch ficou segurada (sem push) até o usuário liberar, aí a
  migração 0019 foi aplicada + push (0020 veio logo depois).

## 14. Sessão 2026-07-14 (parte 2) — Domínio próprio no ar

`https://shopfloor.enterplak.com.br` **no ar com SSL** (Let's Encrypt, válido até out/2026), servido
pelo Vercel. Passo a passo do que funcionou:

- **DNS do `enterplak.com.br` é gerenciado na Locaweb** (nameservers `ns1/ns2/ns3.locaweb.com.br`) —
  não no Registro.br nem no FTP (`ftp.enterplak.hospedagemdesites.ws`, que é só arquivos). O painel
  certo é `painelhospedagem.locaweb.com.br` → Domínios, e a **Zona de DNS** em
  `painel-dns.locaweb.com.br/shopfloor.enterplak.com.br`.
- O `shopfloor` já existia como **subdomínio "Conteúdo de pasta"** (apontava pro IP da Locaweb
  `186.202.150.79`). Na Zona de DNS, a entrada **`.`** (= o próprio `shopfloor.enterplak.com.br`) foi
  trocada para **A → `76.76.21.21`** (IP oficial anycast do Vercel). **CNAME não serve** nessa entrada
  porque `.` é topo de zona (tem NS/SOA) — por isso A record.
- No Vercel (Settings → Domains) o domínio foi adicionado (Production). Após o DNS propagar, o Vercel
  validou (ele mostra "DNS Change Recommended" sugerindo um CNAME novo
  `dd98f00371df4db9.vercel-dns-017.com`, mas isso é só recomendação — o A record `76.76.21.21`
  funciona; o próprio Vercel diz "will continue to work") e emitiu o SSL sozinho.
- Ajuste do **tipo de subdomínio** na Locaweb: evitar "Conteúdo de pasta" e "Redirecionamento" (este
  redirecionava pro `shop-floor-blush.vercel.app/home`, errado); o correto para apontar pra fora é
  **"Apontamento"**.
- Verificação (via `dig`/`curl`/`openssl`): DNS resolve `76.76.21.21`; `https` responde `307 → /login`,
  `server: Vercel`, cert `CN=shopfloor.enterplak.com.br` emissor Let's Encrypt.
- **Pendente:** **Supabase → Authentication → URL Configuration** — Site URL `https://shopfloor.enterplak.com.br`
  + Redirect URLs `https://shopfloor.enterplak.com.br/**`, e testar login no domínio novo. Limpeza
  opcional: sobrou um CNAME `shopfloor` na zona (virou `shopfloor.shopfloor...`, inofensivo).

**Armadilha registrada:** o menu lateral do app é montado por constantes DENTRO de `app-shell.tsx`
(`RECEBIMENTO`, `CONFIG_*`), NÃO pelo `recebimento-nav.ts` — que era código morto e foi removido.

---

## 15. Sessão 2026-07-15 — Domínio concluído, apresentação e o novo roadmap

### Fechamento do domínio próprio
**Supabase → Authentication → URL Configuration** ajustado: **Site URL** =
`https://shopfloor.enterplak.com.br`; **Redirect URLs** = o domínio novo + o `vercel.app`
(fallback) + `localhost:3000` (dev). **Login testado e funcionando** no domínio novo →
domínio 100% concluído.

### Ajustes antes da apresentação
- **Etiquetas — coluna "Nº":** mostrava `indice+1` (a posição na lista), não o número do
  processo. Corrigido trazendo `numero` no SELECT e criando `ProcessoEtiquetaLista`
  (infra = domínio + `numero`) — o tipo do domínio ficou **sem campo de UI** e os testes
  não mudaram. Corrigiu a tabela desktop e o card mobile.
- **Barra de rolagem no topo** da tabela de processos (`ScrollHorizontalTopo`): barra
  "espelho" sincronizada com o overflow nativo do `Table`, some sozinha sem overflow.

### Material de apoio da apresentação
`docs/apresentacao/qa-e-seguranca.md` — Q&A provável + notas de segurança, baseado no
código real:
- **SQL injection: risco essencialmente nulo** — não há SQL dinâmico (o único `format()`
  monta mensagem de log); tudo passa pelo cliente Supabase (valores como parâmetros); RPCs
  com parâmetros tipados. O risco real era **injeção no filtro do PostgREST** (a string do
  `.or()`), **tratado** por `sanitizarTermoBusca` com testes por caractere, nos 3 caminhos.
  Defesa de fundo: **RLS**.
- **Limitar por IP:** Vercel Firewall exige plano pago; middleware do Next dá pra fazer hoje
  (protege só o app). ⚠️ **Conflito:** a foto pela câmera quebraria para quem está no 4G.
  Recomendação: login + perfis + RLS + auditoria já são a camada que importa; IP é reforço.

### A reunião → novo roadmap (decisões travadas em `memory/roadmap-pos-reuniao.md`)
Ordem acordada: **importação → grid Processos → grid Etiquetas → mapeamentos reutilizáveis
→ fotos**. Descartado: *"quantidade recebida 0 → zerar data de chegada"*.
**Descoberta importante sobre fotos:** o pedido "salvar em servidor separado, no banco só o
caminho" **já é a arquitetura atual** (Supabase Storage + `path` na tabela; nenhuma foto no
banco). O usuário vai decidir se quer outro servidor (interno = precisaria de agente local,
desaconselhado; Drive via API = a "v2" já prevista).

### Importação: data de chegada digitada + Nº EMB do arquivo — ✅ EM PRODUÇÃO
- **Data de chegada** deixou de ser mapeável e passou a ser **digitada** no Passo 2
  (bloco "Dados desta importação"), aplicada a **todas** as linhas. **Nº EMB** vem dos
  **8 primeiros caracteres do nome do arquivo** (`EMB341EA - ESTADOS UNIDOS.xlsx` →
  `EMB341EA`), pré-preenchido e editável. Ambos **saíram do mapeamento**.
- **Obrigatoriedade reusa o que já existia:** o switch "Obrigatório na importação"
  (Configurações → Campos) passou a valer para os campos digitados — nada novo foi criado.
- **Sem migração.** Domínio novo: `CAMPOS_DIGITADOS` + `numeroEmbDoArquivo` e
  `prepararLinhasImportacao` (moveu a montagem das linhas do wizard para o domínio).
- **Regra crítica virou teste:** os valores fixos são aplicados **depois** da checagem de
  linha vazia — senão as dezenas de linhas em branco do fim da planilha virariam processos.

### Grid de Processos (o grande) — quebrado em 3 fases; Fase 1 desenhada
- **Fase 1 (spec+plano prontos):** cada campo = coluna (39 no catálogo), ordenar A→Z/Z→A e
  **filtrar por coluna imitando o Excel** (busca **e** checkbox), **tudo no servidor** —
  requisito explícito: *filtrar na página 1 tem que achar o que estaria na "página 10"*.
  Accordion por mês **sai**; o mês vira filtro da coluna Data Chegada (por isso ela entra
  nas **11 colunas padrão**). Layout em tabela nova `colunas_lista` (separada da config dos
  campos). Estado na URL (`?g=`) validado por domínio com whitelist. **Seletor de linhas por
  página** (25/50/100/200) — destravou a definição de volume que não chegou.
- **Fases 2 e 3:** tela admin de layout; setas seguindo a ordem do grid (hoje a RPC
  `processos_vizinhos` tem `ORDER BY` fixo — dívida declarada).
- ⚠️ **Índices:** a tabela só tem em `status`/`importacao_id`; `ilike` faz varredura. Se o
  volume crescer, entra migração de índices (+ `pg_trgm`).
