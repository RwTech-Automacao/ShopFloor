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

## 16. Grid de Processos — Fase 1 (construída; **segurada**, aguardando smoke)

**Estado:** 7 tasks executadas via subagent-driven (review por task + review final Opus +
fix wave). Commits **locais** `8debef7..37e124f`; **push não feito** — o usuário valida o
smoke antes. ⚠️ **A migração 0021 já está aplicada em produção** (o banco mudou; só o
código está segurado): `colunas_lista` com 39 linhas / 11 visíveis, RPC
`valores_distintos_processos` funcionando nos dois ramos, e coluna inválida levantando
exceção (whitelist eficaz).

**O que a Fase 1 entrega:** a tela de Processos virou planilha. Catálogo de 39 colunas
(`configuracao_campos` + `numero`/`status`), **11 visíveis por padrão** (as 8 de antes +
Número + **Data Chegada** + Status). Cada cabeçalho tem menu estilo Excel: **ordenar
A→Z/Z→A**, **busca por texto** e **lista de valores com checkbox** (carregada sob demanda).
**Tudo no servidor** — o requisito central do usuário: *filtrar na página 1 tem que achar o
que estaria na "página 10"*. Rodapé com paginação e **seletor de linhas por página**
(25/50/100/200) — que destravou a definição de volume que nunca chegou. O accordion por mês
saiu; o **mês virou filtro da coluna Data Chegada** (o checkbox lista meses via `rotuloMes`,
traduzidos para faixas de data na consulta).

**Arquitetura:** estado do grid na URL (`?g=`) validado por domínio (`estado-grid.ts`, TDD)
— coluna fora do catálogo é descartada, e essa é a whitelist que protege a consulta. Layout
em `colunas_lista`, **separado** de `configuracao_campos` (a Fase 2 cria a tela de editar).
Consulta via PostgREST, sem SQL dinâmico; a RPC de valores distintos é o único SQL dinâmico
do projeto (whitelist via `information_schema` + `%I`, tipo resolvido **antes** de montar o
SQL). Sem biblioteca de grid.

### O que o review final (Opus) pegou — 2 críticos, ambos do plano
1. **`decodeURIComponent` duplo.** O Next já entrega o `?g=` decodificado, e decodificávamos
   de novo. Filtrar por `50%` lançava `URIError` → caía no `catch` → **apagava a ordenação e
   todos os filtros, em silêncio**. Pior: `%41CME` decodificava para `ACME` e filtrava a
   coisa errada, calado. **Lição:** o `catch` que existia para "param adulterado" estava
   mascarando **entrada legítima**.
2. **Busca de texto em coluna não-textual derrubava a rota.** A caixa de busca aparecia em
   todas as colunas, mas `numero` (bigint) e `data_chegada` (date) — **2 das 11 visíveis** —
   não têm `ilike`. Resultado: 400 do banco → `page.tsx` sem try/catch e sem `error.tsx` →
   tela de erro, com o link quebrado (o estado mora na URL). Corrigido em 3 camadas (esconder
   a busca, ignorar no repositório, e try/catch na página).

Também no fix wave: checkbox de Status passou a falar pt-BR (`rotuloStatusProcesso`) e as
células de data passaram a mostrar dd/mm/aaaa (sem `new Date()`, por causa do fuso).

### Dívidas registradas (follow-up)
- 🔴 **As setas ‹ › hoje não respeitam NEM busca/status** — o grid linka para o detalhe sem
  query, então `buscarVizinhos` roda sem filtro. A dívida da **Fase 3** é maior que a
  declarada originalmente ("só a ordenação").
- `carregarProcessosGrid` nasceu **sem chamador** (a `page.tsx` chama `listarProcessosGrid`
  direto) — remover ou ligar.
- `sanitizarTermoBusca` remove `,.()` demais no contexto do `.ilike` (buscar "ACME S.A." não
  acha) — ela foi escrita para a sintaxe do `.or()`.
- Limpeza da Task 6 ficou pela metade: `condicaoBuscaProcesso`, `COLUNAS_BUSCA_PROCESSO`,
  `montarGrupos`, `chaveMes`, `listarValoresStatus` e `ProcessoResumoRow` ficaram sem
  consumidor.

## 17. Grid de Etiquetas — sub-filtro estilo planilha (spec + plano; execução em andamento)

Item 3 do roadmap. Depois da busca principal das etiquetas (Nº NF / Nº embarque / Fornecedor,
teto 500 linhas, **intocada**), o **resultado** ganha um **sub-filtro estilo Excel** nas
colunas **Nº, Status, Código, Pedido, Doc**: cada uma com **ordenar A→Z/Z→A**, **busca por
texto** e **checkbox de valores**.

**Decisão de arquitetura — CLIENT-SIDE.** Ao contrário do grid de Processos (base ilimitada →
tudo no servidor), aqui o resultado já veio limitado a ≤500 linhas e já está no navegador. O
sub-filtro é uma **função pura de domínio** que recebe as linhas + o estado do sub-filtro e
devolve as linhas filtradas/ordenadas. **Sem servidor, sem migração, sem URL.** Reusa só os
primitivos **Popover/Checkbox** (que nasceram nos commits locais do grid de Processos) — logo
esta feature **empilha em cima** daquela e, no push, sai junto.

**Regras travadas:** Doc é acessor derivado (`diInpi || numeroNf`); Status filtra pelo valor
cru mas o checkbox exibe o rótulo pt-BR (`rotuloStatusProcesso`); a **seleção persiste por id**
— o sub-filtro só **esconde** linhas, nunca desmarca; "Selecionar todos (elegíveis)" e o
contador passam a operar sobre as **linhas visíveis**; é efêmero (reseta ao refazer a busca);
**só no desktop** (os cards mobile iteram as visíveis mas sem menu — sub-filtro no card fica
para o pacote de responsividade do fim). Volumes e Prévia não ganham menu.

**Domínio (TDD):** `src/modules/etiquetas/domain/sub-filtro.ts` — `valoresDistintosSub`
(distintos, ordenados, sem vazios) e `aplicarSubFiltro` (texto case-insensitive; checkbox de
valores; ordenar Nº **numérico**, resto por `localeCompare` pt-BR; **vazios sempre no fim**,
mesmo em desc; não muta a entrada). UI: `MenuColunaEtiqueta` no `etiquetas-cliente.tsx`,
reusando Popover/Checkbox.

Spec: `docs/superpowers/specs/2026-07-15-grid-etiquetas-design.md`. Plano:
`docs/superpowers/plans/2026-07-15-grid-etiquetas.md` (3 tasks: domínio → UI → verificação).
Execução **subagent-driven**, **sem push** (usuário valida o smoke; e o grid de Processos, base
desta, ainda está segurado aguardando aprovação do superior). **APROVADO no smoke** — push
segurado para ir junto com o grid.

