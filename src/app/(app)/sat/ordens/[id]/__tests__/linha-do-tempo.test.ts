import { describe, expect, it } from 'vitest'
import type { EventoOrdem } from '@/modules/sat/infra/ordens-repository'
import { textoEvento } from '../linha-do-tempo'

const ev = (e: Partial<EventoOrdem>): EventoOrdem => ({ evento: 'etapa', etapaDe: null, etapaPara: null, dados: {}, usuarioNome: '', em: '', ...e })

describe('textoEvento', () => {
  it('etapas', () => {
    expect(textoEvento(ev({ etapaPara: 'recebido', dados: { nf: '4521' } }))).toBe('Recebido com a NF 4521')
    expect(textoEvento(ev({ etapaDe: 'recebido', etapaPara: 'nota_pendente', dados: { nf: '4521', nf_situacao: 'reprovada' } })))
      .toBe('Recebido → Nota pendente (NF 4521 reprovada)')
    expect(textoEvento(ev({ etapaDe: 'disponivel', etapaPara: 'em_manutencao', dados: { tecnico: 'Rita' } })))
      .toBe('Disponível para manutenção → Em manutenção — técnico Rita')
    expect(textoEvento(ev({ evento: 'correcao_etapa', etapaDe: 'qualidade', etapaPara: 'em_manutencao', dados: { motivo: 'outro defeito' } })))
      .toBe('Etapa corrigida: Qualidade → Em manutenção — motivo: outro defeito')
  })
  it('garantia, defeito, peça, laudo e NS', () => {
    expect(textoEvento(ev({ evento: 'garantia', dados: { tipo_de: null, tipo_para: 'em_garantia', ticket_de: '', ticket_para: '902' } })))
      .toBe('Garantia: Garantia a definir → Em garantia (ticket — → 902)')
    expect(textoEvento(ev({ evento: 'defeito', dados: { acao: 'incluido', defeito: 'Não liga', solucao: 'Trocada a fonte' } })))
      .toBe('Defeito lançado: Não liga — Trocada a fonte')
    expect(textoEvento(ev({ evento: 'defeito', dados: { acao: 'removido', defeito: 'Não liga', solucao: 'x' } })))
      .toBe('Defeito removido: Não liga — x')
    expect(textoEvento(ev({ evento: 'peca', dados: { acao: 'incluida', codigo: 'PMOE74', descricao: 'Kit', quantidade: 1.5 } })))
      .toBe('Peça lançada: 1,5 × PMOE74 Kit')
    expect(textoEvento(ev({ evento: 'peca', dados: { acao: 'removida', codigo: 'PRT1', descricao: '', quantidade: 1 } })))
      .toBe('Peça removida: 1 × PRT1')
    expect(textoEvento(ev({ evento: 'laudo', dados: { laudo: 'x' } }))).toBe('Laudo atualizado')
    expect(textoEvento(ev({ evento: 'ns', dados: { ns_antigo: '562-1', ns_novo: '562-9' } }))).toBe('NS trocado: 562-1 → 562-9')
  })
})
