# Teste em produção: OP 8649 → Almoxarifado → Compels (rodando à mão)

**Objetivo:** com a OP 8649 (PMO **PRT446**, a mesma do Compels), bipar uma peça na tela nova do Almoxarifado, **rodar a entrega à mão**
(sem cron), conferir no Compels, e devolver a resposta do servidor para ajustarmos a mensagem de sucesso e o card do Fluxo. Depois, rodar o
script que puxa o **saldo do estoque**.

**Nada aqui arma o cron.** Quem esvazia a fila é um comando que **você** roda. A integração só mexe na OP que estiver em `COMPELS_OPS_LIBERADAS`.

Tudo roda **na instância Lightsail**, no terminal, **um comando por vez, colado como está**. A senha do banco é **digitada** no prompt
`Password:` (nunca em comando, nunca no chat). Os arquivos de apoio estão na `main` em `docs/operacao/almoxarifado-compels-teste-op8649/`.

## 0. Antes de começar

- O deploy do `DEPLOY-ALMOXARIFADO-COMPELS.md` já foi feito (migrações 0128–0133 e 0153 aplicadas, app novo no ar, variáveis do Compels no
  `.env.production`, **crontab NÃO armado**).
- O seu usuário tem, no perfil, **`recebimento.lancar`** (Recebimento) **e `shopfloor.visualizar`** (Fluxo de Processos). Atribua pela tela de Perfis.
- No Compels, a OP 8649 (PRT446) está **sem apontamento nem requisição** (estornada, como no fim do teste anterior) e **sem empenho**.

## 1. Buscar os arquivos e conferir a OP 8649 (só leitura)

```bash
cd ~/ShopFloor && git fetch origin main && for f in 01-conferir-op-8649 02-montar-cenario 03-desmontar-cenario; do git show origin/main:docs/operacao/almoxarifado-compels-teste-op8649/$f.sql > /tmp/op8649-${f%%-*}.sql; done && git show origin/main:tools/compels/saldo-item.mjs > /tmp/saldo-item.mjs && ls -1 /tmp/op8649-0*.sql /tmp/saldo-item.mjs && HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && echo "HOST ok"
```

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/op8649-01.sql
```

**Olhar:** o item 1 deve vir **vazio** (a OP 8649 não existe no ShopFloor). Se existir, com cliente real e registros de verdade, **PARE e me mande a saída**:
o cenário não pode ser montado em OP real (o passo 2 recusa sozinho).

## 2. Montar o cenário (cria uma OP de teste)

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/op8649-02.sql
```

Cria a OP **8649 / PRT446** de teste (cliente `TESTE INTEGRACAO COMPELS`), rota **Embalagem → Almoxarifado**, e **5 peças já embaladas**:
`TST864900001` a `TST864900005`. Se não houver posto de Almoxarifado, cria o posto. **Olhar:** "Cenário pronto" e, no fim, 1 OP, a rota e `Embalagem | 5`.

## 3. No Compels: empenhar 5 unidades

Na OP **8649**, aba **Empenhar**, empenhe **5** unidades (não 1.000: o RWPC99 tem só 79 em estoque e um empenho maior fica **"Pendente"**, o que a
integração recusa). Confira que a situação ficou **"Empenhada"**. **Feche a tela da OP** no seu navegador depois (a gravação pega a trava da OP).

## 4. Liberar só a OP 8649 para a integração

```bash
cd ~/ShopFloor && (grep -q '^COMPELS_OPS_LIBERADAS=' .env.production && sed -i 's/^COMPELS_OPS_LIBERADAS=.*/COMPELS_OPS_LIBERADAS=8649/' .env.production || echo 'COMPELS_OPS_LIBERADAS=8649' >> .env.production) && grep '^COMPELS_OPS_LIBERADAS=' .env.production && pm2 restart shopfloor --update-env
```

**Olhar:** imprime `COMPELS_OPS_LIBERADAS=8649`.

## 5. Bipar uma peça na tela nova

1. Abra **Recebimento › Almoxarifado** (`/recebimento/almoxarifado`).
2. No campo "Bipe o Nº de Série para carregar a OP", digite `TST864900001` e Enter. O **Colaborador** vem preenchido com o seu usuário
   (não dá para editar) e o **Posto** vem fixo em Almoxarifado.
3. No campo "Bipe a peça ou a caixa", digite `TST864900001` e Enter. Esperado: painel verde, **1 peça**.
4. (Opcional) bipe `TST864900002` e `TST864900003` para termos 3 linhas na fila.

