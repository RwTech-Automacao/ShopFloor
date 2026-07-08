# Promover o primeiro Administrador

Todo novo usuário criado no Supabase Auth nasce com o perfil **Consulta**
(trigger `on_auth_user_created` → `handle_new_user`). Para promover o primeiro
Administrador, rode uma vez no SQL Editor do Supabase (ou via
`supabase db query --linked "..."`):

```sql
update public.usuarios
set perfil_id = (select id from public.perfis where nome = 'Administrador')
where email = 'EMAIL_DO_ADMIN';
```

A partir daí, esse Administrador gerencia os demais usuários pela própria
interface (módulo Configurações › Usuários — Plano 2).

## Criar um usuário para testar o login

1. No painel Supabase → **Authentication › Users › Add user** (defina e-mail e senha).
   O trigger cria automaticamente a linha em `public.usuarios` com perfil Consulta.
2. Faça login em `/login`. Com perfil Consulta, a barra lateral mostra **Home** e
   **Recebimento** — sem **Configurações**.
3. Rode o `update` acima para promover a Administrador e recarregue: **Configurações**
   passa a aparecer (valida o RBAC ponta a ponta).
