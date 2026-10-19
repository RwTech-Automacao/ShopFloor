# Posto Almoxarifado numa tela própria dentro do Recebimento

**Data:** 19/10/2026 · **Estado:** desenho decidido com o usuário, ainda não implementado.
**Escrito para:** quem for implementar (branch `feat/posto-almoxarifado`, que ainda não foi mergeada).
**Relacionado:** `2026-09-28-posto-almoxarifado-design.md` (o posto), `2026-10-16-integracao-compels-apontamento-design.md` (a integração com o Compels).

## O que muda

Hoje o posto Almoxarifado é uma opção da tela **Lançamento** do ShopFloor: o operador escolhe o posto e o painel de bipe é trocado pelo do Almoxarifado. O usuário quer que ele **saia do Lançamento** e vire **uma tela isolada dentro do módulo Recebimento**, com a mesma lógica e as mesmas características do Lançamento. A única diferença de comportamento: o **colaborador não é digitado nem bipado**; ele vem do **usuário logado**, e a tela o mostra.

## Decisões (19/10/2026, do usuário)

1. **Colaborador = usuário logado**, automático, **mostrado na tela** (só leitura).
2. **Permissão nova do Recebimento** (`recebimento.lancar`), no lugar de `shopfloor.lancar`. Muda o RBAC e as funções do banco.
3. **Item próprio no menu do Recebimento**; **sai do Lançamento**. O posto continua existindo na rota da OP e no **card do Fluxo** (o card "Concluído" também fica).
4. **Mesma lógica do Lançamento:** cabeçalho PMO/OP carregado pelo primeiro bipe, Contexto (Disponível Produção, caixas), painel de resultado, as mesmas recusas.

## Desenho

**Tela.** Rota `/recebimento/almoxarifado`, item "Almoxarifado" no menu do Recebimento, visível a quem tem `recebimento.lancar`. Reaproveita o painel e o formulário do Lançamento (`AlmoxarifadoPanel`, cabeçalho por bipe, Contexto) em vez de reescrever: o Lançamento ganha um **modo Almoxarifado** com o posto fixo e o colaborador fixo, montado na nova rota. O posto fixo é o posto cujo perfil é `almoxarifado`; se houver mais de um, a tela mostra só esses para escolher.

**Lançamento.** Postos com perfil `almoxarifado` **deixam de aparecer** na lista de postos do Lançamento, e o painel de lá sai. A rota da OP e o Fluxo não mudam.

**Colaborador.** O nome do usuário logado entra como `colaborador` de cada registro (a coluna de texto de `sf_registros` continua a mesma). Não há campo para digitar.

**Permissão.**
- `PERMISSOES_POR_MODULO.recebimento` ganha `lancar` (hoje: visualizar, importar, editar, finalizar, editar_finalizado, excluir, gerar_etiqueta, administrar); a tela de perfis passa a oferecê-la.
- Migração nova (0154): concede `recebimento.lancar` aos perfis que **hoje** podem bipar no Almoxarifado, para ninguém perder acesso. A definição exata de quem recebe fica como ponto em aberto abaixo.
- `sf_almoxarifado_entrada` (0129) troca `tem_permissao('shopfloor','lancar')` por `tem_permissao('recebimento','lancar')`. A 0129 ainda não foi aplicada em nenhum banco real, então pode ser editada. Cancelar caixa (0131) e cancelar lançamento (0133) continuam `shopfloor.administrar` (gestor), sem mudança.

**O que não muda:** a fila de envio ao Compels, a integração, a 0132, a 0153, o card do Almoxarifado no Fluxo, a conta do % de conclusão.

## Pontos em aberto

1. **Quem recebe `recebimento.lancar` na migração:** todos os perfis com `shopfloor.lancar`, ou só os que o usuário indicar? Proposta: só administradores, e o resto atribuído pela tela de perfis.
2. **O menu e o `abas.ts` do modo quiosque** (`src/shared/ui/kiosk/abas.ts` cita o Almoxarifado): conferir o que o quiosque faz com o posto.
3. **Estoque do Compels no Contexto** da nova tela: o dado já é lido (`saldoDoItem`), mas a tela ainda não o mostra; e o saldo é o de todos os estoques, não só o do PA (a quebra por estoque precisa de uma captura a mais).

## Testes

Unitários da rota e do modo Almoxarifado do formulário (posto e colaborador fixos, posto fora da lista do Lançamento), RBAC (`modulos.test`, `mapear-perfil`), SQL da 0129 com a permissão nova e da 0154, e um smoke no ambiente local (`ShopFloor-ensaio/ROTEIRO-SMOKE-ALMOX.md`, a atualizar).