**Olhe o Fluxo da OP 8649** (`/shopfloor/fluxo`): o card do Almoxarifado, e quanto ele mostra de "aguardando o ERP". **Olhe a tela de pendências**
(`Análise › Estoque pendente`): as linhas devem aparecer como pendentes. **Tire print das duas telas.**

## 6. Rodar a entrega à mão (o "script") e devolver a resposta

Primeira vez, crie o arquivo de cabeçalho com o segredo (sem imprimir nada):

```bash
printf 'Authorization: Bearer %s\n' "$(grep -E '^ESTOQUE_CRON_SECRET=' ~/ShopFloor/.env.production | cut -d= -f2- | tr -d "'")" > ~/.estoque-cron-header && chmod 600 ~/.estoque-cron-header && grep -c 'Bearer .' ~/.estoque-cron-header
```

Deve imprimir `1`. Agora a rodada de entrega:

```bash
curl -sS -m 100 -X POST -H @$HOME/.estoque-cron-header http://127.0.0.1:3000/api/shopfloor/estoque; echo
```

**Esta é a resposta do servidor que você devolve para mim.** O esperado com 1 peça: `{"enviados":1,"falhas":0,"aguardando":0}`.
Depois, o log da rodada (não tem segredo):

```bash
pm2 logs shopfloor --lines 60 --nostream 2>&1 | grep '\[estoque\]'
```

**Me mande:** a resposta do `curl`, as linhas `[estoque]` do log e os prints do passo 5 (antes) e outro do Fluxo e da tela de pendências **depois**
da rodada. É com isso que ajustamos a mensagem de sucesso e o que o card do Fluxo deve mostrar.

## 7. Conferir no Compels

Na OP 8649: **Requisição nº 1** e **Apontamento nº 1** (de 1 unidade, **responsável "Engenharia Integração"**), no estoque **PA**, locação **Padrão**.
Abra o apontamento e olhe a **Observação**: deve ter `ShopFloor ALMOX/PRT446/8649/...` (a chave da peça). Se bipou mais peças, repita a rodada
(passo 6): cada peça vira uma requisição + um apontamento.

## 8. Puxar o saldo do estoque

```bash
read -rp 'Usuário do ezpointweb: ' COMPELS_EZPOINT_USUARIO && read -rsp 'Senha do ezpointweb: ' COMPELS_EZPOINT_SENHA && echo && export COMPELS_EZPOINT_USUARIO COMPELS_EZPOINT_SENHA && node /tmp/saldo-item.mjs PRT446 --json; unset COMPELS_EZPOINT_USUARIO COMPELS_EZPOINT_SENHA
```

Imprime o saldo (estoque próprio, pendência, em terceiros) e uma linha JSON. **Cole a saída para mim** (não tem segredo). O estoque próprio é o de
**todos** os estoques do item. A ideia é mostrar isso também no card "Concluído": vamos decidir juntos depois de ver o número.

## 9. Variações (opcionais, uma por vez)

- **OP aberta por alguém no Compels:** abra a OP 8649 na tela do Compels, bipe outra peça e rode a rodada. Esperado: `aguardando` sobe, nada é gravado, e a tela de
  pendências mostra a situação "Esperando o Compels" com o motivo "Este registro está sendo acessado pelo usuário...". Feche a tela e rode de novo **depois de uns 5 minutos** (a linha em espera
  volta sozinha na hora marcada, que a tela de pendências mostra; o botão Reenviar só serve para linha que gastou as 5 tentativas).
- **Cancelar um lançamento já enviado:** em `Registros` (gestor), cancele a peça. Na tela de pendências aparece a "Saída (estorno)" com
  "O estorno no Compels ainda é manual".

## 10. Desmontar

1. **No Compels**, estorne **na ordem**: **apontamento(s), requisição(ões), empenho**.
2. Tire a OP da integração:

```bash
cd ~/ShopFloor && sed -i 's/^COMPELS_OPS_LIBERADAS=.*/COMPELS_OPS_LIBERADAS=/' .env.production && grep '^COMPELS_OPS_LIBERADAS=' .env.production && pm2 restart shopfloor --update-env
```

3. Apague o cenário do ShopFloor (a OP de teste, as peças e a fila):

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/op8649-03.sql
```

**Olhar:** `ordens 0 | registros 0 | fila 0`. Remova os arquivos temporários: `rm -f /tmp/op8649-0*.sql /tmp/saldo-item.mjs`.

## O que fazer se algo sair diferente

**Não repita o comando.** Me mande a saída exata (sem senha) e o que a tela mostrou. Se a rodada responder `falhas: 1`, o motivo está no log
(`[estoque] envio ... falhou: ...`) e na coluna de erro da tela de pendências.
