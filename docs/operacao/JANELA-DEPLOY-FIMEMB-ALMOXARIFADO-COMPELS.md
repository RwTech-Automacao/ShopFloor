# Janela de deploy: Fim de EMB + Almoxarifado + integração com o Compels

Três pacotes entram **na mesma janela**, com **um único deploy do app no fim**. Este arquivo só diz a **ordem** e quais passos de cada
runbook rodar; os comandos estão nos runbooks.

| Pacote | Runbook | Migrações |
|---|---|---|
| Fim de EMB (Alertas do Recebimento) | `fim-de-emb/DEPLOY-FIM-DE-EMB.md` | 0149, 0150, 0151 |
| Almoxarifado + fila do Compels | `almoxarifado-compels/DEPLOY-ALMOXARIFADO-COMPELS.md` | 0128, 0132, 0129, 0130, 0131, 0133, 0153 |
| Teste da OP 8649 | `almoxarifado-compels-teste-op8649/TESTE-OP-8649.md` | (nenhuma; cenário de dados) |

## Por que o banco primeiro e o app uma vez só

O app novo precisa das funções e tabelas novas; o app **velho** funciona com o banco novo (os pacotes foram feitos assim). Então: **todas as
migrações primeiro, depois o app**. Fazer o deploy do app no meio (por exemplo no passo 9 do Fim de EMB) deixaria a tela do Almoxarifado quebrada
até as migrações dele entrarem.

## Antes da janela

1. Smoke local do Almoxarifado feito e comentado por você (`ShopFloor-ensaio/ROTEIRO-SMOKE-ALMOX.md`).
2. `feat/posto-almoxarifado` **mergeada na `main`** e a **`main` empurrada** (os runbooks leem de `origin/main`).
3. Testes da `main` passando.

## Ordem na janela

1. **Fim de EMB, passos 1 a 7** (ler `ALERTAS_LIBERADO_PARA`, anotar o commit, extrair, conferir, copiar, **aplicar 0149–0151**, reiniciar o rest).
   O passo 1 já foi lido (`*`); com a trava do Recebimento isso **não** bloqueia (ver a nota no runbook). Antes do deploy, a linha
   `ALERTAS_RECEBIMENTO_LIBERADO_PARA=gptropa@rwtech.com.br` entra no `.env.production`.
2. **Fim de EMB, passo 8 (SMTP)**, se for usar o e-mail agora.
3. **Almoxarifado, passos 1 a 6** (o passo 1 anota o commit de antes em outro arquivo: `~/antes-almox.txt`; é o mesmo commit do `~/antes-fimemb.txt`
   se nada mudou no meio), **conferir, copiar, aplicar as sete migrações, reiniciar o rest**.
4. **Almoxarifado, passo 7** (variáveis do Compels no `.env.production`; `COMPELS_OPS_LIBERADAS` fica **vazia**).
5. **Deploy do app, UMA vez** (passo 8 do Almoxarifado = passo 9 do Fim de EMB). Conferir a linha `==> deploy OK -> <sha>`.
6. **Verificações:** a seção "Verificação em produção" do Fim de EMB e o **passo 9 (smoke)** do Almoxarifado. **Não arme o crontab.**
7. **Permissões:** na tela de Perfis, dê ao **seu** perfil `recebimento.lancar` (Recebimento) e confira que ele tem `shopfloor.visualizar`.
8. **Teste da OP 8649:** siga o `TESTE-OP-8649.md`.

## Se algo der errado (ordem inversa)

1. **O app primeiro:** volte ao commit anotado em `~/antes-almox.txt` (e rode o `deploy.sh` nele).
2. Depois o **`03-rollback.sql` do Almoxarifado**.
3. Por fim o **`03-rollback-0149-0151.sql` do Fim de EMB**, se o problema for dele.

Cada rollback assume que o app já voltou. Eles não dependem um do outro, mas a ordem inversa evita deixar uma função ausente para o app novo.
