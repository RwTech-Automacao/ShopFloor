export type TipoDefeito = 1 | 2

export interface Defeito {
  codigo: string
  tipo: TipoDefeito
}

/** trim + colapsa espaços internos + MAIÚSCULAS (fiel ao catálogo legado). */
export function normalizarCodigoDefeito(bruto: string): string {
  return bruto.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function validarDefeito(
  entrada: { codigo: string; tipo: number },
): { ok: true; valor: Defeito } | { ok: false; erro: string } {
  const codigo = normalizarCodigoDefeito(entrada.codigo)
  if (codigo === '') return { ok: false, erro: 'Informe o código do defeito.' }
  if (entrada.tipo !== 1 && entrada.tipo !== 2) {
    return { ok: false, erro: 'Selecione o tipo (peça ou teste).' }
  }
  return { ok: true, valor: { codigo, tipo: entrada.tipo } }
}

// ---------------------------------------------------------------------------
// Título do defeito (tela de Defeitos do Fluxo)
// ---------------------------------------------------------------------------

/** Partes do título de um defeito, já prontas pra exibir. */
export interface TituloDefeito {
  posicao: string
  numero: string
  descricao: string
  sigla: string
  texto: string
}

/**
 * Separa o código do catálogo em NÚMERO + DESCRIÇÃO. `sf_defeitos.codigo` guarda os dois no mesmo
 * texto ('2040 COMPONENTE FALTANDO') — é a chave da tabela, então não dá pra quebrar em colunas sem
 * migrar o catálogo inteiro. Sem número na frente ('TRILHA ROMPIDA') → tudo vira descrição.
 */
export function separarCodigoDefeito(codigo: string): { numero: string; descricao: string } {
  const m = /^\s*(\d+)\s*(.*)$/.exec(codigo ?? '')
  if (!m) return { numero: '', descricao: (codigo ?? '').trim() }
  return { numero: m[1]!, descricao: m[2]!.trim() }
}

/** 'COMPONENTE FALTANDO' → 'Componente Faltando' (o catálogo é todo MAIÚSCULO; grita na tela). */
export function capitalizarDescricaoDefeito(texto: string): string {
  return texto
    .toLocaleLowerCase('pt-BR')
    // Maiúscula na 1ª letra de cada palavra — casa letra precedida de não-letra (ou início), então
    // 'solda fria/pth' vira 'Solda Fria/Pth' sem precisar decidir separadores na mão.
    .replace(/(^|[^\p{L}\p{M}])(\p{L})/gu, (_, antes: string, letra: string) => antes + letra.toLocaleUpperCase('pt-BR'))
}

/** Tira acentos e caixa — comparar 'Peça' com 'PECA' sem depender de como foi digitado. */
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/**
 * Tipo do defeito COMO FOI REGISTRADO (`sf_registros.tipo_defeito`) — decisão do usuário.
 *
 * O campo é texto livre e vem de duas origens: o bipe grava 'Peça'/'Teste', e o formulário de
 * reprova manual grava onde o defeito aconteceu — 'SMD', 'PTH', 'TOP', 'BOT', 'Funcional',
 * 'Elétrico', 'Integração'. Mostramos o valor real em vez de reduzir a P/T pelo catálogo: 'SMD'
 * diz mais para quem acompanha a linha do que 'P'.
 *
 * Só normaliza a caixa (o mesmo tipo aparece como 'SMD' e 'smd' conforme quem cadastrou) e
 * devolve '' quando não há tipo, para o título não ficar com um ':' pendurado.
 */
export function tipoDefeitoExibido(tipo: string | number | null | undefined): string {
  if (tipo === null || tipo === undefined) return ''
  const t = String(tipo).trim()
  if (t === '') return ''
  // Siglas (SMD, PTH, TOP, BOT) ficam em caixa alta; palavras ficam Capitalizadas.
  return t.length <= 3 ? t.toUpperCase() : t[0]!.toUpperCase() + t.slice(1).toLowerCase()
}

/**
 * Título de UM defeito para a tela de acompanhamento, no formato pedido pelo usuário:
 *
 *     H1: Componente Faltando SMD: Cod.: 2040
 *     └┬┘  └───────┬────────┘ └┬┘  └────┬───┘
 *   posição    descrição     tipo    número do catálogo
 *
 * O tipo é o gravado no REGISTRO (decisão do usuário em 08/09), não a classificação peça/teste do
 * catálogo. Esta é a ÚNICA montagem do título no sistema — se o formato mudar, muda só aqui.
 * Partes ausentes simplesmente somem (sem deixar ': ' solto); tudo vazio → 'Defeito'.
 */
export function formatarTituloDefeito(entrada: {
  codigo: string
  posicao?: string | null
  tipo?: string | number | null
}): TituloDefeito {
  const { numero, descricao } = separarCodigoDefeito(entrada.codigo ?? '')
  const partes = {
    posicao: (entrada.posicao ?? '').trim(),
    numero,
    descricao: capitalizarDescricaoDefeito(descricao),
    sigla: tipoDefeitoExibido(entrada.tipo),
  }
  const pedacos: string[] = []
  if (partes.posicao) pedacos.push(`${partes.posicao}:`)
  if (partes.descricao) pedacos.push(partes.descricao)
  if (partes.sigla) pedacos.push(`${partes.sigla}:`)
  if (partes.numero) pedacos.push(`Cod.: ${partes.numero}`)
  // O ':' pertence ao pedaço da ESQUERDA; se o da direita não existe, ele fica pendurado no fim.
  const texto = pedacos.join(' ').replace(/:$/, '')
  return { ...partes, texto: texto || 'Defeito' }
}

// ---------------------------------------------------------------------------
// Agrupamento por defeito (painel de acompanhamento)
// ---------------------------------------------------------------------------

/** O que MUDA entre as peças que deram o mesmo defeito. */
export interface OcorrenciaDefeito {
  dataHora: string
  sn: string
  posicao: string
  tipo: string
  posto: string
  colaborador: string
}

/** Um defeito com todas as peças em que ele apareceu na janela olhada. */
export interface DefeitoAgrupado {
  codigo: string      // chave do catálogo, como está gravada ('103 NÃO COMUNICA TCP')
  numero: string      // '103'
  descricao: string   // 'Não Comunica Tcp'
  ocorrencias: OcorrenciaDefeito[] // mais recentes primeiro
}

/**
 * Junta as linhas de defeito num card POR DEFEITO, em vez de um por peça bipada.
 *
 * Ordena pelo que mais aconteceu — é o que a pessoa que acompanha a linha precisa ver primeiro.
 * Empate desempata pela ocorrência mais recente: entre dois defeitos com 2 cada, o que acabou de
 * acontecer sobe, porque é o que ainda está acontecendo agora.
 *
 * A ordem de entrada (mais recentes primeiro) é preservada dentro de cada grupo.
 */
export function agruparDefeitos(
  linhas: readonly (OcorrenciaDefeito & { codigo: string })[],
): DefeitoAgrupado[] {
  const grupos = new Map<string, DefeitoAgrupado>()
  for (const l of linhas) {
    const codigo = (l.codigo ?? '').trim()
    if (codigo === '') continue
    let g = grupos.get(codigo)
    if (!g) {
      const { numero, descricao } = separarCodigoDefeito(codigo)
      g = { codigo, numero, descricao: capitalizarDescricaoDefeito(descricao), ocorrencias: [] }
      grupos.set(codigo, g)
    }
    g.ocorrencias.push({
      dataHora: l.dataHora, sn: l.sn, posicao: l.posicao,
      tipo: l.tipo, posto: l.posto, colaborador: l.colaborador,
    })
  }
  return [...grupos.values()].sort(
    (a, b) => b.ocorrencias.length - a.ocorrencias.length
      || (b.ocorrencias[0]?.dataHora ?? '').localeCompare(a.ocorrencias[0]?.dataHora ?? ''),
  )
}
