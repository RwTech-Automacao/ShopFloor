import { describe, it, expect, vi } from 'vitest'
import { DadosEnvioInvalidos, lerEnvioReservado, textoDoEnvio } from '../envio'
import { LIMITE_MENSAGEM, textoResumo } from '../mensagens'
import { entregarPendentes } from '../../application/enviar-alertas'

/** `dados` como a 0141 grava (jsonb_build_object do ramo do resumo). */
const DADOS = {
  regra_tipo: 'resumo',
  regra_nome: 'Resumo diário',
  dia: '2026-10-08',
  linhas: [
    { posto: 'Teste', aprovados: 95, reprovados: 5 },
    { posto: 'Burn-in', aprovados: 1, reprovados: 1 },
  ],
}

describe('envio do resumo', () => {
  it('lerEnvioReservado aceita o tipo resumo', () => {
    const e = lerEnvioReservado({ id: 'e1', canal: 'discord', tipo: 'resumo', externo_id: 'c1', dados: DADOS })
    expect(e).not.toBeNull()
    expect(e?.tipo).toBe('resumo')
    expect(e?.dados).toEqual(DADOS)
  })

  it('o texto sai igual ao de textoResumo, no dia certo (08/10, não 07/10)', () => {
    const esperado = textoResumo('Resumo diário', new Date('2026-10-08T12:00:00Z'), DADOS.linhas)
    expect(textoDoEnvio('resumo', DADOS)).toBe(esperado)
    expect(esperado).toContain('Resumo do dia 08/10')
    expect(esperado).toContain('Teste: 95,0% · 95 aprovados, 5 reprovados')
    expect(esperado).toContain('Burn-in: 50,0% · 1 aprovado, 1 reprovado')
  })

  it('muitos postos: o texto respeita o teto do Discord', () => {
    const linhas = Array.from({ length: 200 }, (_, i) => ({ posto: `Posto ${i}`, aprovados: 100, reprovados: 3 }))
    expect(textoDoEnvio('resumo', { ...DADOS, linhas }).length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
  })

  it.each([
    ['dia ausente', { ...DADOS, dia: undefined }],
    ['dia fora do formato', { ...DADOS, dia: '08/10/2026' }],
    ['linhas ausente', { ...DADOS, linhas: undefined }],
    ['linhas que não é array', { ...DADOS, linhas: 'x' }],
    ['linha que não é objeto', { ...DADOS, linhas: [3] }],
    ['posto vazio', { ...DADOS, linhas: [{ posto: '', aprovados: 1, reprovados: 0 }] }],
    ['aprovados não numérico', { ...DADOS, linhas: [{ posto: 'A', aprovados: 'x', reprovados: 0 }] }],
    ['reprovados negativo', { ...DADOS, linhas: [{ posto: 'A', aprovados: 1, reprovados: -1 }] }],
    ['regra_nome ausente', { ...DADOS, regra_nome: undefined }],
  ])('dados malformado (%s) lança, não sai resumo vazio', (_n, dados) => {
    expect(() => textoDoEnvio('resumo', dados as Record<string, unknown>)).toThrow(DadosEnvioInvalidos)
  })
})

describe('despacho com resumo malformado', () => {
  it('registra o erro com o id e os outros envios seguem', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const lerLinha = (id: string, tipo: string, dados: unknown) =>
      lerEnvioReservado({ id, canal: 'discord', tipo, externo_id: 'c1', destino_tipo: 'canal', dados })!
    const lote = [
      lerLinha('ruim', 'resumo', { ...DADOS, linhas: 'quebrado' }),
      lerLinha('bom', 'resumo', DADOS),
      lerLinha('teste', 'teste', { nome: 'Ana' }),
    ]
    const enviados: string[] = []
    const concluidos: string[] = []
    let entregue = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo: any = {
      reservarPendentes: async () => (entregue ? [] : ((entregue = true), lote)),
      concluirEnvio: async (e: { id: string }) => { concluidos.push(e.id) },
    }
    const porta = { enviar: async (_d: unknown, t: string) => { enviados.push(t); return { ok: true as const } } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await entregarPendentes({ discord: porta, telegram: porta } as any, repo)
    expect(concluidos).toEqual(['ruim', 'bom', 'teste'])
    expect(enviados).toHaveLength(2)
    expect(enviados[0]).toContain('📊 Resumo do dia 08/10')
    expect(erro.mock.calls.some((c) => String(c[0]).includes('ruim'))).toBe(true)
    erro.mockRestore()
  })
})
