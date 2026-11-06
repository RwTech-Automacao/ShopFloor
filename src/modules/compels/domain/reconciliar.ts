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

export type Decisao =
  | { tipo: 'ja_enviada' }
  | { tipo: 'enviar'; apontar: number; avisos: string[] }
  | { tipo: 'erro'; codigo: CodigoErro; mensagem: string }

/** Textos mostrados na tela de pendências. Em português claro, sem termo de API. */
export const MENSAGEM_ERRO: Record<CodigoErro, string> = {
  quantidade_invalida: 'Quantidade da entrada inválida.',
  propriedade_nao_suportada: 'OP com estoque que não é próprio (ex.: em terceiros). Faça a entrada à mão no Compels.',
  acima_da_op: 'A entrada passa da quantidade da OP no Compels.',
  estorno_na_op: 'A OP tem estorno ou cancelamento no Compels. Confira antes de reenviar.',
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

  // Já enviada: o ERP está EXATAMENTE no acumulado novo (a retomada depois de uma falha no meio: a entrada
  // foi gravada e só o registro dela falhou). Tem que ser IGUAL, não "pelo menos": gravar de novo contaria a
  // entrada em dobro, e esta é a única conferência de apontado que ainda segura a gravação.
  if (estado.apontada === novo) return { tipo: 'ja_enviada' }

  // A integração SÓ APONTA: quem requisita é o pessoal do Compels. Empenho e requisição insuficientes não
  // bloqueiam aqui (o que bloqueia é o saldo requisitado disponível por componente, conferido antes de gravar);
  // viram AVISO. A requisição não precisa ter uma quantidade exata, só ser suficiente (`requisitada >= novo`).
  const avisos: string[] = []
  // QUANTIDADE INESPERADA (decisão de 06/11/2026): o apontado do ERP não é o que o ShopFloor esperava (apontamento
  // manual, antecipado para faturamento, estorno à mão, outra leva da mesma OP). Antes isso PARAVA a entrada; agora
  // grava e AVISA, porque parar travava a fila por algo que a integração não tem como resolver sozinha.
  if (estado.apontada !== anterior) {
    const diferenca = q6(estado.apontada - anterior)
    const sentido = diferenca > 0 ? `a mais: ${diferenca}` : `a menos: ${q6(-diferenca)}`
    avisos.push(
      `quantidade inesperada no Compels: mostra ${estado.apontada} apontadas, esperado ${anterior} antes desta entrada (${sentido}). `
      + 'Foi gravado mesmo assim; confira se há apontamento manual ou estorno nesta OP',
    )
  }
  if (estado.empenhada < novo) {
    avisos.push(`empenho insuficiente no Compels: empenhado ${estado.empenhada}, precisa de ${novo} (faltam ${q6(novo - estado.empenhada)})`)
  }
  if (estado.requisitada < novo) {
    avisos.push(`requisição insuficiente no Compels: requisitado ${estado.requisitada}, precisa de ${novo} (faltam ${q6(novo - estado.requisitada)})`)
  }
  return { tipo: 'enviar', apontar: quantidade, avisos }
}
