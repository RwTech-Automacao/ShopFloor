import { CANAIS, NOME_CANAL, ehJanelaTipo, type Canal, type JanelaTipo } from './tipos'

/** O que vem do formulário (tudo pode chegar como texto). */
export interface EntradaRegra {
  nome: string
  postos: string[]
  taxaMinima: string | number
  janelaTipo: string
  janelaValor: string | number | null
  minimoBipes: string | number
  lembreteMin: string | number | null
  canais: string[]
  destinatarios: string[]
  ativa: boolean
}

/** A regra já conferida, pronta para o banco. */
export interface RegraValida {
  nome: string
  postos: string[]
  taxaMinima: number
  janelaTipo: JanelaTipo
  janelaValor: number | null
  minimoBipes: number
  lembreteMin: number | null
  canais: Canal[]
  destinatarios: string[]
  ativa: boolean
}

export interface RegraAlerta extends RegraValida {
  id: string
  atualizadoEm: string
}

export interface DestinatarioDisponivel {
  usuarioId: string
  nome: string
  email: string
  telegram: boolean
  discord: boolean
}

/** Padrões da spec (seção 2). */
export const PADROES_REGRA = { taxaMinima: 90, janelaTempo: 60, janelaBipes: 50, minimoBipes: 20 }

const RE_DECIMAL = /^\d{1,3}([.,]\d{1,2})?$/

function textoLimpo(v: string | number | null | undefined): string {
  return String(v ?? '').trim()
}

/** Número inteiro ou null (vazio). NaN quando o texto não é número. */
function inteiro(v: string | number | null | undefined): number | null {
  const s = textoLimpo(v).replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isInteger(n) ? n : Number.NaN
}

function unicos(lista: string[]): string[] {
  return [...new Set(lista.map((x) => x.trim()).filter((x) => x !== ''))]
}

export function validarRegra(e: EntradaRegra): { ok: true; valor: RegraValida } | { ok: false; erro: string } {
  const nome = textoLimpo(e.nome).replace(/\s+/g, ' ')
  if (nome === '') return { ok: false, erro: 'Informe o nome da regra.' }

  const postos = unicos(e.postos)
  if (postos.length === 0) return { ok: false, erro: 'Escolha pelo menos 1 posto.' }

  const taxaTexto = textoLimpo(e.taxaMinima)
  const taxa = Number(taxaTexto.replace(',', '.'))
  if (taxaTexto === '' || !Number.isFinite(taxa) || taxa < 0 || taxa > 100) {
    return { ok: false, erro: 'A taxa mínima deve ficar entre 0 e 100.' }
  }
  // Conferido no TEXTO: em ponto flutuante 90,125 "arredonda" e passaria escondido.
  if (!RE_DECIMAL.test(taxaTexto)) return { ok: false, erro: 'A taxa mínima aceita até 2 casas decimais.' }

  if (!ehJanelaTipo(e.janelaTipo)) return { ok: false, erro: 'Escolha a janela da regra.' }
  const janelaTipo: JanelaTipo = e.janelaTipo

  let janelaValor: number | null = null
  if (janelaTipo !== 'op') {
    const v = inteiro(e.janelaValor)
    if (v === null || Number.isNaN(v) || v <= 0) {
      return {
        ok: false,
        erro: janelaTipo === 'tempo' ? 'Informe quantos minutos a janela olha.' : 'Informe quantos bipes a janela olha.',
      }
    }
    janelaValor = v
  }

  const minimoBipes = inteiro(e.minimoBipes)
  if (minimoBipes === null || Number.isNaN(minimoBipes) || minimoBipes <= 0) {
    return { ok: false, erro: 'O mínimo de bipes deve ser um número inteiro maior que zero.' }
  }
  // Janela de 10 bipes com mínimo de 20 NUNCA decidiria nada — melhor recusar do que ficar muda.
  if (janelaTipo === 'bipes' && janelaValor !== null && janelaValor < minimoBipes) {
    return { ok: false, erro: 'A janela de bipes precisa ser maior ou igual ao mínimo de bipes.' }
  }

  const lembrete = inteiro(e.lembreteMin)
  if (lembrete !== null && (Number.isNaN(lembrete) || lembrete <= 0)) {
    return { ok: false, erro: 'O lembrete deve ser um número inteiro de minutos (ou vazio).' }
  }

  const canais = CANAIS.filter((c) => e.canais.includes(c))
  if (canais.length === 0) return { ok: false, erro: 'Escolha pelo menos 1 canal.' }

  const destinatarios = unicos(e.destinatarios)
  if (destinatarios.length === 0) return { ok: false, erro: 'Escolha pelo menos 1 destinatário.' }

  return {
    ok: true,
    valor: {
      nome,
      postos,
      taxaMinima: taxa,
      janelaTipo,
      janelaValor,
      minimoBipes,
      lembreteMin: lembrete,
      canais: [...canais],
      destinatarios,
      ativa: e.ativa,
    },
  }
}

/** A prévia só precisa de postos + janela + mínimo (nome/canais/destinatários ainda podem faltar). */
export function validarPrevia(e: {
  postos: string[]
  janelaTipo: string
  janelaValor: string | number | null
  minimoBipes: string | number
}):
  | { ok: true; valor: { postos: string[]; janelaTipo: JanelaTipo; janelaValor: number | null; minimoBipes: number } }
  | { ok: false; erro: string } {
  const r = validarRegra({
    nome: 'previa',
    postos: e.postos,
    taxaMinima: 100,
    janelaTipo: e.janelaTipo,
    janelaValor: e.janelaValor,
    minimoBipes: e.minimoBipes,
    lembreteMin: null,
    canais: ['telegram'],
    destinatarios: ['previa'],
    ativa: true,
  })
  if (!r.ok) return r
  return {
    ok: true,
    valor: {
      postos: r.valor.postos,
      janelaTipo: r.valor.janelaTipo,
      janelaValor: r.valor.janelaValor,
      minimoBipes: r.valor.minimoBipes,
    },
  }
}

/** Avisos do diálogo: quem está escolhido mas não recebe por algum canal marcado. */
export function destinatariosSemCanal(
  disponiveis: DestinatarioDisponivel[],
  selecionados: string[],
  canais: Canal[],
): string[] {
  return disponiveis
    .filter((d) => selecionados.includes(d.usuarioId))
    .flatMap((d) => canais.filter((c) => !d[c]).map((c) => `${d.nome} sem ${NOME_CANAL[c]}`))
}
