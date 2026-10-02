import { chaveRolo, normalizarTexto, separarRolo } from './codigo-rolo'

/** O que a conferência precisa saber de cada item montado no setup. */
export interface ItemDoSetup {
  posicao: string
  feeder: string
  componente: string
  rolo: string | null
}

export interface EntradaConferencia {
  campo: 'colaborador' | 'posicao' | 'feeder' | 'saida' | 'entrada' | 'sn'
  valor: string
  /** O que já foi bipado nos passos anteriores, como o operador digitou. */
  bipados: { posicao?: string; feeder?: string; saida?: string }
  itens: ItemDoSetup[]
  /** PTH fala em posto/locação; SMD, em posição/feeder. É a mesma distinção da st_trocar_rolo. */
  pth: boolean
}

/** O item montado naquela posição+feeder, ou undefined — é o `v_item` da st_trocar_rolo. */
function itemBipado(e: EntradaConferencia): ItemDoSetup | undefined {
  const pos = normalizarTexto(e.bipados.posicao ?? '')
  const fee = normalizarTexto(e.bipados.feeder ?? '')
  if (pos === '' || fee === '') return undefined
  return e.itens.find((i) => normalizarTexto(i.posicao) === pos && normalizarTexto(i.feeder) === fee)
}

/**
 * A regra do passo, ou `null` quando passa.
 *
 * As frases são as da `st_trocar_rolo` (0112), COPIADAS palavra por palavra — inclusive a variação
 * por processo. Se a regra mudar lá, muda aqui: duas fontes de texto para a mesma regra divergem
 * com o tempo, e aí a mensagem do passo diz uma coisa e a do envio diz outra.
 *
 * Nada aqui é validação NOVA: a st_trocar_rolo continua conferindo tudo no envio, e é ela que vale.
 * O que esta função faz é tornar cada regra alcançável no passo em que o erro nasce, para o operador
 * descobrir o problema com o rolo ainda na mão.
 *
 * O SN não entra: ele exige a faixa da OP, que o modal não carrega, e portar `st_sn_na_faixa`
 * duplicaria lógica de faixa. Como é o ÚLTIMO passo, a resposta do servidor chega logo em seguida.
 */
export function conferirPasso(e: EntradaConferencia): string | null {
  // Nada bipado ainda: não há o que recusar (mesma regra de "passo sem o anterior" abaixo).
  if (normalizarTexto(e.valor) === '') return null
  switch (e.campo) {
    // O crachá é livre na st_trocar_rolo (não entra na avaliação) e o SN fica com o servidor.
    case 'colaborador':
    case 'sn':
      return null

    case 'posicao': {
      const pos = normalizarTexto(e.valor)
      if (e.itens.some((i) => normalizarTexto(i.posicao) === pos)) return null
      return e.pth
        ? `O posto ${pos} não existe nesse setup.`
        : `A posição ${pos} não existe nesse setup.`
    }

    case 'feeder': {
      const fee = normalizarTexto(e.valor)
      if (!e.itens.some((i) => normalizarTexto(i.feeder) === fee)) {
        return e.pth
          ? `A locação ${fee} não existe nesse setup.`
          : `O feeder ${fee} não existe nesse setup.`
      }
      const pos = normalizarTexto(e.bipados.posicao ?? '')
      // Sem a posição bipada não há com o que cruzar; o passo anterior é que responde por ela.
      if (pos === '') return null
      if (e.itens.some((i) => normalizarTexto(i.posicao) === pos && normalizarTexto(i.feeder) === fee)) return null
      return e.pth
        ? `A locação ${fee} não está no posto ${pos}.`
        : `O feeder ${fee} não está na posição ${pos}.`
    }

    case 'saida': {
      const item = itemBipado(e)
      // Posição e feeder já foram conferidos nos passos deles; sem item não há rolo montado a comparar.
      if (!item) return null
      const pos = normalizarTexto(e.bipados.posicao ?? '')
      const saida = normalizarTexto(e.valor)
      const chaveItem = item.rolo === null ? null : chaveRolo(item.rolo)
      if (chaveItem !== null && chaveItem === chaveRolo(saida)) return null
      const montado = item.rolo ?? '(nenhum)'
      return e.pth
        ? `O rolo montado no posto ${pos} é ${montado}, não ${saida}.`
        : `O rolo montado na posição ${pos} é ${montado}, não ${saida}.`
    }

    case 'entrada': {
      const entrada = normalizarTexto(e.valor)
      const saida = normalizarTexto(e.bipados.saida ?? '')
      // Sem o rolo que sai bipado, este passo ainda não pode ser conferido.
      if (saida === '') return null
      const chaveEntrada = chaveRolo(entrada)
      const chaveSaida = chaveRolo(saida)
      if (chaveEntrada === null) return `Código do rolo que entra inválido: ${entrada}.`
      if (chaveSaida === null) return `Código do rolo que sai inválido: ${saida}.`
      const prefixoEntrada = separarRolo(entrada).prefixo
      const prefixoSaida = separarRolo(saida).prefixo
      if (prefixoEntrada !== prefixoSaida) {
        return `Componente diferente: sai ${prefixoSaida}, entra ${prefixoEntrada}.`
      }
      if (chaveEntrada === chaveSaida) return 'O rolo que entra é o mesmo que sai.'
      // O rolo pode estar montado em OUTRO item — o item desta troca é o que está sendo liberado.
      const atual = itemBipado(e)
      const outra = e.itens.find(
        (i) => i !== atual && i.rolo !== null && chaveRolo(i.rolo) === chaveEntrada,
      )
      if (outra) {
        return e.pth
          ? `O rolo ${entrada} já está montado no posto ${outra.posicao}.`
          : `O rolo ${entrada} já está montado na posição ${outra.posicao}.`
      }
      return null
    }
  }
}
