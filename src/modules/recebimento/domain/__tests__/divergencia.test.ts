import { describe, expect, it } from 'vitest'
import { estadoDaDivergencia } from '../divergencia'

describe('estadoDaDivergencia', () => {
  it('sem divergência: nenhum selo, mesmo com texto guardado', () => {
    // A divergência SOME quando a quantidade é corrigida, e o texto fica. Ver a spec.
    for (const d of ['0', '', '   ', null, undefined, '0,0']) {
      expect(estadoDaDivergencia(d, 'o fornecedor dividiu a entrega'), String(d)).toBe('sem')
    }
  })
  it('divergência sem justificativa: pendente', () => {
    for (const j of ['', '   ', null, undefined]) {
      expect(estadoDaDivergencia('-42', j), String(j)).toBe('pendente')
    }
  })
  it('divergência com justificativa: justificada', () => {
    expect(estadoDaDivergencia('-42', 'faltou, o fornecedor manda na semana que vem')).toBe('justificada')
  })
  it('divergência positiva também vale', () => {
    expect(estadoDaDivergencia('58', null)).toBe('pendente')
    expect(estadoDaDivergencia('58', 'veio a mais, combinado abater no próximo')).toBe('justificada')
  })
  it('vírgula decimal é divergência', () => {
    expect(estadoDaDivergencia('1,5', null)).toBe('pendente')
    expect(estadoDaDivergencia('-0,5', null)).toBe('pendente')
  })
  it('texto que não é número não conta como divergência', () => {
    expect(estadoDaDivergencia('N/A', null)).toBe('sem')
  })
})
