# Conta do Dashboard (SSO do /embed)

O iframe do Dashboard entra no ShopFloor com **uma conta compartilhada, somente leitura**.
A conta **nao nasce de migracao**: precisa existir no GoTrue (`auth.users`) **e** em
`public.usuarios`. Faca isto uma vez por ambiente (Dev, Prod/AWS).

Pre-requisito: a migracao `0140_perfil_dashboard_somente_leitura.sql` ja aplicada no banco do
ambiente (cria o perfil "Dashboard (somente leitura)").

## Regras da conta

- E-mail: `dashboard@enterplak.com.br` (o mesmo valor de `DASHBOARD_SSO_EMAIL`).
- Entra **so por SSO**. **Nao tem senha utilizavel**: ninguem faz login com ela na tela normal.
- Perfil: **"Dashboard (somente leitura)"** — apenas `shopfloor: visualizar`.
- `ativo = true`.
- `senha_provisoria = false` (veja abaixo).

## Passo a passo

1. **Criar no GoTrue.** No Supabase Studio do ambiente: Authentication > Users > Add user >
   *Create new user*, e-mail `dashboard@enterplak.com.br`, marcar *Auto Confirm User*.
   Senha: gere uma aleatoria longa so para o formulario aceitar e **descarte** (nao anote, nao
   compartilhe). Ela nunca sera usada. Se precisar de outro metodo (API admin), pergunte ao
   Matheus pelas credenciais — nao as coloque aqui.
2. **Linha em `public.usuarios`.** O gatilho `on_auth_user_created` cria a linha sozinho, com o
   perfil padrao "Consulta". Confira que ela existe; se nao existir, crie com o mesmo `id` do
   `auth.users`.
3. **Atribuir o perfil.** Pela tela de usuarios do ShopFloor (como administrador) escolha
   "Dashboard (somente leitura)" e deixe **ativo**. Ou, no SQL Editor:

   ```sql
   update public.usuarios
      set perfil_id = (select id from public.perfis where nome = 'Dashboard (somente leitura)'),
          ativo = true,
          senha_provisoria = false
    where email = 'dashboard@enterplak.com.br';
   ```
4. **`senha_provisoria` tem que ser `false`.** A coluna nasce `true` por padrao. Com `true`, o
   app manda o usuario para a tela de troca de senha, o que **trava o fluxo do iframe** (o
   usuario nao tem senha para trocar). O middleware foi ajustado para nao redirecionar dentro de
   `/embed`, mas o estado da conta ainda importa: deixe `false` (o `update` acima ja faz isso).

## Como conferir

```sql
select u.email, u.ativo, u.senha_provisoria, p.nome as perfil, p.pode_visualizar,
       (select array_agg(pp.modulo || ':' || pp.permissao)
          from public.perfil_permissao pp where pp.perfil_id = p.id) as grants
  from public.usuarios u join public.perfis p on p.id = u.perfil_id
 where u.email = 'dashboard@enterplak.com.br';
```

Esperado: `ativo = true`, `senha_provisoria = false`, `perfil = Dashboard (somente leitura)`,
`pode_visualizar = true`, `grants = {shopfloor:visualizar}` (e nada mais).

Teste de ponta a ponta: abrir o Fluxo da OP no Dashboard. Deve carregar. Qualquer tela de
lancamento/configuracao do ShopFloor deve ficar inacessivel para essa conta.

## Se o segredo do SSO vazar

Gire `DASHBOARD_SSO_SECRET` (ShopFloor e Dashboard, juntos) e, se quiser, desative a conta
(`ativo = false`). O perfil ja limita o dano a leitura do ShopFloor.
