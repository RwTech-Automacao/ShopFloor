# Cada usuário define a própria senha — Design

## Objetivo

Trocar o fluxo atual (o gestor cria a conta **com senha** e passa a senha na mão) por
**senha temporária + troca obrigatória no 1º acesso**: o gestor cria a conta, o sistema gera
uma senha temporária mostrada **uma vez**, e a pessoa define a **própria senha** ao entrar.
Reset de senha continua sendo pelo gestor. Sem dependência de email.

## Contexto atual

- `criarUsuarioAuth({email, password, nome})` cria a conta via `auth.admin.createUser` com
  `email_confirm: true` (email não é verificado — não há envio de email configurado). Hoje o
  **gestor digita a senha** e a repassa manualmente.
- `atualizarSenha(id, password)` (admin/service-role) já existe — base do reset.
- A **sessão** já carrega a linha de `usuarios` (checa `ativo`, `perfil_id`) no middleware
  (`src/shared/lib/supabase/middleware.ts`) e em `get-sessao`.
- Login é por **email + senha**; a pessoa loga com o email dela (só não precisa *receber* nada).

## Decisões (aprovadas)

1. **Senha temporária por pessoa (não uma padrão única).** No cadastro e no reset, o sistema
   **gera uma senha temporária aleatória** (~10 caracteres, alfabeto legível sem ambíguos
   `0/O/1/l/I`) e a mostra **uma única vez** pro gestor copiar e entregar. Sem segredo
   compartilhado → sem o furo de "qualquer um entra numa conta não ativada".
2. **Troca obrigatória no 1º acesso.** A conta nasce marcada como **provisória**; enquanto
   estiver provisória, a pessoa é levada obrigatoriamente à tela "Defina sua nova senha" e
   **não acessa mais nada** até trocar. Ao definir, a marca cai.
3. **Reset pelo gestor.** Botão "Resetar senha" na tela de Usuários gera nova temporária
   (mostrada uma vez), remarca a conta como provisória → a pessoa troca no próximo acesso.
4. **Regra da senha nova:** mínimo **8 caracteres**, sem outras regras (usabilidade no chão de
   fábrica).
5. **Contas atuais não são afetadas:** as 6 contas + admin nascem como **não provisórias** no
   backfill da migração (já têm senha real).

## Arquitetura

### Marca de "provisória"
- Coluna nova **`usuarios.senha_provisoria boolean not null default true`**. Migração faz
  `update ... set senha_provisoria = false` nas linhas existentes (contas já configuradas). O
  **default true** garante que toda conta nova (criada pelo trigger `handle_new_user`) já nasça
  provisória sem código extra.

### Domínio (TDD)
- `gerarSenhaTemporaria(): string` — aleatória, tamanho fixo, alfabeto seguro (sem ambíguos).
  Testes: tamanho e conjunto de caracteres; duas chamadas diferem.
- `validarForcaSenha(senha): { ok: boolean; erro?: string }` — mínimo 8. Puro, TDD.

### Cadastro (gestor)
- A action de criar usuário passa a **gerar** a temporária (não recebe senha do gestor),
  cria a conta com ela, e **devolve a senha temporária** pra UI mostrar uma vez. O form perde o
  campo de senha; ganha um estado de sucesso com a temporária + botão copiar + aviso "não será
  mostrada de novo". A conta fica provisória por padrão.

### Reset (gestor)
- Action `resetarSenha(id)`: gera temporária, `atualizarSenha(id, temp)` (admin), marca
  `senha_provisoria = true`, devolve a temporária pra mostrar uma vez.

### Troca pela própria pessoa
- Rota própria **`/definir-senha`** (fora do app-shell — sem menu, já que ela ainda não pode
  usar o sistema): form "nova senha + confirmar".
- Action `definirNovaSenha(nova)`: valida sessão + `validarForcaSenha`; troca a senha com o
  **cliente do próprio usuário logado** (`supabase.auth.updateUser({ password })` — não precisa
  service-role); depois marca `senha_provisoria = false` na linha do usuário (via service-role,
  escopo `id = auth.uid()`). Redireciona pra home.

### Enforcement (middleware)
- O middleware, que já valida a sessão e carrega a linha de `usuarios`, passa a carregar também
  `senha_provisoria`. Se `true` e o caminho **não** for `/definir-senha` (nem logout/estáticos),
  **redireciona pra `/definir-senha`**. Se `false` e a pessoa está em `/definir-senha`,
  redireciona pra home (evita ficar presa lá).

## Segurança

- `senha_provisoria = false` só pode ser setado pela própria pessoa (via action com
  service-role escopada a `auth.uid()`, depois de trocar a senha) ou pelo gestor no reset (que
  seta `true`). O operador comum **não tem** `administrar`, então não consegue mexer nisso pela
  API normal (a coluna não entra em `atualizarUsuario`, que exige `administrar` via RLS).
- A temporária trafega **uma vez** pro gestor (autorizado) na resposta da action — nunca é
  relistada nem persistida em claro (o Supabase Auth guarda só o hash).

## Fora de escopo

- "Esqueci minha senha" por email (fica o reset pelo gestor).
- Expiração/rotação periódica de senha; 2FA; política de complexidade além do mínimo de 8.
- Envio de email / SMTP.

## Testes

- **TDD** nas funções puras (`gerarSenhaTemporaria`, `validarForcaSenha`).
- **Sem TDD** na UI/middleware — garantia por tsc + lint + build + smoke.
- **Smoke:** (1) gestor cria conta → vê a temporária uma vez; (2) logar com a temporária cai na
  tela "Defina sua nova senha" e não acessa mais nada; (3) definir a nova → entra normal e não
  volta a ser barrado; (4) gestor reseta → a pessoa é barrada de novo no próximo acesso; (5)
  contas existentes (admin) **não** são forçadas a trocar.
