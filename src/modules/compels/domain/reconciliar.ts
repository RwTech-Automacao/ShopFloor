import { q6, type EstadoOpErp } from './estado-op'

/**
 * Decide o que fazer com UMA entrada do Almoxarifado, comparando o que o ERP já tem com o que
 * esperamos ter enviado. Função pura: não lê nem grava nada. Ver a spec de 16/10/2026, seção 3.2.
 *
 * `anterior` = acumulado das entradas vigentes ANTES desta (C(k-1)); `novo` = com esta (C(k)).
 */
export type CodigoErro =
  | 'quantidade_invalida'
  | 'propriedade_nao_suportada'
  | 'acima_da_op'
  | 'estorno_na_op'
  | 'abaixo_do_enviado'
  | 'fora_do_esperado'
  | 'requisicao_fora_do_esperado'
  | 'sem_empenho'
  | 'pendencia_no_erp'

export type Decisao =
  | { tipo: 'ja_enviada' }
  | { tipo: 'enviar'; requisitar: number; apontar: number }
  | { tipo: 'erro'; codigo: CodigoErro; mensagem: string }

/** Textos mostrados na tela de pendências. Em português claro, sem termo de API. */
export const MENSAGEM_ERRO: Record<CodigoErro, string> = {
  quantidade_invalida: 'Quantidade da entrada inválida.',
  propriedade_nao_suportada: 'OP com estoque que não é próprio (ex.: em terceiros). Faça a entrada à mão no Compels.',
  acima_da_op: 'A entrada passa da quantidade da OP no Compels.',
  estorno_na_op: 'A OP tem estorno ou cancelamento no Compels. Confira antes de reenviar.',
  abaixo_do_enviado: 'Leitura inconsistente: o Compels mostra menos apontado do que já enviamos.',
  fora_do_esperado: 'OP com apontamento fora do esperado no Compels. Confira antes de reenviar.',
  requisicao_fora_do_esperado: 'OP com requisição fora do esperado no Compels (alguém requisitou à mão). Confira antes de reenviar.',
  sem_empenho: 'OP sem empenho suficiente no Compels.',
  pendencia_no_erp: 'Há pendência de material no Compels (falta saldo de componente). Resolva lá e reenvie.',
}

function erro(codigo: CodigoErro): Decisao {
  return { tipo: 'erro', codigo, mensagem: MENSAGEM_ERRO[codigo] }
}

export function decidirEntrada(
  estado: EstadoOpErp,
  acumulado: { anterior: number; novo: number },
): Decisao {
  const anterior = q6(acumulado.anterior)
  const novo = q6(acumulado.novo)
  const quantidade = q6(novo - anterior)

  if (quantidade <= 0 || anterior < 0) return erro('quantidade_invalida')
  if (estado.tipoPropriedade !== 0) return erro('propriedade_nao_suportada')
  if (novo > estado.quantidadeOp) return erro('acima_da_op')
  if (estado.temEstorno) return erro('estorno_na_op')

  // Já enviada: o ERP cobre esta entrada (inclui a retomada depois de uma falha no meio).
  if (estado.apontada >= novo) return { tipo: 'ja_enviada' }

  // O ERP tem menos do que já enviamos, ou um valor que não é "exatamente até a entrada anterior":
  // alguém mexeu à mão. Parar é mais seguro do que contar em dobro.
  if (estado.apontada < anterior) return erro('abaixo_do_enviado')
  if (estado.apontada !== anterior) return erro('fora_do_esperado')

  if (estado.temPendencia) return erro('pendencia_no_erp')
  if (estado.empenhada < novo) return erro('sem_empenho')

  // Cada entrada é UMA requisição + UM apontamento. O ERP precisa estar no ponto certo:
  // - requisitada == anterior: caminho normal, requisita e aponta a quantidade da entrada;
  // - requisitada == novo: a requisição desta entrada já foi feita e o apontamento falhou (retomada),
  //   então só falta apontar. Requisitar de novo duplicaria;
  // - qualquer outro valor (ex.: alguém requisitou à frente ou à mão): para.
  if (estado.requisitada === anterior) {
    return { tipo: 'enviar', requisitar: quantidade, apontar: quantidade }
  }
  if (estado.requisitada === novo) {
    return { tipo: 'enviar', requisitar: 0, apontar: quantidade }
  }
  return erro('requisicao_fora_do_esperado')
}
