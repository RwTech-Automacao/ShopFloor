import { ehEtapa, ehTipo, ROTULO_ETAPA, rotuloTipo } from '@/modules/sat/domain/ordem'
import type { EventoOrdem } from '@/modules/sat/infra/ordens-repository'

const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
const etapa = (v: unknown) => (ehEtapa(v) ? ROTULO_ETAPA[v] : '—')
const tipo = (v: unknown) => rotuloTipo(ehTipo(v) ? v : null)
const qtd = (v: unknown) => s(v).replace('.', ',')

/** Uma linha da linha do tempo da OS, em português. */
export function textoEvento(e: EventoOrdem): string {
  const d = e.dados
  switch (e.evento) {
    case 'etapa': {
      if (e.etapaDe === null) return `Recebido${s(d.nf) ? ` com a NF ${s(d.nf)}` : ''}`
      const nf = s(d.nf_situacao) ? ` (NF ${s(d.nf)} ${s(d.nf_situacao)})` : ''
      const tecnico = s(d.tecnico) ? ` — técnico ${s(d.tecnico)}` : ''
      return `${etapa(e.etapaDe)} → ${etapa(e.etapaPara)}${nf}${tecnico}`
    }
    case 'correcao_etapa':
      return `Etapa corrigida: ${etapa(e.etapaDe)} → ${etapa(e.etapaPara)} — motivo: ${s(d.motivo)}`
    case 'garantia':
      return `Garantia: ${tipo(d.tipo_de)} → ${tipo(d.tipo_para)} (ticket ${s(d.ticket_de) || '—'} → ${s(d.ticket_para) || '—'})`
    case 'defeito':
      return `Defeito ${d.acao === 'removido' ? 'removido' : 'lançado'}: ${s(d.defeito)} — ${s(d.solucao)}`
    case 'peca':
      return `Peça ${d.acao === 'removida' ? 'removida' : 'lançada'}: ${qtd(d.quantidade)} × ${[s(d.codigo), s(d.descricao)].filter(Boolean).join(' ')}`
    case 'laudo':
      return 'Laudo atualizado'
    case 'ns':
      return `NS trocado: ${s(d.ns_antigo)} → ${s(d.ns_novo)}`
    default:
      return s(e.evento)
  }
}
