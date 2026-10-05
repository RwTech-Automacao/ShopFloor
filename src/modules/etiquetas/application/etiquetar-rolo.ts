'use server'

import { registrarLog } from '@/modules/logs/application/registrar-log'
import { carimboDataHora, gerarCsv } from '../domain/partnumber'
import {
  linhasDoArquivoLegado,
  normalizarItem,
  normalizarPedidoLegado,
  recusaDoItem,
  type RoloEtiquetado,
} from '../domain/partnumber-legado'
import {
  buscarPendentePorCodigoLegado,
  buscarPendentePorIdLegado,
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
 *
 * ⚠️ AS AÇÕES QUE MUDAM ESTADO GRAVAM LOG (emitir, remover, baixar o arquivo); as leituras não.
 * `logs.entidade_id` é **uuid**: só o `id` da linha de `etiquetas_legado` pode entrar lá. O CÓDIGO
 * da etiqueta vai na descrição e em `dados` — passá-lo como `entidadeId` faria o insert do log
 * falhar com 22P02 e o erro morreria num `console.error` (foi assim que a Integração e o Reparo
 * ficaram meses sem auditoria nenhuma, sem ninguém notar).
 */

/**
 * O erro que veio do banco, virado frase que o almoxarife entende no tablet.
 *
 * `oQue` é a ação que falhou, e entra só no fallback genérico: sem ele, o banco cair no download
 * diria "Não foi possível etiquetar o rolo" a quem apertou "Baixar arquivo" — e o almoxarife
 * acharia que perdeu a etiquetagem, não o arquivo. As frases ESPECÍFICAS (permissão, pedido, linha
 * que já não é pendente) valem para qualquer ação e seguem iguais.
 */
function frase(e: unknown, oQue: string): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('SEM_PERMISSAO')) return 'Você não tem permissão para gerar etiquetas.'
  if (m.includes('PEDIDO_INVALIDO')) return 'O pedido só pode ter números.'
  if (m.includes('ITEM_INVALIDO')) return 'O código do componente não pode ter separador.'
  // A linha deixou de ser pendente entre a tela carregar e o toque no botão: outra pessoa baixou o
  // arquivo (e ela virou impressa) ou removeu antes.
  if (m.includes('NAO_PENDENTE')) {
    return 'Essa etiqueta já saiu no arquivo ou já foi removida por outra pessoa. Atualize a lista.'
  }
  return `Não foi possível ${oQue}. Tente de novo; se continuar, chame o desenvolvedor.`
}

/**
 * Grava o log sem poder derrubar a ação que JÁ ACONTECEU no banco.
 *
 * As três ações registram DEPOIS da escrita. Se o log pudesse levantar, a emissão de um rolo que
 * acabou de ganhar número devolveria "não foi possível" ao almoxarife, ele digitaria de novo e
 * queimaria um segundo número — e o download devolveria erro com a leva já marcada como impressa,
 * perdendo o arquivo para sempre. `inserirLog` já engole a falha do insert; aqui a cerca é contra o
 * resto (a leitura da sessão, por exemplo), e nunca em silêncio.
 */
async function anotar(entrada: Parameters<typeof registrarLog>[0]): Promise<void> {
  try {
    await registrarLog(entrada)
  } catch (e) {
    console.error('[etiquetar-rolo] falha ao registrar log', { acao: entrada.acao, erro: e })
  }
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
    if (!emitida) return { ok: false as const, erro: frase('vazio', 'etiquetar o rolo') }

    // A etiqueta JÁ EXISTE a partir daqui — o banco gravou. Então o que vem depois não pode virar
    // recusa: dizer "não foi possível" a um rolo que acabou de ganhar número faria o almoxarife
    // digitar de novo e queimar um segundo número.
    //
    // A releitura busca o `id`, que a função de emitir não devolve e a tela precisa para remover o
    // rolo digitado errado. Se ela não vier (a lista de pendentes é que manda, e ela é recarregada
    // em seguida), o resultado sai com `id` vazio: serve para o painel mostrar o código, não para
    // remover.
    const relida = await buscarPendentePorCodigoLegado(emitida.codigo).catch(() => null)

    // `entidadeId` só sai quando a releitura trouxe o id (uuid de verdade). Sem ela, o log sai sem
    // id — o código está na descrição, e é por ele que se acha a etiqueta.
    await anotar({
      entidade: 'etiqueta_legado',
      ...(relida?.id ? { entidadeId: relida.id } : {}),
      acao: 'gerar_etiqueta',
      descricao:
        `Etiqueta ${emitida.codigo} emitida no inventário rotativo (componente ${emitida.item}, ` +
        `${p.pedido === '' ? 'rolo sem pedido escrito' : `pedido ${p.pedido}`})`,
      dados: {
        codigo: emitida.codigo,
        item: emitida.item,
        pedido: p.pedido,
        sequencial: emitida.sequencial,
      },
    })

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
    return { ok: false as const, erro: frase(e, 'etiquetar o rolo') }
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
    return { ok: false as const, erro: frase(e, 'carregar a lista') }
  }
}

/**
 * Tira da lista um rolo digitado errado, antes de imprimir. O número dele fica queimado — o
 * próximo rolo daquele item pega o seguinte.
 */
