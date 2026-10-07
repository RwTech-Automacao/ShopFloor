import { describe, it, expect } from 'vitest'
import { ehRotaDeDadosDoDashboard } from '../rotas-dashboard'

describe('ehRotaDeDadosDoDashboard', () => {
  it('reconhece a API de dados do dashboard', () => {
    expect(ehRotaDeDadosDoDashboard('/api/dashboard')).toBe(true)
    expect(ehRotaDeDadosDoDashboard('/api/dashboard/ops-ativas')).toBe(true)
  })

  it('não reconhece caminho que só COMEÇA parecido', () => {
    for (const p of ['/api/dashboardx', '/api/dashboards/ops-ativas', '/api/dashboardops-ativas']) {
      expect(ehRotaDeDadosDoDashboard(p), p).toBe(false)
    }
  })

  it('não reconhece a tela do dashboard nem outras rotas do app', () => {
    for (const p of ['/shopfloor/dashboard', '/home', '/api/alertas/avaliar', '/embed/fluxo/PMOC13/2340']) {
      expect(ehRotaDeDadosDoDashboard(p), p).toBe(false)
    }
  })
})
