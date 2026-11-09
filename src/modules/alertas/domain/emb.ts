import { LIMITE_MENSAGEM, cortarUtf16, listaComCorte, listaPrimeiros } from './mensagens'
import { linhaVerRelatorio } from './links'

/** Um item divergente da EMB, como a mensagem precisa dele (o `dados` da fila, já lido). */
export interface DivergenciaEmb {
  numero: number
  /** O código do material. Pode vir VAZIO: é campo livre no Recebimento (ver `rec_emb_divergencias`). */
  item: string
  /** A descrição do material. Também pode vir vazia. */
  descricao: string
  quantidadePedido: number | null
  quantidadeRecebida: number | null
  /** O valor como o banco guarda (texto): '-10', '5', '1,5'. Mostrado como está. */
  divergencia: string
  /** Vazia = ninguém justificou. É justamente a que precisa de ação. */
  justificativa: string
  justificadaPorNome: string
}

/** Quantas divergências a mensagem mostra quando leva o link do relatório (o resto está na tela). */
export const DIVERGENCIAS_NA_MENSAGEM = 3

/** A frase da coluna "Janela" da lista de regras. A regra de fim de EMB não tem janela. */
export const JANELA_EMB = 'Quando a EMB fecha'

/** A frase da coluna "Limite". A regra de fim de EMB não tem limite: ela tem um gatilho. */
export const LIMITE_EMB = 'Todos os processos no fim'

/** Concordância: "1 divergência", "0 divergências", "2 divergências" (zero é plural em português). */
const n = (v: number, s: string, p: string) => `${v} ${v === 1 ? s : p}`

/**
 * Quantidade ausente vira travessão. É campo livre no Recebimento e pode estar em branco: a
 * mensagem diz "pedido —" em vez de "pedido null" ou de calar a linha inteira.
 */
function numeroOuTraco(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : String(v)
}

/**
 * A mensagem do fim de EMB. TODA EMB que fecha manda uma (decisão 5 da spec, corrigida em
 * 14/10/2026):
 *
 *  - com divergência: uma linha de cabeçalho e, por divergência, duas linhas — o item com as
 *    quantidades e, abaixo, a justificativa ou a marca de que ninguém justificou;
 *  - sem divergência: UMA linha, dizendo que a EMB fechou e que fechou sem divergência. Ela não é
 *    o cabeçalho com "0 divergências": quem lê precisa saber na primeira linha que não há nada a
 *    fazer. ⚠️ Até 09/10 a EMB limpa não mandava mensagem nenhuma, e esta função só devolvia o
 *    cabeçalho por defesa.
 *
 * ⚠️ A PRIMEIRA LINHA É O ASSUNTO DO E-MAIL (o cliente de e-mail parte o texto na primeira quebra):
 * ela tem de dizer sozinha de que EMB se trata e quantas divergências são — ou que não houve
 * nenhuma, no caso da EMB limpa.
 * Mexer na ordem das linhas muda o assunto do e-mail.
 *
 * COM O LINK DO RELATÓRIO (`urlRelatorio`, a tela /recebimento/emb/<emb>): só as 3 primeiras divergências,
 * "… e mais K divergências" se houver e "Ver relatório completo: <url>". A EMB limpa não leva link.
 *
 * ⚠️ Uma EMB com muitas divergências passaria dos 2000 do Discord, que RECUSA a mensagem inteira.
 * O corte é o mesmo das posições e do resumo (`listaComCorte`): "… e mais 12 divergências". O
 * orçamento é o que sobra do limite depois do cabeçalho e do `\n` que o separa da lista. Sem
 * MARGEM_CABECALHO: o fim de EMB não vira lembrete nem reabertura, ninguém embrulha este texto.
 */
export function textoEmb(
  nomeRegra: string,
  emb: string,
  divergencias: readonly DivergenciaEmb[],
  urlRelatorio: string | null = null,
): string {
  // A EMB limpa tem texto PRÓPRIO, e sai por aqui antes de qualquer lista.
  if (divergencias.length === 0) {
    return cortarUtf16(
      `✅ ${emb} fechou sem divergência de quantidade · ${nomeRegra}`,
      LIMITE_MENSAGEM,
    )
  }

  // Nome de regra absurdo: o próprio cabeçalho cederia o limite, então é ele que é aparado.
  const cabecalho = cortarUtf16(
    `📦 ${emb} fechou — ${n(divergencias.length, 'divergência', 'divergências')} de quantidade · ${nomeRegra}`,
    LIMITE_MENSAGEM,
  )

  const itens = divergencias.map((d) => {
    // Item e descrição podem vir vazios (campo em branco no Recebimento): a identidade fica só com
    // o número do processo, em vez de sair com separadores pendurados.
    const identidade = [`#${d.numero}`, d.item.trim(), d.descricao.trim()]
      .filter((p) => p !== '')
      .join(' ')
    const quantidades =
      `pedido ${numeroOuTraco(d.quantidadePedido)}, ` +
      `recebido ${numeroOuTraco(d.quantidadeRecebida)} (${d.divergencia})`
    const texto = d.justificativa.trim()
    const quem = d.justificadaPorNome.trim()
    const explicacao =
      texto === ''
        ? '   ↳ ⚠️ sem justificativa'
        : `   ↳ ${texto}${quem === '' ? '' : ` (${quem})`}`
    return `${identidade} · ${quantidades}\n${explicacao}`
  })

  // Com o link do relatório (a tela da EMB): só as DIVERGENCIAS_NA_MENSAGEM primeiras, "… e mais K
  // divergências" e o link na última linha. Sem link (linha antiga, sem origem): a lista inteira até o limite.
  const url = (urlRelatorio ?? '').trim()
  if (url !== '') {
    const link = linhaVerRelatorio(url)
    const listaCurta = listaPrimeiros(
      itens,
      DIVERGENCIAS_NA_MENSAGEM,
      LIMITE_MENSAGEM - cabecalho.length - link.length - 2,
      'divergência',
      'divergências',
    )
    const texto = [cabecalho, listaCurta, link].filter((p) => p !== '').join('\n')
    // Cabeçalho + link já no limite (nome de regra absurdo): o cabeçalho sozinho, como abaixo.
    return texto.length <= LIMITE_MENSAGEM ? texto : cabecalho
  }

  const lista = listaComCorte(
    itens,
    LIMITE_MENSAGEM - cabecalho.length - 1,
    'divergência',
    'divergências',
    '\n',
  )
  // Nem uma divergência cabe com o aviso (nome de regra gigante): a mensagem inteira vale mais que
  // a lista. Mesma saída do resumo diário.
  return lista === '' ? cabecalho : `${cabecalho}\n${lista}`
}
