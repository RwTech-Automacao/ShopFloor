import { describe, expect, it } from 'vitest'
import { textoDoEnvio } from '../envio'

const BASE = {
  posto: 'ALMOXARIFADO',
  resolvida_por_nome: 'Ana',
  resolvida_em: '2026-09-17T13:00:00+00:00',
}

describe('resolvido de uma ocorrência de parado', () => {
  it('não trata a chave PMO/OP como se fosse um defeito', () => {
    const t = textoDoEnvio('resolvido', {
      ...BASE,
      // A 0151 copia o.defeito (que no parado é a chave "PMO/OP") para dados.defeito.
      defeito: 'PMOG13/8563',
      pmo: 'PMOG13',
      op: '8563',
      ops: [{ pmo: 'PMOG13', op: '8563' }],
    })
    expect(t).not.toContain('Defeito')
    expect(t).toContain('✅ ALMOXARIFADO: resolvido por Ana')
    expect(t).toContain('OP PMOG13/8563')
    // A chave só aparece como a OP do sufixo, nunca como rótulo de defeito.
    expect(t.match(/PMOG13\/8563/gi)).toHaveLength(1)
  })

  it('a comparação aplica trim no PMO como o app faz', () => {
    const t = textoDoEnvio('resolvido', {
      ...BASE,
      defeito: 'PMOG13/8563',
      pmo: ' PMOG13 ',
      op: '8563',
    })
    expect(t).not.toContain('Defeito')
  })

  it('um defeito real continua com o rótulo "Defeito"', () => {
    expect(
      textoDoEnvio('resolvido', {
        posto: 'Teste',
        resolvida_por_nome: 'Bruno Líder',
        resolvida_em: '2026-09-17T17:05:00+00:00',
        defeito: '2040 COMPONENTE FALTANDO',
        pmo: 'PMOG13',
        op: '8563',
      }),
    ).toContain('✅ Defeito 2040 (Componente Faltando) no Teste: resolvido por Bruno Líder às 14:05')
  })
})
