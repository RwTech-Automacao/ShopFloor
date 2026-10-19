'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import {
  MINUTOS_DE_RESERVA,
  ROTA_ESTOQUE_PENDENTE,
  TENTATIVAS_APOS_REENVIO,
  TETO_TENTATIVAS,
} from '../domain/estoque-pendente'
import { lerLinhaParaReenvio, liberarParaReenvio } from '../infra/estoque-pendente-repository'

export type ResultadoReenvio = { ok: true; chave: string } | { ok: false; erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para reenviar movimentações de estoque.'

/**
 * REENVIAR: devolve UMA linha da fila de estoque à fila. Ela NÃO fala com o Compels — de propósito.
 * O único caminho de entrega é o laço da `entregarEstoquePendente` (Task 3), chamado pelo cron: dois
 * caminhos de envio seriam duas regras de reserva, duas contagens de tentativa e duas chances de
 * mandar a mesma movimentação duas vezes. Aqui só se torna a linha ELEGÍVEL outra vez.
 *
 * =========================================================================================
 * ⚠️ A DECISÃO: O REENVIAR NÃO ZERA `tentativas`. ELE VOLTA PARA 1.
 *
 * O que o Reenviar tem de conseguir: a linha que estourou o teto (`tentativas >= 5`) saiu da fila
 * (é o `tentativas < 5` do filtro da `sf_estoque_reservar` e do índice parcial
 * `sf_estoque_envios_pendentes`) e não volta sozinha. Para voltar, `tentativas` TEM de cair abaixo
 * de 5 — não há outra porta, e mudar o filtro exigiria migração.
 *
 * O que ele NÃO pode destruir: `tentativas > 0` é a MARCA DE "LINHA TOCADA" que a
 * `sf_estoque_reverter` (0132) usa para decidir ESTORNAR em vez de ajustar ou cancelar. A marca
 * existe porque a reserva soma 1 ANTES de falar com o ERP: uma linha já tentada PODE ter chegado ao
 * Compels com a resposta perdida no caminho, e por isso desfazê-la tem de virar uma saída (estorno),
 * e não uma reescrita do que "vai" ser enviado.
 *
 * Zerar `tentativas` apaga essa marca, e o dano tem duas formas — a segunda é pior que a primeira:
 *   (a) numa linha PARCIALMENTE REVERTIDA (`estornado > 0`), o caminho do ajuste reduz a
 *       `quantidade` e o CHECK `estornado <= quantidade` estoura na cara do gestor no próximo
 *       cancelamento. Foi este cenário que criou a rede `or v_ent.estornado > 0` na 0132;
 *   (b) em QUALQUER linha tocada (mesmo com `estornado = 0`), o cancelamento da caixa passa a
 *       CANCELAR a entrada em vez de estornar — e se ela já tinha chegado ao ERP, o Compels fica com
 *       peças que o ShopFloor removeu, sem estorno, sem linha cancelada e sem nada acusando. É a
 *       perda silenciosa que esta feature inteira existe para não ter.
 *
 * Ou seja: as duas saídas oferecidas no brief não servem inteiras. "Não zerar de linha com
 * `estornado > 0`, zerar só `reservado_em`" deixaria justamente essas linhas presas fora da fila
 * para sempre (soltar a reserva não faz nada quando `tentativas` já passou do teto), e "zerar e
 * provar que o ajuste continua fechado" não é provável: zerar É abrir o ajuste, porque `v_tocada`
 * lê `tentativas > 0` como primeira perna.
 *
 * `TENTATIVAS_APOS_REENVIO = 1` é o menor valor que satisfaz as duas exigências ao mesmo tempo:
 *   • 1 < 5, então a linha volta a ser elegível e ganha 4 tentativas novas;
 *   • 1 > 0, então `v_tocada` continua verdadeiro e o caminho do ajuste segue FECHADO — para a linha
 *     com `estornado > 0` e para qualquer outra linha já tentada. A regra vale sem exceção, então
 *     não há um caso especial para alguém esquecer depois.
 * O preço, assumido: a contagem exibida deixa de ser "quantas vezes esta linha já foi tentada na
 * vida" e passa a ser "quantas nesta rodada de insistência". É diagnóstico, e o motivo da última
 * falha (`erro`) fica guardado — contra estoque errado no ERP, é barato.
 * =========================================================================================
 */
export async function reenviarEstoqueAction(id: string): Promise<ResultadoReenvio> {
  // Gate de ESCRITA: `shopfloor:administrar`. Ver a página para o de leitura (`visualizar`). A Server
  // Action é um endpoint POST público — o gate aqui é o que vale, não o de renderizar o botão.
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { ok: false, erro: SEM_PERMISSAO }
  }

  const alvo = String(id ?? '').trim()
  if (alvo === '') return { ok: false, erro: 'Movimentação não informada.' }

  let linha
  try {
    linha = await lerLinhaParaReenvio(alvo)
  } catch {
    return { ok: false, erro: 'Não foi possível ler a movimentação. Tente de novo.' }
  }
  if (!linha) return { ok: false, erro: 'Movimentação não encontrada na fila de estoque.' }

  // As recusas abaixo dizem POR QUE não, e não só "não" — é a mesma tela que alguém abre sem
  // contexto. Elas repetem a leitura de estado do domínio de propósito: o cliente pode mandar
  // qualquer id, inclusive o de uma linha que não tem botão na tela.
  if (linha.ok) {
    return { ok: false, erro: 'Esta movimentação já chegou ao Compels — não há o que reenviar.' }
  }
  if (linha.canceladoEm) {
    return {
      ok: false,
      erro: 'Esta movimentação foi cancelada no ShopFloor antes de ir ao ERP: ela não deve ser enviada.',
    }
  }
  // Reserva VIVA: uma rodada está entregando esta linha agora. Soltar a reserva aqui deixaria outra
  // rodada pegar a MESMA linha — e a janela de 15 min existe justamente para o cron atrasado e um
  // Reenviar não mandarem a mesma entrada duas vezes (ver a `sf_estoque_reservar`).
  const reservado = linha.reservadoEm ? new Date(linha.reservadoEm).getTime() : 0
  if (reservado >= Date.now() - MINUTOS_DE_RESERVA * 60_000) {
    return {
      ok: false,
      erro: `Uma rodada de envio está entregando esta linha agora. Espere até ${MINUTOS_DE_RESERVA} `
        + 'minutos e confira o resultado antes de reenviar.',
    }
  }
  if (linha.tentativas < TETO_TENTATIVAS) {
    return {
      ok: false,
      erro: `Esta linha ainda está na fila (${linha.tentativas} de ${TETO_TENTATIVAS} tentativas): a `
        + 'próxima rodada tenta de novo sozinha. O Reenviar só serve para a linha que gastou as '
        + 'tentativas e saiu da fila.',
    }
  }

  let gravou: boolean
  try {
    gravou = await liberarParaReenvio(alvo)
  } catch {
    return { ok: false, erro: 'Não foi possível reenviar. Tente de novo.' }
  }
  if (!gravou) {
    // A cerca do `update` não casou: entre a leitura e a escrita a linha mudou (uma rodada do cron a
    // entregou, ou um cancelamento chegou). Não insiste — manda conferir, que é o que o gestor faria.
    return {
      ok: false,
      erro: 'A situação desta linha mudou enquanto você olhava a tela. Atualize a página e confira antes de reenviar.',
    }
  }

  await registrarLog({
    entidade: 'sf_estoque_envios',
    entidadeId: alvo,
    acao: 'alterar_campo',
    descricao: `Movimentação de estoque ${linha.chave} devolvida à fila do Compels (OP ${linha.pmo}/${linha.op})`,
    // O `de → para` da tentativa fica no log porque é a informação que a própria tela deixa de
    // mostrar depois do reenvio (ver A DECISÃO, acima).
    dados: { tentativas_antes: linha.tentativas, tentativas_depois: TENTATIVAS_APOS_REENVIO, estornado: linha.estornado },
  })
  revalidatePath(ROTA_ESTOQUE_PENDENTE)
  return { ok: true, chave: linha.chave }
}