export async function removerPendenteAction(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!id) return { ok: false as const, erro: 'Escolha a etiqueta que quer remover.' }

  try {
    // Lido ANTES: depois da marca a linha sai da lista de pendentes, e o log precisa do código
    // para dizer QUAL número ficou queimado. Best-effort — a remoção não para por causa do log.
    const linha = await buscarPendentePorIdLegado(id).catch(() => null)
    await removerPendenteLegado(id)

    await anotar({
      entidade: 'etiqueta_legado',
      entidadeId: id,
      acao: 'excluir',
      descricao: linha
        ? `Etiqueta ${linha.codigo} removida da lista antes de imprimir; o número ${linha.sequencial} do componente ${linha.item} fica queimado`
        : 'Etiqueta removida da lista antes de imprimir; o número dela fica queimado',
      dados: {
        codigo: linha?.codigo ?? '',
        item: linha?.item ?? '',
        sequencial: linha?.sequencial ?? null,
      },
    })

    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, erro: frase(e, 'remover a etiqueta') }
  }
}

/**
 * O arquivo do turno: tudo o que ainda não foi impresso, num CSV só, e as linhas dele marcadas como
 * impressas.
 */
export async function gerarCsvPendentesAction(): Promise<
  | { ok: true; csv: string; fileName: string; quantidade: number; cortada: boolean; aviso?: string }
  | { ok: false; erro: string }
> {
  try {
    const { linhas, cortada } = await listarPendentesLegado()
    if (linhas.length === 0) {
      return { ok: false as const, erro: 'Não há nada esperando impressão.' }
    }

    // O arquivo sai ANTES de marcar, e marca exatamente os ids que entraram nele. Se o CSV
    // falhar ao ser montado, nada é marcado — e o almoxarife não perde a lista.
    const csv = arquivoDosRolos(linhas)
    const movidas = await marcarImpressasLegado(linhas.map((l) => l.id))
    const fileName = `Etiquetas_inventario_${carimboDataHora(new Date())}.csv`

    const avisos: string[] = []

    // `etq_legado_marcar_impressas` só move o que ainda está `impressa_em is null and removida_em
    // is null`, e devolve quantas moveu. Menos do que entrou no arquivo tem DOIS motivos, e os dois
    // acontecem enquanto a tela estava aberta: outra pessoa baixou o arquivo (a etiqueta virou
    // impressa) ou outra pessoa removeu a etiqueta. Só o primeiro é perigoso — o mesmo código sai
    // nos dois arquivos. O arquivo sai de todo jeito (ele já está pronto e as linhas dele são as
    // certas); o que faltava era avisar, porque imprimir os dois em silêncio termina com o mesmo
    // código colado em dois rolos.
    const repetidas = linhas.length - movidas
    if (repetidas > 0) {
      avisos.push(
        `Atenção: o arquivo saiu com ${linhas.length} etiqueta(s), e ${repetidas} dela(s) já tinha(m) sido baixada(s) ou removida(s) por outra pessoa enquanto esta tela estava aberta. Se foi BAIXADA, o mesmo código também está no arquivo dela: confira antes de imprimir, para não colar o mesmo código em dois rolos. Se foi REMOVIDA, a etiqueta vai imprimir e é só jogar fora — o número dela fica queimado e nenhum outro rolo vai recebê-lo.`,
      )
    }

    // Mais pendentes do que o arquivo levou: o teto é do PostgREST, não desta tela. Sem dizer, o
    // almoxarife acha que levou tudo e só descobre porque a lista recarregada continua cheia.
    if (cortada) {
      avisos.push(
        `Ainda sobrou: este arquivo levou as ${linhas.length} etiqueta(s) mais novas, e o resto continua esperando impressão. Baixe o arquivo de novo para pegar a próxima leva.`,
      )
    }

    const aviso = avisos.length > 0 ? avisos.join(' ') : undefined

    // Depois de marcar: é a marcação que muda o estado, e `movidas` é o que separa "a leva era
    // minha" de "outra pessoa levou parte dela" — a disputa que termina com o mesmo código colado
    // em dois rolos. Sem `entidadeId`: a leva são N linhas, e `logs.entidade_id` é um uuid só.
    await anotar({
      entidade: 'etiqueta_legado',
      acao: 'gerar_etiqueta',
      descricao:
        `Arquivo ${fileName} baixado com ${linhas.length} etiqueta(s) do inventário rotativo ` +
        `(de ${linhas[0]?.codigo ?? ''} a ${linhas[linhas.length - 1]?.codigo ?? ''}), ` +
        `${movidas} marcada(s) como impressa(s)`,
      dados: {
        quantidade: linhas.length,
        movidas,
        /** Entraram no arquivo mas já tinham sido baixadas ou removidas por outra pessoa. */
        repetidas,
        cortada,
        primeiro: linhas[0]?.codigo ?? '',
        ultimo: linhas[linhas.length - 1]?.codigo ?? '',
      },
    })

    return {
      ok: true as const,
      csv,
      fileName,
      quantidade: linhas.length,
      cortada,
      ...(aviso ? { aviso } : {}),
    }
  } catch (e) {
    return { ok: false as const, erro: frase(e, 'baixar o arquivo') }
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
    return { ok: false as const, erro: frase(e, 'carregar as etiquetas impressas') }
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
    return { ok: false as const, erro: frase(e, 'baixar a etiqueta de novo') }
  }
}
