'use server'

import { gerarCsv } from '../domain/partnumber'
import {
  linhasDoArquivoLegado,
  normalizarItem,
  normalizarPedidoLegado,
  recusaDoItem,
  type RoloEtiquetado,
} from '../domain/partnumber-legado'
import {
  buscarPendentePorCodigoLegado,
  emitirEtiquetasLegado,
  listarImpressasLegado,
  listarImpressasPorIdsLegado,
  listarPendentesLegado,
  marcarImpressasLegado,
  removerPendenteLegado,
} from '../infra/etiqueta-legado-repository'

/**
 * Ações da ETIQUETAGEM JUNTO AO INVENTÁRIO ROTATIVO (spec de 30/09/2026, migração 0135).
 *
 * O material antigo está na prateleira sem etiqueta e por isso não pode ser bipado na montagem. A
 * etiqueta nasce no gesto da recontagem: o almoxarife está com o rolo na mão, digita o código do
 * componente e — quando o rolo tem — o número do pedido. UM ROLO POR VEZ. No fim do turno ele baixa
 * um CSV com tudo o que ainda não foi impresso.
 *
 * Quem numera é o banco (`etq_legado_emitir`), como na etiquetagem por planilha: o sequencial por
 * item é único por construção, não por convenção. Aqui só mora a regra que precisa valer ANTES do
 * banco — o que o Setup não conseguiria ler não pode virar etiqueta colada num rolo.
 *
 * ⚠️ Módulo `'use server'`: só pode exportar funções async. O tipo `RoloEtiquetado` mora no domínio
 * por isso (um tipo exportado daqui derruba o `next build`, e nem o tsc nem o eslint avisam).
 *
 * A permissão `recebimento:gerar_etiqueta` é exigida por TODAS as funções do banco, e a leitura da
 * tabela exige `recebimento:visualizar` na policy — não há caminho por fora.
 */

/** O erro que veio do banco, virado frase que o almoxarife entende no tablet. */
function frase(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('SEM_PERMISSAO')) return 'Você não tem permissão para gerar etiquetas.'
  if (m.includes('PEDIDO_INVALIDO')) return 'O pedido só pode ter números.'
  if (m.includes('ITEM_INVALIDO')) return 'O código do componente não pode ter separador.'
  // A linha deixou de ser pendente entre a tela carregar e o toque no botão: outra pessoa baixou o
  // arquivo (e ela virou impressa) ou removeu antes.
  if (m.includes('NAO_PENDENTE')) {
    return 'Essa etiqueta já saiu no arquivo ou já foi removida por outra pessoa. Atualize a lista.'
  }
  return 'Não foi possível etiquetar o rolo. Tente de novo; se continuar, chame o desenvolvedor.'
}

/**
 * Carimbo de data/hora no nome do arquivo, no fuso de Brasília (o servidor roda em UTC).
 *
 * Cópia deliberada do helper de `gerar-etiquetas-legado.ts`, pelo mesmo motivo que ele é cópia do
 * de `gerar-etiquetas.ts`: um arquivo `'use server'` só pode exportar funções async, então não há
 * como compartilhar um helper entre eles. Sem o fuso, o arquivo baixado depois das 21h levaria a
 * data do dia seguinte no nome — e quem procura o arquivo do turno procura pelo dia do turno.
 */
function carimboDataHora(agora: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora)
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? ''
  return `${parte('year')}${parte('month')}${parte('day')}_${parte('hour')}${parte('minute')}${parte('second')}`
}

/**
 * Os rolos no formato das três colunas do arquivo da impressora, na ordem em que a lista veio.
 *
 * `linhasDoArquivoLegado` confere o código gravado contra o formato do domínio e LANÇA se
 * divergirem — é de propósito que a conferência esteja no caminho do arquivo: melhor não imprimir
 * do que imprimir um código que o Setup não vai ler.
 */
function arquivoDosRolos(linhas: RoloEtiquetado[]): string {
  return gerarCsv(
    linhasDoArquivoLegado(
      linhas.map((l, i) => ({
        ordem: i,
        item: l.item,
        sequencial: l.sequencial,
        codigo: l.codigo,
        locacao: '',
        pedido: l.pedido,
      })),
    ),
  )
}

/**
 * Etiqueta UM rolo: o código do componente e, quando o rolo tem, o número do pedido escrito nele.
 * O sequencial e o código definitivo vêm do banco.
 */
export async function etiquetarRoloAction(
  codigo: string,
  pedido: string,
): Promise<{ ok: true; linha: RoloEtiquetado } | { ok: false; erro: string }> {
  const item = normalizarItem(codigo)
  if (item === '') return { ok: false as const, erro: 'Digite o código do componente.' }

  // A ÚNICA recusa de código que existe: separador quebraria a leitura do Setup, que parte o
  // código do rolo no primeiro separador e leria só o pedaço anterior como componente.
  if (recusaDoItem(item) === 'item_com_separador') {
    return {
      ok: false as const,
      erro: `O código "${item}" tem separador (- _ : / ou espaço). O Setup leria só o pedaço antes dele. Confira o que está escrito no rolo.`,
    }
  }

  // `formatarPedido('abc')` devolve '0000' — por isso o pedido é RECUSADO, nunca normalizado às
  // cegas. Uma etiqueta com pedido 0000 colada num rolo é um erro que ninguém vê.
  const p = normalizarPedidoLegado(pedido)
  if ('recusa' in p) {
    return {
      ok: false as const,
      erro: `Não consegui ler o pedido "${String(pedido).trim()}". Digite só o número (ex.: 1234/25), ou deixe em branco se o rolo não tem pedido.`,
    }
  }

  try {
    const [emitida] = await emitirEtiquetasLegado([{ item, pedido: p.pedido }])
    if (!emitida) return { ok: false as const, erro: frase('vazio') }

    // A etiqueta JÁ EXISTE a partir daqui — o banco gravou. Então o que vem depois não pode virar
    // recusa: dizer "não foi possível" a um rolo que acabou de ganhar número faria o almoxarife
    // digitar de novo e queimar um segundo número.
    //
    // A releitura busca o `id`, que a função de emitir não devolve e a tela precisa para remover o
    // rolo digitado errado. Se ela não vier (a lista de pendentes é que manda, e ela é recarregada
    // em seguida), o resultado sai com `id` vazio: serve para o painel mostrar o código, não para
    // remover.
    const relida = await buscarPendentePorCodigoLegado(emitida.codigo).catch(() => null)
    return {
      ok: true as const,
      linha:
        relida ?? {
          id: '',
          item: emitida.item,
          pedido: emitida.pedido ?? '',
          sequencial: emitida.sequencial,
          codigo: emitida.codigo,
          usuarioNome: '',
          criadoEm: new Date().toISOString(),
          impressaEm: null,
        },
    }
  } catch (e) {
    return { ok: false as const, erro: frase(e) }
  }
}