## 18. Padrões de mapeamento reutilizáveis na importação (construído; **segurado**)

Item 4 do roadmap, escolhido por ser 100% independente da aprovação do grid. Na importação,
salvar o de-para de colunas (`Record<campo, coluna>` dos mapeáveis) com um nome e reaplicá-lo
em planilhas futuras (pré-preenchido), tudo no **Passo 2 do wizard** (componente `BarraPadrao`).

**Decisões:** compartilhado (quem importa gerencia, admin também; RLS `importar`/`administrar`);
casar por **nome normalizado** (reusa `normalizarNome`, isolado no domínio → trocável para exato
depois sem migração) usando o nome REAL da coluna atual; **aplicar substitui** o mapeamento
inteiro; exige **≥1 coluna** e nome válido; **nome único** case-insensitive (Postgres 23505 →
"Já existe um padrão com esse nome."); nunca guarda `data_chegada`/`numero_emb` (digitados).

**Camadas:** migração `0022_padroes_importacao` (tabela JSONB + índice `lower(nome)` + RLS) →
domínio `padrao-importacao.ts` (TDD: `aplicarPadrao` + `nomePadraoValido`) → infra
`padrao-importacao-repository.ts` (CRUD PostgREST) → Server Actions `padroes-importacao.ts` →
UI (`page.tsx` carrega, `wizard-importacao.tsx` ganha a barra).

**Os reviews adversariais pegaram 2 bugs reais (corrigidos):**
1. `processarArquivo` não zerava `padraoSelecionadoId`/`colunasNaoEncontradas` ao carregar outra
   planilha — o Select apontava um padrão que não correspondia mais e **"Atualizar" sobrescreveria
   o padrão salvo com o mapeamento da planilha errada** (corrupção de dado compartilhado).
2. `salvarPadrao`/`atualizarPadrao` contavam `{campo: ''}` (vindo de "Não mapear") como coluna
   válida → salvaria um padrão vazio e a reaplicação mostraria um aviso falso de "coluna não
   encontrada". `mapeamentoLimpo()` filtra os `''` antes de validar/persistir.

**Migração 0022 JÁ aplicada em produção** (verificada); código **local, sem push** (commits
`dc21934..6804359`). O smoke fica com o usuário; o push vai junto com o grid + etiquetas.
Spec/plano em `docs/superpowers/{specs,plans}/2026-07-16-padroes-importacao*`.

