import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import { lerEnvioEstoque } from '../estoque-envios-repository'

// O envio de LOTE (0156): o worker tem que ler a linha (e mandar ao Compels a quantidade do lote), e não
// concluí-la como "ilegível". Um tipo de fato desconhecido continua ilegível (o teste do 'palete', no
// estoque-envios-repository.test.ts).
describe('fila de estoque: tipo lote (0156)', () => {
  it('a linha de lote reservada é lida, com a quantidade do lote', () => {
    const l = lerEnvioEstoque({
      id: 'e1', chave: 'ALMOX/PMOL01/9201/Almoxarifado/LOTE[abcd1234][5]/E1', operacao: 'entrada',
      pmo: 'PMOL01', op: '9201', posto: 'Almoxarifado', tipo: 'lote', bipe: 'LOTE[abcd1234][5]',
      serie_norm: '', quantidade: 5, tentativas: 1, criado_em: '2026-10-20T12:00:00Z',
    })
    expect(l).not.toBeNull()
    expect(l?.tipo).toBe('lote')
    expect(l?.quantidade).toBe(5)
    expect(l?.bipe).toBe('LOTE[abcd1234][5]')
  })
})