/** O que ainda espera impressão, mais novo em cima. `cortada` = há mais do que a lista mostra. */
export async function listarPendentesAction(): Promise<
  { ok: true; linhas: RoloEtiquetado[]; cortada: boolean } | { ok: false; erro: string }
> {
  try {
    const { linhas, cortada } = await listarPendentesLegado()
    return { ok: true as const, linhas, cortada }
  } catch (e) {
    return { ok: false as const, erro: frase(e) }
  }
}

/**
 * Tira da lista um rolo digitado errado, antes de imprimir. O número dele fica queimado — o
 * próximo rolo daquele item pega o seguinte.
 */
export async function removerPendenteAction(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!id) return { ok: false as const, erro: 'Escolha a etiqueta que quer remover.' }

  try {
    await removerPendenteLegado(id)
    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, erro: frase(e) }
  }
}

/**
 * O arquivo do turno: tudo o que ainda não foi impresso, num CSV só, e as linhas dele marcadas como
 * impressas.
 */
export async function gerarCsvPendentesAction(): Promise<
  | { ok: true; csv: string; fileName: string; quantidade: number; aviso?: string }
  | { ok: false; erro: string }
> {
  try {
    const { linhas } = await listarPendentesLegado()
    if (linhas.length === 0) {
      return { ok: false as const, erro: 'Não há nada esperando impressão.' }
    }

    // O arquivo sai ANTES de marcar, e marca exatamente os ids que entraram nele. Se o CSV
    // falhar ao ser montado, nada é marcado — e o almoxarife não perde a lista.
    const csv = arquivoDosRolos(linhas)
    const movidas = await marcarImpressasLegado(linhas.map((l) => l.id))
    const fileName = `Etiquetas_inventario_${carimboDataHora(new Date())}.csv`

    // `etq_legado_marcar_impressas` só move o que ainda está pendente, e devolve quantas moveu.
    // Menos do que entrou no arquivo é a assinatura de DUAS PESSOAS BAIXANDO AO MESMO TEMPO: a
    // outra já levou parte da leva, e essas etiquetas vão sair nos dois arquivos. O arquivo sai de
    // todo jeito (ele já está pronto e as linhas dele são as certas); o que faltava era avisar,
    // porque imprimir os dois em silêncio termina com o mesmo código colado em dois rolos.
    const repetidas = linhas.length - movidas
    const aviso =
      repetidas > 0
        ? `Atenção: o arquivo saiu com ${linhas.length} etiqueta(s), mas ${repetidas} dela(s) já tinham sido baixadas por outra pessoa ao mesmo tempo — vão sair nos dois arquivos. Confira com ela antes de imprimir, para o mesmo código não acabar colado em dois rolos.`
        : undefined

    return { ok: true as const, csv, fileName, quantidade: linhas.length, ...(aviso ? { aviso } : {}) }
  } catch (e) {
    return { ok: false as const, erro: frase(e) }
  }
}

/** As etiquetas já impressas numa janela de datas, para achar a que se perdeu ou se rasgou. */
export async function listarImpressasAction(
  desde: string,
  ate: string,
): Promise<{ ok: true; linhas: RoloEtiquetado[] } | { ok: false; erro: string }> {
  if (!desde || !ate) return { ok: false as const, erro: 'Escolha o período.' }

  try {
    return { ok: true as const, linhas: await listarImpressasLegado(desde, ate) }
  } catch (e) {
    return { ok: false as const, erro: frase(e) }
  }
}

/**
 * Baixa de novo etiquetas JÁ IMPRESSAS. Nada é marcado: elas já estão marcadas, e a segunda via é
 * do mesmo código — é reimpressão, não etiqueta nova.
 */
export async function baixarDeNovoAction(
  ids: string[],
): Promise<{ ok: true; csv: string; fileName: string } | { ok: false; erro: string }> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false as const, erro: 'Escolha ao menos uma etiqueta para baixar de novo.' }
  }

  try {
    const linhas = await listarImpressasPorIdsLegado(ids)
    if (linhas.length === 0) {
      return { ok: false as const, erro: 'Nenhuma dessas etiquetas está disponível para baixar de novo.' }
    }
    return {
      ok: true as const,
      csv: arquivoDosRolos(linhas),
      fileName: `Etiquetas_inventario_2avia_${carimboDataHora(new Date())}.csv`,
    }
  } catch (e) {
    return { ok: false as const, erro: frase(e) }
  }
}
