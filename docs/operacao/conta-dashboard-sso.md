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

⚠️ **Girar o segredo NAO revoga quem ja entrou.** O cookie de sessao do `@supabase/ssr` carrega o
**refresh token**: quem rodou o `/embed/sso` por fora do navegador (um `curl` com um token
assinado) ficou com uma sessao que **se renova indefinidamente**, sem passar mais nenhuma vez
pelo `/embed/sso`. Trocar o segredo fecha a porta de entrada e deixa quem esta dentro, dentro.

Os tres passos sao **obrigatorios**, nesta ordem:

1. **Desativar a conta** — corta o acesso de quem **ja esta** dentro na proxima requisicao
   (o app checa `ativo` a cada acesso):

   ```sql
   update public.usuarios set ativo = false
    where email = 'dashboard@enterplak.com.br';
   ```
2. **Revogar as sessoes no GoTrue** — mata os refresh tokens vivos, pra que a sessao nao se
   renove nem volte depois que a conta for reativada. No Supabase Studio: Authentication > Users
   > a conta > *Sign out user* (ou a API admin `POST /auth/v1/admin/users/<id>/logout`). Sem este
   passo, reativar a conta ressuscita o acesso do vazamento.
3. **Girar `DASHBOARD_SSO_SECRET`** (ShopFloor e Dashboard, juntos) — impede **novas** entradas
   com o segredo vazado. So isso: nao mexe em nenhuma sessao existente.

Depois, para voltar ao normal: `ativo = true` de novo e novo build/deploy dos dois lados com o
segredo novo.

### O que a conta alcanca enquanto esta de pe

**Nao e "somente o ShopFloor".** O perfil da a flag **global** `pode_visualizar`, que e o que os
RPCs do Fluxo exigem (eles checam a `tem_permissao('visualizar')` de **1 argumento**). Hoje **9**
policies de SELECT ainda usam essa forma, e **tres sao de outro sistema**:

| Tabela | O que a conta consegue ler |
|---|---|
| `repinmetro_logs` | logs de teste de qualidade dos repinmetros (~52 mil linhas): nº de serie, modelo, datas, status e os 15 resultados de teste por linha |
| `repinmetro_revendas` | o serial de cada REP **ligado a razao social da revenda** — a relacao produto ↔ cliente final |
| `repinmetro_producao` | os seriais de cada peca montada (impressora, MRP, modulo bio, RFID, fonte, barras) + 12 resultados de teste |

As outras 6 sao do proprio ShopFloor (`sf_caixas`, `sf_lotes`, `sf_consertos`,
`sf_conserto_confirmado`, `sf_ordem_burnin`, `sf_registros_cancelados`).

**Fora de alcance** (ja migradas para a forma por modulo): o **Recebimento inteiro** — processos,
importacoes, anexos **e os arquivos no Storage** (migracoes 0051 e 0057) —,
**Setup/Abastecimento**, a tabela **`logs`** de auditoria e os **Alertas** (migracao 0054). E a
conta **nao escreve nada**: nenhuma policy de INSERT/UPDATE/DELETE e alcancavel so com
`visualizar`.

**A cura** e trocar as policies `repinmetro_logs_select`, `repinmetro_revendas_select` e
`repinmetro_producao_select` para a forma de 2 argumentos
(`tem_permissao('repinmetro','visualizar')`), ou migrar os 8 RPCs do Fluxo para a forma por
modulo. As duas mexem em tela de producao: **outra branch**, nao esta.