Ajustes pós-smoke (aprovados): copy da barra alinhada para "mapeamento" ("Adicionar novo
mapeamento", "Atualizar mapeamento", "Mapeamentos salvos"); o `Select.Value` do base-ui ganhou
render function porque exibia o valor cru (o id/uuid, "só alguns caracteres") em vez do nome; e
"Nenhum" no seletor passou a **desmarcar os campos** (mapeamento `{}`) além de soltar a seleção.

## 19. Retrato do projeto (2026-07-16) — status, pendências e a escolha das Fotos

**29 commits locais aguardando push** (`origin/main..HEAD`), nada enviado. Empacotados:
- **Grid de Processos Fase 1** — 9 commits — aguardando **aprovação visual do superior**.
- **Grid de Etiquetas** (sub-filtro) — 7 commits — aprovado no smoke.
- **Padrões de mapeamento** — 13 commits — aprovado no smoke.

As migrações **0021** (grid) e **0022** (padrões) já estão na produção; só o código está
segurado. Um `git push` sobe os 29 de uma vez, quando o superior liberar o grid.

**Pendências, ordenadas (estimativas grosseiras):**
- *Independente de aprovação:* (1) **Modais do sistema** — trocar os 7 `window.confirm` nativos
  do navegador por um `ConfirmDialog` próprio (primitivos `dialog.tsx`/`sonner.tsx` já existem),
  ~2–3h; (2) **Ambiente Dev × Prod** — Supabase de dev pras migrações não irem direto na prod,
  ~2–4h + ação do usuário; (3) **#5 Fotos em servidor** — ~1–2 dias se for Google Drive API,
  precisa da decisão do "onde".
- *Depende da aprovação do grid:* (4) **Grid Fase 2** layout admin ~4–6h; (5) **Grid Fase 3**
  setas seguindo ordem/filtros ~5–7h (maior que o declarado — setas hoje não respeitam nem
  busca/status); (6) **Grid responsivo em cards** ~3–5h.
- *No fim:* (7) **Responsividade** (pacote único, tela a tela) ~1 sessão; (8) **Índices**
  (numero/data_chegada/pg_trgm) ~1h quando o volume crescer.

**Melhoria levantada pelo usuário (ponto 7):** as confirmações usam o `window.confirm` do
navegador (feio, sem a identidade do sistema) — 7 telas. Vira o item "Modais do sistema" acima.

**Decisão:** o usuário escolheu **as Fotos em servidor** como próximo (agrega mais valor). Entra
em brainstorm — falta travar QUAL servidor (provável Google Drive/opção B) e o fluxo.

## 20. Fotos no R2 — construído/segurado + bloqueio do cartão (2026-07-16)

A feature das Fotos no Cloudflare R2 foi **construída e revisada** (subagent-driven, 5 tasks +
polish; review final opus = PRONTO PARA MERGE). Arquitetura: porta `ArmazenamentoFotos` +
adapters R2 (ativo) e Supabase (dormente = plano B), env `FOTOS_STORAGE=r2|supabase` escolhendo
o adapter E a visibilidade do export/limpeza. Bucket privado, URL assinada curta, sem migração
de banco, sem duplicar foto, chave UUID. Polish: `requestChecksumCalculation: 'WHEN_REQUIRED'`
(compat R2, evita erro conhecido do aws-sdk) + `server-only` no adapter. Commits locais
`488fe79..24e7952`; verde (tsc / 164 testes / build). Spec/plano em
`docs/superpowers/{specs,plans}/2026-07-16-fotos-r2*`.

**Bloqueio no setup:** o usuário criou a conta Cloudflare (Account ID
`67fa332454b1469fac827924de9412c1`), mas o **R2 exige cartão de crédito** mesmo no plano
grátis. Ele não quer pôr cartão agora e pediu alternativa S3 sem cartão.

**Insight-chave (e resposta ao "o que é S3"):** "S3" é um produto da AWS (armazenamento de
objetos em "buckets"), mas a API dele virou um **padrão de fato** — por isso existe storage
"S3-compatível" de vários provedores. Como nosso adapter foi escrito com o SDK do S3, ele
funciona com **qualquer** provedor S3-compatível (R2, AWS S3, Backblaze B2, Storj, iDrive e2,
Wasabi, MinIO...) só trocando endpoint + credencial — nenhuma reescrita.

**Caminhos sem cartão:** (a) Backblaze B2 (10GB grátis) e Storj (25GB grátis), ambos
S3-compatíveis e provavelmente sem cartão (verificar no cadastro); (b) o pragmático — rodar em
`FOTOS_STORAGE=supabase` por enquanto (adapter já pronto, sem cartão, 1GB, com export/limpeza
pra gerir a cota) e flipar pra R2/B2/S3 depois com uma env. A abstração foi feita pra isso.

## 21. Fotos no Google Drive — setup OAuth concluído (2026-07-16)

O adapter Drive (Seção 20 / spec-plano `2026-07-16-fotos-drive*`) foi conectado a uma conta
Google real. Setup feito com o usuário, passo a passo:
- Projeto Google Cloud `shopfloor-fotos`; **Google Drive API** ativada.
- Tela de consentimento OAuth: tipo **Externo**, escopo **`drive.file`** (aparece como "não
  confidencial" — menos burocracia), usuário de teste `matheusrwtech@gmail.com`.
- Cliente OAuth "ShopFloor Web" (Web app) com redirect `developers.google.com/oauthplayground`.
- **Refresh token** gerado via **OAuth Playground** (com as próprias credenciais + escopo).
- Pasta **`ShopFloor Fotos`** no Drive.
- As 4 credenciais (`GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN/DRIVE_FOLDER_ID`) + `FOTOS_STORAGE=drive`
  ficam no **`.env.local` (local, gitignored)** — nunca no repo.

**Encanamento verificado** por um script throwaway (subir → baixar → apagar um arquivo na
pasta): **funcionou** — confirmando que o escopo `drive.file` consegue escrever numa pasta
criada pelo usuário (dúvida que eu tinha, resolvida). Falta só o **smoke na UI** (anexar foto
num processo, ver aparecer via a rota proxy, conferir na pasta, excluir).

Nota importante: o refresh token do modo "teste" expira ~7 dias; para produção, pôr as env na
Vercel e fazer a **verificação única** do app no Google para estabilizar. Como está tudo atrás
da porta `ArmazenamentoFotos`, trocar para R2/S3/Supabase depois é uma variável de ambiente.

**SMOKE APROVADO (2026-07-16):** o usuário anexou foto num processo → subiu pro Drive e
apareceu no card; excluiu → sumiu do card e da pasta. Confirmado com ele que o banco
(`anexos_processo`) guarda só metadado + `path` (= file ID do Drive no modo drive), nunca a
foto. Registro de teste antigo (path estilo Supabase, com "/") foi limpo; a tabela ficou
zerada. Fotos no Google Drive = **entregue e validado** (segurado, sem push). Para produção:
env `GOOGLE_*` + `FOTOS_STORAGE=drive` na Vercel + verificação única do Google (token de teste
expira ~7 dias).

## 22. PUSH — tudo em produção (2026-07-17)

**49 commits enviados** (`8debef7..eb5aaad`), com aprovação do usuário. Subiram de uma vez:
Grid de Processos Fase 1, Grid de Etiquetas (sub-filtro), Padrões de mapeamento da importação,
e as Fotos (porta `ArmazenamentoFotos` + adapter R2 dormente + adapter Google Drive). As
migrações 0021 e 0022 já estavam aplicadas na produção.

**Bug pego na hora do push (o método valendo de novo):** o default do `FOTOS_STORAGE` era
`r2`. Como essa env **não existe na Vercel**, o deploy cairia no adapter do R2 — que **não tem
credencial em produção** — e **quebraria as fotos**: as existentes sumiriam da tela (o
`listarAnexosComUrl` tolera falha por foto e omite) e o upload falharia. Corrigido antes de
subir: **default = `supabase`** (o storage histórico, o único cujas credenciais sempre existem
em qualquer ambiente); `r2` e `drive` passam a exigir **opt-in explícito** por env.
**Lição:** o default de uma configuração tem que ser o caminho que funciona **sem configuração
extra** — não o que está "na moda" no momento do desenho.

**Estado da produção:** as fotos continuam no **Supabase Storage** (exatamente como antes, com
a tela de export/limpeza visível). O **Google Drive está pronto e validado**, mas só entra no ar
quando setarem `FOTOS_STORAGE=drive` + as 4 `GOOGLE_*` nas Environment Variables da Vercel — e,
antes disso, convém **publicar o app OAuth** (o escopo `drive.file` é *não confidencial*, então
publicar não exige a verificação pesada) para o refresh token parar de expirar a cada 7 dias.

## 23. Fotos no Google Drive — ATIVAS EM PRODUÇÃO (2026-07-17)

Fecha o item 5 do roadmap (o último dos grandes). Sequência executada com o usuário:

1. **App OAuth publicado** (Google Auth Platform → Público-alvo → "Enviar para produção").
   Publicou **sem verificação**, porque o app não tem logotipo, não tem 10+ domínios e usa
   apenas o escopo **`drive.file`**, que é **não confidencial**. Status: "Em produção".
   *É este passo que faz o refresh token parar de expirar a cada 7 dias.*
2. **Refresh token novo gerado** pelo OAuth Playground — obrigatório, porque o token de ontem
   fora emitido enquanto o app estava em "Teste" e carregaria a validade de 7 dias. Confirmado
   que veio diferente do anterior e **testado por script** (subir → baixar → apagar na pasta).
3. **5 env na Vercel** (ambiente Production): `FOTOS_STORAGE=drive` + `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID` → **redeploy**.
4. **Validado no ar:** foto anexada num processo sobe pro Drive, aparece no card, e o
   "Exportar Fotos" some do menu (sinal de que o modo `drive` pegou).

**Resultado:** as fotos saíram do Supabase Storage — a **cota de 1 GB do Free deixou de ser um
problema**, que era a motivação original. O Supabase (com export/limpeza) e o R2 continuam no
código como plugins dormentes: trocar de storage é **uma variável de ambiente**.

**Ponto didático da sessão:** variáveis de ambiente **não viajam com o código**. O `.env.local`
é local e gitignored; a Vercel tem o próprio conjunto. Por isso "configuramos o Drive ontem" e
ainda assim a produção seguia no Supabase — cada ambiente decide o seu storage, e nenhum
segredo fica no repositório.

## 24. Grid Fase 2 — Colunas da Lista, EM PRODUÇÃO (2026-07-17)

Tela **Configurações → Recebimento → "Colunas da Lista"** (`/configuracoes/colunas`): o admin
escolhe quais colunas aparecem no grid de Processos e em que ordem, sem depender de dev.
Commits `6641c76..c9e0a11` (push `870ce58..c9e0a11`). **Sem migração** — a `colunas_lista` já
existia desde a 0021; a Fase 1 só lia dela, agora existe quem edita.

**Decisões:** duas listas — **Visíveis** (ordem do grid, setas ↑↓, "Ocultar") e **Disponíveis**
(ocultas, A→Z, "Mostrar" → entra no fim). **`numero` e `status` sempre visíveis** (cadeado +
badge) **mas reordenáveis**. Salvar em bloco com indicador de "não salvas". Reordenar com
**setas, sem lib nova** (arrastar exigiria dependência de ~30KB para tarefa rara de admin).
Antes de codar, um **mockup interativo** foi publicado e aprovado pelo usuário.

**Arquitetura:** o cliente manda **só `visiveis: string[]`** (ordenado); o servidor carrega o
catálogo (whitelist) e o domínio puro `normalizarLayout` (TDD, 9 testes) **deriva** o resto —
força as fixas, numera 1..N, ocultas depois. Três camadas de defesa: RLS (`administrar`) +
a action revalida a sessão + whitelist do servidor. Audita (`registrarLog`) e
`revalidatePath('/recebimento/processos')`.

**O review final pegou 1 Importante (corrigido):** só o botão *Salvar* desabilitava durante a
gravação — editar nesse meio-tempo fazia o `setSujo(false)` mentir **"Tudo salvo"** com o banco
no estado antigo e a edição presa na tela (divergência silenciosa). Fix: setas/Ocultar/Mostrar
travados enquanto salva. Menores: `.order('campo')` desempata uma linha órfã reativada;
`role="img"` no cadeado.

**Nota de ambiente:** o `npm run build` estoura a memória nesta máquina (7,6 GB) quando o
`next dev` está de pé — o dev sozinho segura ~3,1 GB. Hábito: **matar o dev antes do build**,
ou usar `NODE_OPTIONS=--max-old-space-size=4096`. Isso é custo de desenvolvimento apenas: em
produção (Vercel, serverless) o app roda pré-compilado, sem servidor segurando RAM.

## 25. Grid Fase 3 — setas seguindo o grid, EM PRODUÇÃO (2026-07-17)

Fecha o item 2 do roadmap (grid completo: Fase 1 lista, Fase 2 colunas, Fase 3 setas).
Push `8463b6b..598fea2`; migração 0023 aplicada **depois** do deploy.

**O problema:** as setas ‹ › do detalhe **mentiam**. Chamavam a RPC `processos_vizinhos`
(0016), duplamente obsoleta: ORDER BY fixo da ordem do accordion por mês (que não existe
desde a Fase 1) e parâmetros `p_busca`/`p_status` da lista antiga. E o grid linkava sem
contexto nenhum — então elas navegavam TUDO, na ordem velha, ignorando filtro e ordenação.

**A solução:** o link da linha leva `?g=<estado do grid>&i=<posição global>`; o detalhe
decodifica (whitelist do catálogo), busca os ids com a **mesma consulta da lista**
(`montarQueryGrid`, extraído e compartilhado — divergir virou estruturalmente impossível) e
um domínio puro (`vizinhosDaLista`, TDD) calcula os vizinhos. Sem `?g=` cai no padrão do
grid (setas vivas). Se o processo **sai do filtro** (você o finalizou), usa a posição
guardada: a lista encolheu 1, então quem estava em `i+1` está em `i` → é o próximo da fila.
Atravessa página naturalmente. RPC aposentada (0023).

**O review final pegou 2 Importantes que o controller deixou passar:**
1. **O teto de 5000 era ficção.** O PostgREST tem `max_rows = 1000` e **corta a resposta**,
   então o guard por `ids.length` **nunca dispararia**: acima de 1000 processos a lista viria
   truncada e as setas morreriam em silêncio — o caso exato que o teto existia para cobrir.
   Agora o teto é 1000 (amarrado ao `max_rows`) e a detecção usa o **`count` do banco**.
2. **Ordenação sem desempate.** Sem chave de desempate, colunas com valores repetidos
   (status, fornecedor, data) saem em ordem não-determinística: a consulta paginada (top-N)
   e a de ids (sort completo) podiam resolver os empates diferente → a seta levaria ao
   processo errado, quebrando a promessa da feature. A RPC antiga *tinha* `numero desc` como
   desempate — foi uma perda de determinismo. **Bônus: o fix conserta a paginação do grid**,
   que desde a Fase 1 podia repetir/omitir linha entre páginas (bug pré-existente em prod).

Menores corrigidos: fail-safe passou a cobrir `carregarCatalogoColunas` (falha nele derrubava
o detalhe com 500); "Voltar para Processos" preserva ordem/filtros; `cache()` em
`carregarCamposFormulario` (passara a rodar 2x por página).

**Lição de ordem de deploy:** o plano mandava aplicar a migração após o review, mas a RPC
ainda era chamada pelo código **em produção** — dropar antes do push desabilitaria as setas à
toa. Ordem certa (executada): **push → deploy → DROP**. Janela zero.

## 26. Modais de confirmação — EM PRODUÇÃO (2026-07-17)

Trocados os **7 `window.confirm`** nativos do navegador por um modal com a identidade Enterplak.
Push `6bcf378..25102c3`. 100% frontend — sem migração, sem servidor.

**O desafio:** `window.confirm` é síncrono (`if (!confirm()) return`); um modal é assíncrono. A
solução foi um hook **`useConfirmacao`** (`src/components/ui/confirm-dialog.tsx`) que devolve
`confirmar(): Promise<boolean>` + o `{dialog}` a renderizar. Cada tela troca ~1 linha
(`window.confirm(...)` → `await confirmar({ titulo, descricao? })`, a função vira `async`) e
renderiza `{dialog}`. A quebra assíncrona fica escondida no hook (guarda o `resolve` da Promise
numa ref; Confirmar → resolve(true); Esc/fora/X via onOpenChange → resolve(false)).

Aparência **sóbria** (decisão do usuário): botão confirmar em vinho Enterplak, sem vermelho nem
ícone de alerta. Reusa o `Dialog` do base-ui.

As 7 telas: criticidade, lista, item de lista, perfil (Configurações); remover foto, apagar
mês de fotos, excluir mapeamento (Recebimento). Nuances: "Remover foto" e "Apagar" usam
`rotuloConfirmar` próprio; a mensagem multi-linha do exportar-fotos virou título+descrição; no
wizard o `{dialog}` fica no container raiz (existe em qualquer passo). Escopo travado: só as 7
exclusões.

## 27. Planejamento de escala — próximos passos (2026-07-17)

Conversa de priorização depois de fechar o grid completo, os modais e o Drive. Ritmo esperado
pelo usuário: **~centenas de processos/mês** (passa de 1.000 em poucos meses; 10.000 em 1–2 anos;
hoje 289). Sequência combinada: **(1) ajuste das setas → (2) responsividade → (3) explicar
índices**. Dev×Prod e keyset/índices ficam pra depois.

**Setas (escala):** o teto de 1.000 é FUNCIONAL, não de performance, e degrada bem — só trava a
navegação SEM filtro; qualquer filtro derruba o conjunto abaixo de 1.000. Fix barato: `listarIdsGrid`
passa a buscar em BLOCOS de 1.000 (o `max_rows` do PostgREST) e para ao acabar a lista ou ao
atingir `TETO_VIZINHOS` (5.000). Caso comum (<1000) = 1 requisição, idêntico a hoje. NÃO mexer no
`max_rows` global (toda query sem paginação passaria a devolver 10k). Pré-requisito já garantido: o
desempate `.order('numero')` da Fase 3 (sem ele os blocos se sobreporiam).

**Índices:** sem índice o banco faz varredura sequencial (lê todas as linhas). Com 289 é
instantâneo; só pesa a partir de ~5.000–10.000 linhas. Busca `ilike '%x%'` nem usa índice comum
(precisa pg_trgm). Importa bem mais tarde — vira projeto junto com o keyset (1–2 anos).

**Responsividade — retrato real (melhor que o previsto):** QUASE TUDO já é responsivo (tabela↔card):
toda a Configurações, Etiquetas (busca), histórico, Importações, e o shell. Só **2 telas** não têm
card: o **Grid de Processos** (a mais trabalhosa — ordenar/filtrar mora no cabeçalho, precisa de
barra "Ordenar/Filtrar" no topo) e a **tabela de resultados do sub-filtro das Etiquetas**. Além
disso, mover o corte de 768→1024 (pra tablet-em-pé cair em card). Pacote médio/focado, não grande.

**Dev×Prod:** decisão do usuário — por último, montado a partir de um retrato limpo da prod no
momento de entrar dado real (migrar direto na prod só é perigoso com dado real; hoje é grátis errar).

## 28. Responsividade — pacote final, EM PRODUÇÃO (2026-07-17)

Fechou a responsividade do sistema. Push `c41dc33..dad629d` (4 commits), aprovado no smoke do
usuário. Execução subagent-driven (Task 1 haiku, 2–3 sonnet), review por task + review amplo do
branch (opus) = PRONTO PARA MERGE. Verde: tsc / lint (só o warning `<img>` pré-existente) / build
(23 páginas). Spec/plano: `docs/superpowers/{specs,plans}/2026-07-17-responsividade*`. Sem migração,
sem servidor — 100% apresentação.

**Corte 768→1024 (`md`→`lg`) em todo o sistema.** Troca cirúrgica: só as duas classes que fazem o
switch tabela↔card (`space-y-3 md:hidden`→`lg:hidden` no bloco de cards; `bg-card md:block`→
`lg:block` no bloco de tabela). Nenhum outro `md:` foi tocado — em especial `md:grid-cols-4` da
grade de fotos em `anexos-processo.tsx` ficou intacto. Efeito: tablet em pé agora cai em card, não
mais na tabela.

**Card do Grid de Processos** (`processos-grid.tsx`, abaixo de 1024). A tabela existente foi
envolvida em `hidden lg:block`; um bloco `lg:hidden` novo traz (a) uma **barra de chips** que reusa
o MESMO componente `MenuColuna` — nova prop `comoChip` estiliza o trigger como pílula (ativo/ordenando
em vinho), zero lógica de filtro/ordenação nova; e (b) o subcomponente `CardProcesso`: Nº como título
+ Status como badge no topo, as demais colunas visíveis como lista `rótulo···valor` com tracejado
(um `<span>` `flex-1 border-b border-dotted -translate-y-1` entre `dt` e `dd`), teto de 6 colunas
(`CAP_COLUNAS_CARD`) + botão "ver mais/menos". O card inteiro é um `<Link>` com o MESMO `?g=&i=` das
setas → abrir um processo e navegar com as setas continua funcionando. O rodapé de paginação ficou
fora dos dois blocos (serve tabela e card).

**Card das Etiquetas** (`etiquetas-cliente.tsx`). Diferente do que a spec inicial supôs, o card
mobile das Etiquetas JÁ existia — o trabalho foi um upgrade: corte md→lg, **barra de chips** com os
`MenuColunaEtiqueta` (`comoChip`), que torna o sub-filtro usável no celular (antes só no cabeçalho
da tabela desktop), Status como badge no topo e o corpo convertido para o mesmo tracejado. O checkbox
de seleção e toda a lógica de gerar etiqueta ficaram intactos.

**Review amplo pegou 2 Menores (corrigidos no commit `dad629d`):** (1) regressão real — no card das
Etiquetas o motivo pelo qual um item é inelegível passou a truncar em 55% (`truncate`), escondendo do
usuário POR QUE o checkbox está desabilitado; agora esse caso quebra linha e aparece inteiro; (2)
plural "ver mais 1 coluna" (era "1 colunas").

**Dívida Menor aceita (usuário mandou manter):** o botão "ver mais" fica dentro do `<Link>` do card
do Grid — conteúdo interativo dentro de `<a>` é HTML tecnicamente inválido, mas funciona porque o
`onClick` faz `e.preventDefault()` (o Next `Link` respeita `defaultPrevented`). Alternativa registrada
se um dia incomodar: padrão stretched-link (card vira `<div>`, um `<a absolute inset-0>` cobre a área
de navegação, o botão fica irmão com `z-10`). Também ficou anotado que a string Tailwind da pílula
está duplicada em `MenuColuna` e `MenuColunaEtiqueta` — candidata a um helper compartilhado se a
duplicação virar risco de divergência.

**Lição:** ao converter uma lista `dl` densa para um layout mais enxuto, cuidado com `truncate` em
campos que carregam informação de estado (o "porquê" de algo estar bloqueado) — economizar espaço
escondendo a explicação é uma regressão silenciosa, não um ganho de layout.

## 29. Cada usuário define a própria senha (2026-07-20)

Trocamos o fluxo "o gestor cria a conta **com** senha e passa na mão" por **senha temporária
gerada + troca obrigatória no 1º acesso**, com reset pelo gestor. Brainstorm definiu o ponto
crítico: quase todo fluxo de "defina sua senha" depende de **email**, e no chão de fábrica os
operadores têm email mas só os gestores checam com facilidade — então o desenho é **sem email**.
Também travamos "senha temporária **por pessoa**" (não uma padrão única), porque uma padrão
conhecida deixa qualquer um entrar numa conta ainda não ativada e sequestrá-la antes do dono.

**Como ficou.** Coluna `usuarios.senha_provisoria` (default `true` → conta nova nasce provisória
pelo trigger `handle_new_user`, sem código extra; backfill `false` nas 6 contas existentes pra o
admin não travar). Funções puras com TDD (`gerarSenhaTemporaria` — `crypto`, alfabeto sem
ambíguos `0/O/1/l/I`, 10 chars; `validarForcaSenha` — mínimo 8). No cadastro/reset o sistema gera
a temporária e a devolve **uma vez** pra UI mostrar (com Copiar + aviso "não será exibida de
novo"); o form de Usuários perdeu o campo de senha. A pessoa troca com o **próprio cliente
logado** (`auth.updateUser`) numa rota nova **`/definir-senha`** (fora do grupo `(app)`, sem
menu). O **middleware** carrega `senha_provisoria` e prende a conta provisória em `/definir-senha`
até ela trocar (e manda de volta pra `/home` quem já trocou) — como o middleware roda em toda
rota não-estática, isso cobre até os POSTs de Server Action.

**Segurança.** `senha_provisoria=false` só é setado pela própria pessoa (action escopada a
`sessao.usuarioId`, via service-role porque o operador não tem `administrar`) ou pelo reset do
gestor (`=true`). A coluna nunca entra em `atualizarUsuario` (cuja RLS exige `administrar`). A
senha nunca é registrada em log. `resetarSenha(id)` mantém o gate de `administrar`.

**Execução.** Subagent-driven, 5 tasks (migração+domínio TDD → backend → middleware+tela →
form → verificação), review individual limpo em cada uma. **Detalhe de processo:** as Tasks 2–4
formam uma unidade compilável — a Task 2 remove `redefinirSenha` (que o form ainda importava), e
o `tsc` só fica 100% verde na Task 4; avisei os revisores das Tasks 2 e 3 pra não tratarem o erro
esperado do form como defeito. O **review amplo final em subagente foi pulado a pedido do
usuário** (as 4 tasks já tinham review limpo); como controller, confirmei inline os riscos-chave
(ordem de deploy, priv-esc, enforcement). tsc/lint/build/**195 testes** verdes. A migração `0024`
foi aplicada por mim na prod **antes** do push (o middleware faz `select senha_provisoria` — se a
coluna não existisse, derrubaria as rotas; adicionar coluna não quebra o código antigo, então
migração-antes-do-código é a ordem segura).

**Lição:** senha temporária **por pessoa** é quase o mesmo trabalho que uma padrão única, mas
fecha um furo real (sequestro de conta não ativada) — o "mais simples" às vezes é o inseguro. E o
custo do fluxo self-service raramente é a UI; é a **infraestrutura de email** — quando ela não é
confiável pro público-alvo, "temporária + troca no 1º acesso" entrega o mesmo valor sem depender
de nada externo.

## 29. Refactors pós-responsividade + limpeza do banco (2026-07-20)

**Refactors (EM PRODUÇÃO, push `8017fec..a38e95f`):** stretched-link no card do Grid (card vira
`<div>` + `<a absolute inset-0>` cobrindo a navegação + "ver mais" como `<button>` irmão `z-10` —
removeu o interativo aninhado em `<a>` e o `preventDefault` frágil) e helper `classeChipTrigger` em
`src/lib/chip-trigger.ts` (tirou a className da pílula duplicada dos dois grids). Criado
`docs/divida-tecnica.md` — registro vivo do trabalho futuro de escala (índices, keyset — gatilho
~5–10k processos), CVE do `xlsx` (baixo risco: parse client-side, uso interno; correção via CDN da
SheetJS quando/se importar planilha externa com frequência) e Dev×Prod (às vésperas de dado real).

**Toggle "Ocultar incompletos" nas Etiquetas (EM PRODUÇÃO, push `a38e95f..e981a5d`):** esconde os
processos inelegíveis (que não geram etiqueta) da tabela e dos cards, com contador dos ocultos,
desligado por padrão. Filtro client-side sobre o sub-filtro. Feito INLINE (1 arquivo, ~30 linhas) —
lembrete de quando inline vs subagent-driven: inline compensa em mudança pequena/acoplada com o
contexto já carregado; subagent-driven em trabalho grande/multi-arquivo/independente.

**Banco de teste zerado (prod, só dado de teste):** apagados os transacionais — processos (289→0),
importações (7→0), etiquetas geradas (5→0), anexos (já 0), padrões de importação (1→0); sequence
`processos_numero_seq` reiniciada em 1. Mantidos: configuração e as 6 contas. **Logs (288→0)** só
puderam ser apagados porque o USUÁRIO rodou o SQL no SQL Editor do Supabase (role `postgres`) — os
logs são imutáveis por design (triggers `logs_no_delete/update/truncate`), e o classificador do
Claude Code BLOQUEOU (corretamente) eu mesmo desligar o trigger pra apagar. Depois de apagar, os 3
triggers foram religados (verificado). **Lição:** controle de auditoria que a gente construiu de
propósito não deve ser contornado automaticamente — mexer nele é ação de humano, e o classificador
reforça isso.

**Segurança (auditoria de leitura):** injection/`DROP TABLE` estão cobertos estruturalmente — todo
dado do usuário vira parâmetro do PostgREST ou arg tipado de função; o único SQL dinâmico
(`valores_distintos_processos`) valida coluna contra `information_schema`; DDL não é exposto pela
API REST; papéis da API não são donos/superuser; 14 tabelas com RLS; logs imutáveis. Lacunas (não
críticas, anotadas): sem headers de segurança HTTP (CSP etc. — ganho fácil ~1h), sem rate limiting
nas Server Actions, sem MFA. IP allowlist: só faz sentido na conexão direta do Postgres (feature
paga do Supabase), não no endpoint REST que o navegador usa.

## 30. Cada usuário define a própria senha (LOCAL, aguardando smoke — 2026-07-20)

**Estado:** 5 commits locais `19479ed..166b639`, **não pushados**; migração **0024 aplicada na prod**
(controller; backfill verificado — as 6 contas existentes ficaram `senha_provisoria=false`, admin
não trava). tsc/lint/build/195 testes verdes.

**O quê:** troca "gestor cria conta COM senha" por **senha temporária gerada pelo sistema + troca
obrigatória no 1º acesso**; reset pelo gestor. Sem dependência de email (decisão do usuário:
operadores têm email mas só gestores checam com facilidade → fluxo que não precisa enviar nada).
Senha temporária **por pessoa** (não uma padrão única — evita o furo de "qualquer um entra numa
conta ainda não ativada").

**Arquitetura (5 tasks, subagent-driven, review individual por task):** coluna
`usuarios.senha_provisoria` (default true → conta nova nasce provisória pelo trigger
`handle_new_user`; backfill false nas existentes). Domínio TDD `senha.ts` (`gerarSenhaTemporaria` —
crypto, alfabeto sem ambíguos, 10 chars; `validarForcaSenha` — mín 8). Repo
`definirSenhaProvisoria(id,valor)` via service-role. Actions: `criarUsuario` gera a temp e a devolve
uma vez; `resetarSenha(id)` (substituiu `redefinirSenha`, exige `administrar`, remarca provisória);
`definirNovaSenha(nova)` (troca do próprio logado via `auth.updateUser` + limpa a marca com
`sessao.usuarioId`). Middleware carrega `senha_provisoria` e prende a conta provisória na rota nova
**`/definir-senha`** (fora do `(app)`, sem menu) até trocar. Form de Usuários: sem campo de senha;
mostra a temporária **uma vez** (copiar) no cadastro e no reset.

**Ordem de deploy (crítica):** o middleware faz `select senha_provisoria` — a migração TEM que ir
**antes** do código. Adicionar coluna não quebra o código antigo em produção, então a ordem certa é
aplicar a migração primeiro (feito) e só depois o push. Registrado como padrão.

**Review amplo em subagente foi pulado a pedido do usuário** (as 4 tasks já tinham review individual
limpo); o controller confirmou inline os riscos-chave (ordem de deploy; escalonamento de privilégio —
`definirNovaSenha` só age na própria conta e `resetarSenha` exige `administrar`; enforcement — o
middleware cobre até os POSTs de Server Action). Spec/plano:
`docs/superpowers/{specs,plans}/2026-07-20-senha-propria-usuario*`.

**→ Aprovado e EM PRODUÇÃO** (push `e981a5d..8e4ee30`); smoke feito pelo próprio usuário em produção.

## 31. Smoke em produção + correções e ajustes (2026-07-20)

Com a senha própria em produção, o usuário passou a **testar cenários reais** no Prod e trouxe
ajustes e bugs — todos corrigidos e em produção no mesmo dia:

- **"Olho" na tela de definir senha** (`/definir-senha`): botão mostrar/ocultar em cada campo
  (`EyeIcon`/`EyeOffIcon`), padrão `text-muted-foreground/hover-enterplak`. Inline.
- **Bug — senha temporária vazando ao reabrir o dialog:** o botão "Concluir" fecha via `setOpen`
  direto, que **não** dispara o `onOpenChange` (onde a temp era limpa) → a senha de um cadastro/reset
  anterior reaparecia ao reabrir. Fix: limpar a temp em **qualquer transição** do dialog (abrir ou
  fechar). Valia p/ "Novo usuário" e "Resetar senha".
- **Bug — barra de scroll do topo do grid sumindo:** ordenar/filtrar/paginar troca as **linhas** sem
  mexer na caixa do container, então o `ResizeObserver` às vezes não disparava e a barra do topo não
  reaparecia. Fix: `MutationObserver` (re-mede quando o conteúdo muda) + `requestAnimationFrame` +
  re-consulta do container a cada medição.
- **Feature — "Ocultar incompletos" nas Etiquetas:** toggle client-side que esconde os processos
  inelegíveis (não geram etiqueta), com contador de ocultos; desligado por padrão. Filtro sobre o
  sub-filtro (renomeou `linhasVisiveis`→`subFiltradas`, recriou `linhasVisiveis` derivado). Execução
  **inline** (1 arquivo/~30 linhas) + review adversarial rápido. Spec/plano
  `docs/superpowers/{specs,plans}/2026-07-20-ocultar-incompletos-etiquetas*`.
- **Bug (0025) — Importações "Nº de processos" sempre 0:** a RPC `importar_processos` é SECURITY
  INVOKER; o `update total_processos_criados` rodava como o usuário e era **filtrado silenciosamente
  pela RLS** — `importacoes` só tinha policy de INSERT/SELECT, **faltava UPDATE** → coluna no default
  0. O log registrava 129 (é INSERT, tem policy) → foi o que denunciou. Fix: **policy de UPDATE (dono
  da linha)** + backfill. **Verificado end-to-end** simulando usuário autenticado (`set local role
  authenticated` + `request.jwt.claims`). Lição: função SECURITY INVOKER + tabela sem policy de UPDATE
  = update some sem erro.
- **Bug (0026) — Importações "Usuário —" para não-admin:** o nome vinha por join `usuarios(nome)`,
  mas a RLS de `usuarios` só deixa ver o próprio cadastro. Fix: **desnormalizar `usuario_nome`** na
  importação (igual os logs já fazem), gravado pela RPC; a tela lê direto. + backfill.
- **Correção de texto (0027) — "Nº DI/INPI" → "Nº DI/DUINPI":** o rótulo mora no banco
  (`configuracao_campos.rotulo`); migração corretiva + troca em comentários/testes do código.
- **Limpezas de banco de teste (várias):** transacionais por SQL (controller) + reset da sequence;
  **logs pelo usuário no SQL Editor** (imutáveis, precisa desabilitar o trigger como `postgres`);
  e **limpeza da pasta do Drive** — apagar o registro no banco **não** apaga a foto no Drive (só a
  remoção pela tela apaga), então fotos órfãs se acumulam; limpas por script throwaway (`googleapis`).

## 32. Ambiente Dev × Prod + entrega ao time (2026-07-20) — MARCO

Fim do ciclo "pré-dado-real": montamos o ambiente de desenvolvimento e o sistema foi **entregue ao
time**. Detalhe completo do workflow em `memory/dev-prod-workflow.md` e no doc de repo
`docs/ambientes.md`.

- **Decisão de arquitetura (com o usuário):** abordagem manual de **2 projetos Supabase** (Dev +
  Prod), pois o Supabase **não** vai pro plano Pro (sem Branching nativo/PITR). Workflow: **branch →
  desenvolve no Dev → aprova no smoke → aplica no Prod (banco antes do código) → merge → deploy**.
  Regras de ouro: toda mudança de schema é migração aplicada nos **dois** bancos; só o schema precisa
  bater, dados diferem.
- **Setup executado:** projeto Dev criado (`drxmfcrrfzmzjpkvhpjr`, `sa-east-1`, auto-RLS igual Prod);
  **27 migrações aplicadas via `db push`** → schema idêntico; `.env.local` apontando pro Dev (backup
  do Prod em `.env.prod.local`); **pasta Drive própria do Dev** (isolada da produção — mesma conta
  Google, só o folder difere; escrita testada); admin de dev criado via API do Auth (o `supabase-js`
  quebra em Node<22 por WebSocket → `fetch` direto). **Prod verificado intocado** o tempo todo.
- **Cópia da config Prod→Dev:** pra o Dev ter o mesmo ponto de partida, copiamos byte-a-byte as
  tabelas de config de recebimento (`configuracao_campos`, `listas`, `lista_itens`,
  `criticidade_fornecedor`, `tabela_nqa`, `colunas_lista`) via REST (GET no Prod, delete+POST no Dev),
  em ordem pai→filha. **Usuários e processos não copiados.** Ficou idêntico ao Prod.
- **Documentação:** `docs/ambientes.md` (guia dos ambientes + fluxo + backup sem Pro + reset) e
  `docs/visao-tecnica.md` (stack, arquitetura, práticas — "mini-doc pro Notion"), ambos versionados.
- **Entrega ao time:** os 6 usuários do Prod são os **reais**; a entrega é o gestor **resetar as
  senhas** (fluxo senha-temporária) → cada um define a própria no 1º acesso. Prod 100% limpo.
  **Backup-base fica pra quando entrar dado real.** Daqui pra frente: **time usa o Prod; toda
  feature/módulo novo é desenvolvido no Dev** pelo workflow de branch.
- **Preferência registrada:** o usuário quer **aprender fullstack** enquanto construímos os próximos
  módulos → explicar conceitos "pra dev júnior" ao longo do caminho.

## 33. Alinhamento de visão + roadmap de módulos (2026-07-20)

Sessão de **alinhamento estratégico** (em modo plan): entender o negócio e mapear o roadmap, sem
código. Detalhe em `memory/visao-produto-roadmap.md` e no arquivo de plano
`~/.claude/plans/breezy-moseying-hollerith.md`.

- **Quem é a Enterplak:** prestadora de serviços/mão de obra, foco em **montagem de eletrônicos —
  principalmente placas (PCBs)**. O ShopFloor foi contratado para dar **rastreabilidade**.
- **Estado atual da operação:** o "shopfloor" já existe, mas **quebrado** — cada área roda em
  **planilha + formulário isolados**, lento e em parte pouco funcional.
- **Conceito do que construímos:** não é um "app de recebimento", é a **fundação + 1º módulo de uma
  plataforma MES modular**. O valor está na base (sistema de registro confiável com RLS/logs
  imutáveis, config ao processo real, arquitetura modular, Dev×Prod) — o Recebimento é a cabeça de
  ponte.
- **Roadmap Fase 1 (acordado):** **copiar os 3 módulos atuais para software web e deixar
  funcional**, mantendo-os **independentes** (como são hoje): (1) Recebimento ✅; (2) Set up e
  reabastecimento de montagem; (3) Shopfloor processo. O padrão dos módulos 2/3 é
  "planilha-como-banco + formulário" → "tabela Postgres + tela web" (o mesmo do Recebimento).
- **Fase 2 (depois):** integrar os módulos (rastreabilidade fim-a-fim) e otimizar. Construir a
  Fase 1 com fronteiras limpas pra isso ser fácil.
- **Próximo passo:** o **time escolhe o próximo módulo por valor**; quando definirem, o usuário traz
  o material (planilha + formulário) e a gente faz brainstorm → spec → plano → Dev×Prod.
- **Nota de processo:** o **modo plan** do Claude Code foi usado nesta etapa — ele força
  explorar/entender antes, e trava edições (só o arquivo de plano) até a aprovação. Boa prática que
  reforça a cadência; para salvar memória/histórico foi preciso sair do modo plan.

## 34. Módulo ShopFloor Processo — Planos A + B (LOCAL, aguardando smoke — 2026-07-21)

Arranque do **módulo 3 (Shopfloor processo)** — o coração da rastreabilidade. Origem: webapp Google
Apps Script (`Código.gs` + `formulario.html`) sobre a planilha `ShopFloor WebApp.xlsx` (registro de
cada peça por **Nº de Série** ao passar por cada **posto**, por PMO/OP). Recriação no nosso stack.
Decidido fatiar a sub-feature "Fundação + Lançamento" em **3 planos sequenciais** (A: dados; B:
Cadastro de OP; C: Lançamento). Branch `feat/shopfloor-lancamento`. Spec/planos em
`docs/superpowers/{specs,plans}/2026-07-21-shopfloor-lancamento*`.

- **Plano A — Fundação de dados (feito, aplicado no DEV):** migração `0028` — tabelas `sf_postos`,
  `sf_defeitos`, `sf_ordens`, `sf_ordem_postos`, `sf_registros` (+ RLS, permissão nova **`lancar`** e
  perfil de sistema "Produção", seed dos 12 postos); **domínio puro com TDD** (série: parse/faixa/
  normalização; postos: gate de sequência registrado×aprovado; regras por posto + limite de caixa);
  **script `scripts/migrar-shopfloor.mjs`**. Resolvida a inconsistência da coluna **[18] = Inspeção
  SPI** (o header da planilha rotula "Integração" por engano; o `Código.gs` é a verdade). Aplicado
  **só no Dev**: `supabase db push` da 0028 + script → **165 defeitos, 115 OPs ativas, 554
  aplicabilidades** (a aba Defeitos tem 1000 linhas mas só 165 com código; 835 são vazias).
  Spot-check de aplicabilidade bateu. **Prod intocado.** Review amplo (opus): pronto para merge.
- **Plano B — Cadastro de OP (feito, LOCAL):** tela de CRUD de OPs (listar/criar/editar/excluir +
  toggles de "postos aplicáveis"). **Decisão do usuário: é MÓDULO PRINCIPAL**, não Configurações — nova
  seção **"Fluxo de Processos"** no menu lateral (accordion, como o Recebimento), rota
  `/shopfloor/ordens`, page com **guard próprio** de `administrar` (a rota `/shopfloor` não tem layout
  guard). Validação TDD + repositório + server actions (guarda de duplicidade `unique(pmo,op)` e
  guarda de exclusão se houver lançamentos) + a tela. Review amplo (opus): **PRONTO PARA MERGE**, zero
  crítico/importante (segurança em profundidade: gate nas actions + guard da page + RLS). Fix de
  robustez aplicado (exclusão sem rejeição silenciosa; `qtd` NaN→null). Suíte: 223 testes.
- **Decisões registradas:** a **estação** loga no app (compartilhada) e o **colaborador é bipado** por
  cima (log de usuário refinado depois). **OP sem faixa de SN deve BARRAR** o lançamento (Plano C) —
  várias OPs migradas vêm com faixa vazia. Na promoção pro **Prod**: provavelmente **não** bulk-importar
  as OPs (cadastrar via a tela, começar limpo); **defeitos** (catálogo) vale importar. **Dev mantém os
  dados** pra construir/testar B e C.
- **Nota técnica:** o CLI `supabase` neste host precisou do binário `supabase-go` (baixado em
  `~/.local/share/supabase` + `export SUPABASE_GO_BINARY=...`) para o `db push` funcionar; o
  `migration list` (leitura) já funcionava sem ele.
- **Pendências:** smoke do Plano B pelo usuário (dev server no ar, aponta pro Dev). Depois **Plano C
  (Lançamento — o coração):** tela do operador + submit transacional (faixa de SN, gate de sequência,
  anti-duplicidade, caixa) + a permissão `lancar` na UI de Perfis. Sub-features futuras: Grade Geral,
  Dashboard, Integração, Manutenção, Pesquisa, histórico de registros. **Nada pushado/mergeado/em Prod.**
