# Design — ShopFloor Enterplak: Configurações & Logs (Plano 2)

**Data:** 2026-07-07
**Status:** Aprovado para planejamento
**Relaciona-se com:** `2026-07-07-fundacao-recebimento-design.md` (spec macro, Seção 6) e o Plano 1 (Fundação), já concluído.

Este é o **Incremento seguinte à Fundação**: as telas de administração que dão ao
Admin controle total pela interface, e a tela de auditoria (Logs). É a primeira vez
que a infraestrutura de Logs ganha escritores reais.

---

## 1. Escopo

**Dentro:** telas de **Usuários, Perfis, Listas, Campos, Logs** e **Sobre**.
**Fora (Plano 3):** histórico de **Importações** (não há importações até o módulo de
Recebimento).

Todas as telas exigem a permissão **`administrar`** (exceto a leitura de Logs, que
segue a matriz — ver 4.5). O acesso é decidido no banco (RLS, já existente) e reforçado
por um guard de UI.

---

## 2. Decisões desta rodada

- **Criação de usuários:** o app cria a conta no Supabase Auth (e-mail + senha
  definidos pelo Admin) via **admin API (service-role, server-side)** e já atribui o
  perfil. Operadores de fábrica nem sempre têm e-mail corporativo → criação direta é
  mais prática que convite.
- **Perfis:** o Admin **cria/edita/exclui** perfis customizados, além de editar as
  flags dos 4 base (que têm `sistema=true` e **não** são excluíveis).
- **Exclusão de usuários:** **não há exclusão física** — apenas ativar/desativar
  (`usuarios.ativo`), preservando auditoria e integridade de FKs.

---

## 3. Arquitetura & pontos transversais

Segue as camadas da Fundação (`app/` fino → `modules/<feature>/{domain,application,infra}`).

### 3.1 Layout e guard de Configurações
- `src/app/(app)/configuracoes/layout.tsx`: sub-navegação (Usuários, Perfis, Listas,
  Campos, Logs, Sobre) + **guard `administrar`**. Se `podeFazer(perfil,'administrar')`
  for falso, redireciona para `/home`. (O RLS é o portão real; o guard evita renderizar.)

### 3.2 Padrão por tela
- **Leitura:** Server Component busca via `createServerSupabase()` (sob RLS).
- **Escrita:** **Server Actions** finas em `modules/<feature>/application/actions.ts`
  que validam permissão + payload e delegam a `infra/<x>-repository.ts`.
- Componentes de tabela/formulário em `shared/ui` (shadcn), reutilizáveis.

### 3.3 Infra de Logs (primeiros escritores)
- `modules/logs/application/registrar-log.ts`:
  `registrarLog({ entidade, entidadeId, acao, descricao, dados })` — grava um `logs`
  com `usuario_id = auth.uid()` e `usuario_nome` (snapshot da sessão), respeitando o
  RLS de logs (`with check (usuario_id = auth.uid())`).
- `modules/logs/domain/diff.ts`: `calcularDiff(antes, depois, campos)` →
  `{ campo, de, para }[]`, guardado em `logs.dados` nas ações `alterar_campo`.
- **Toda mutação** das telas de Configurações chama `registrarLog` (criar/alterar/
  excluir/mudar_status conforme o caso).

### 3.4 Segurança do service-role
- A criação de usuário usa `createServiceSupabase()` (service-role, **ignora RLS**).
  Portanto a Server Action **verifica `administrar` em código** (via `getSessao`)
  antes de tocar no service-role. Defesa em profundidade.

---

## 4. Comportamento das telas

### 4.1 Usuários (`configuracoes/usuarios`)
- **Listar:** nome, e-mail, perfil, ativo (join `usuarios`×`perfis`).
- **Criar:** form (nome, e-mail, senha, perfil) → `auth.admin.createUser({ email,
  password, email_confirm: true, user_metadata: { nome } })`; o trigger cria a linha em
  `usuarios` (perfil Consulta); a action então ajusta `perfil_id` e `nome`. Log `criar`.
- **Editar:** nome, perfil, ativo. Log `alterar_campo` (com diff).
- **Redefinir senha:** `auth.admin.updateUserById(id, { password })`. Log `alterar_campo`
  (sem registrar a senha em si — apenas o evento).
- **Ativar/Desativar:** alterna `ativo`. Log `mudar_status`.
- **Salvaguarda anti-lockout:** o Admin não pode **desativar a si mesmo** nem **rebaixar
  o próprio perfil** para um sem `administrar`.

### 4.2 Perfis (`configuracoes/perfis`)
- **Listar:** nome + as 8 flags + `sistema`.
- **Editar flags** de qualquer perfil; **criar** (nome + flags); **excluir** apenas
  `sistema=false`.
- **Salvaguarda anti-lockout:** bloquear salvar uma alteração que **remova `administrar`
  do próprio perfil** do usuário logado.
- Log em todas as mutações.

### 4.3 Listas (`configuracoes/listas`)
- **CRUD de `listas`** (chave única + nome); `sistema=true` não excluíveis.
- Ao abrir uma lista: gerenciar `lista_itens` — adicionar, editar `valor`, **reordenar**
  (`ordem`), ativar/desativar. Log em todas as mutações.

### 4.4 Campos (`configuracoes/campos`)
- `configuracao_campos` agrupado por `grupo`. Editar: `rotulo`, `tipo` (texto↔lista),
  `lista_chave` (obrigatório quando `tipo=lista`; deve referenciar uma `listas.chave`
  existente), `obrigatorio_importacao`, `obrigatorio_finalizacao`, `ordem`, `ativo`.
- `campo` e `origem` são **estruturais** (não editáveis).
- Log em todas as mutações.

### 4.5 Logs (`configuracoes/logs`)
- Tabela **somente-leitura**, ordenada por `created_at desc`, com **paginação
  server-side** e **filtros**: entidade, ação, usuário, período (intervalo de datas).
- Fica sob Configurações e exige **`administrar`** (coerente com o guard do layout —
  Seção 3.1). A escrita/edição é impossível (imutável, garantido por RLS + trigger).

### 4.6 Sobre (`configuracoes/sobre`)
- Estático: versão do sistema e informações da Enterplak.

---

## 5. Tratamento de erros
- Server Actions retornam resultado tipado (`{ ok } | { erro }`) → toasts na UI.
- Erros da admin API (e-mail duplicado, senha fraca) são traduzidos para mensagens
  claras em pt-BR.
- Validações de permissão e payload no servidor, independentes da UI.

## 6. Testes (Vitest)
- `calcularDiff` (domínio) — casos com/sem alteração, múltiplos campos.
- Regras de **salvaguarda anti-lockout** (usuários e perfis) — funções puras testáveis.
- Validação de payload/permissão das Server Actions (onde houver lógica além de CRUD).
- CRUD puro é coberto por build/tipos + revisão.

## 7. Fora de escopo
- Histórico de Importações (Plano 3).
- Auditoria avançada / exportação de logs (futuro).
- Perfis com permissões além das 8 flags atuais (YAGNI).
