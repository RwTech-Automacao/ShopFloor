import {
  avaliarNota, lerNota, ordenarPorEmissao, TEXTO_MOTIVO,
  type DecisaoNota, type NotaPendente,
} from '../domain/baixa-nf'
import type { ResultadoGravacao } from '../domain/resposta-erp'

/** O pedaço do Compels que a rodada usa. Nos testes entra um Compels de mentira. */
export interface PortaBaixaNf {
  listarNfsPendentes(): Promise<Record<string, unknown>[]>
  itensDaNf(idNota: number): Promise<{ proprias: unknown[]; emTerceiros: unknown[]; deTerceiros: unknown[] }>
  travarNf(idNota: number): Promise<ResultadoGravacao>
  liberarNf(idNota: number): Promise<void>
  baixarNf(corpo: Record<string, unknown>): Promise<ResultadoGravacao>
}

export type ModoBaixaNf = 'simular' | 'baixar'

export interface ResultadoNota {
  numero: number
  emissao: string
  resultado: 'baixada' | 'simulada' | 'esperando' | 'manual' | 'falhou'
  detalhe: string
}

export interface ResumoRodadaNf {
  modo: ModoBaixaNf
  notas: ResultadoNota[]
}

export interface OpcoesRodada {
  modo: ModoBaixaNf
  /** `aaaa-mm-dd`: notas emitidas antes disso nunca são tocadas. */
  desde: string
  usuario: string
}

const itensTexto = (d: Extract<DecisaoNota, { acao: 'baixar' }>) =>
  d.itens.map((i) => `${i.quantidade} × ${i.codigo || '?'}`).join(', ')

/**
 * Uma rodada: lê as notas de saída pendentes, da mais antiga para a mais nova, e baixa as que têm saldo no PA
 * para TODOS os itens. Em `simular` nunca trava nem baixa — só diz o que faria. A trava da nota é sempre
 * liberada, mesmo quando o baixar falha.
 */
export async function baixarNfsPendentes(porta: PortaBaixaNf, op: OpcoesRodada): Promise<ResumoRodadaNf> {
  const notas = ordenarPorEmissao(
    (await porta.listarNfsPendentes()).map(lerNota).filter((n): n is NotaPendente => n !== null && n.emissao >= op.desde),
  )
  const saida: ResultadoNota[] = []
  for (const nota of notas) {
    const base = { numero: nota.numero, emissao: nota.emissao }
    try {
      const itens = await porta.itensDaNf(nota.id)
      const d = avaliarNota({ nota, ...itens, usuario: op.usuario })
      if (d.acao === 'esperar') { saida.push({ ...base, resultado: 'esperando', detalhe: TEXTO_MOTIVO[d.motivo] }); continue }
      if (d.acao === 'manual') { saida.push({ ...base, resultado: 'manual', detalhe: TEXTO_MOTIVO[d.motivo] }); continue }
      if (op.modo === 'simular') { saida.push({ ...base, resultado: 'simulada', detalhe: `baixaria ${itensTexto(d)}` }); continue }

      const trava = await porta.travarNf(nota.id)
      if (!trava.ok) { saida.push({ ...base, resultado: 'esperando', detalhe: `nota aberta no Compels: ${trava.mensagem}` }); continue }
      try {
        const r = await porta.baixarNf(d.corpo)
        saida.push(r.ok
          ? { ...base, resultado: 'baixada', detalhe: `${itensTexto(d)} — ${r.mensagem}` }
          : { ...base, resultado: 'falhou', detalhe: r.mensagem })
      } finally {
        await porta.liberarNf(nota.id).catch(() => undefined)
      }
    } catch (e) {
      saida.push({ ...base, resultado: 'falhou', detalhe: e instanceof Error ? e.message : String(e) })
    }
  }
  return { modo: op.modo, notas: saida }
}

/**
 * Configuração pelo ambiente. `null` = desligada (sem `COMPELS_BAIXA_NF_DESDE` ou modo desconhecido): a rota
 * não lê nem grava nada.
 */
export function configBaixaNf(env: Record<string, string | undefined> = process.env): OpcoesRodada | null {
  const desde = env.COMPELS_BAIXA_NF_DESDE?.trim() ?? ''
  const modoBruto = (env.COMPELS_BAIXA_NF ?? '').trim().toLowerCase()
  const modo: ModoBaixaNf | null = modoBruto === 'simular' ? 'simular' : ['1', 'true', 'sim'].includes(modoBruto) ? 'baixar' : null
  if (!modo || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) return null
  return { modo, desde, usuario: env.COMPELS_BAIXA_NF_USUARIO?.trim() || 'ShopFloor' }
}

const ROTULO_AVISO: Partial<Record<ResultadoNota['resultado'], string>> = {
  baixada: '✅ NF baixada automaticamente',
  simulada: '🧪 (simulação) a NF seria baixada',
  manual: '✋ NF precisa de baixa manual no Compels',
  falhou: '❌ Falha ao baixar NF',
}

/**
 * Mensagens do Discord desta rodada. Nota só "esperando saldo" não avisa. Cada nota avisa UMA vez por situação
 * (a chave vai para `jaAvisadas`, que vive enquanto o processo vive): a nota manual não repete a cada rodada.
 */
export function mensagensDeAviso(resumo: ResumoRodadaNf, jaAvisadas: Set<string>): string[] {
  const saida: string[] = []
  for (const n of resumo.notas) {
    const rotulo = ROTULO_AVISO[n.resultado]
    if (!rotulo) continue
    const chave = `${n.numero}|${n.resultado}|${n.detalhe}`
    if (jaAvisadas.has(chave)) continue
    jaAvisadas.add(chave)
    saida.push(`${rotulo}: **NF ${n.numero}** (emitida em ${n.emissao.split('-').reverse().join('/')}) — ${n.detalhe}`)
  }
  return saida
}
