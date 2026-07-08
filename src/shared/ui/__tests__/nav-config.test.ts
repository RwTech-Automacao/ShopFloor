import { describe, it, expect } from 'vitest'
import { itensVisiveis, NAV_ITENS } from '../nav-config'
import type { Perfil } from '@/modules/auth/domain/perfil'

const perfil = (over: Partial<Perfil['permissoes']>): Perfil => ({
  id: 'x', nome: 'T', sistema: false,
  permissoes: {
    visualizar: true, importar: false, editar: false, finalizar: false,
    editar_finalizado: false, excluir: false, gerar_etiqueta: false, administrar: false,
    ...over,
  },
})

describe('itensVisiveis', () => {
  it('mostra Configurações apenas para quem administra', () => {
    const semAdmin = itensVisiveis(NAV_ITENS, perfil({}))
    const comAdmin = itensVisiveis(NAV_ITENS, perfil({ administrar: true }))
    expect(semAdmin.some((i) => i.chave === 'configuracoes')).toBe(false)
    expect(comAdmin.some((i) => i.chave === 'configuracoes')).toBe(true)
  })

  it('sempre mostra Recebimento para quem visualiza', () => {
    expect(itensVisiveis(NAV_ITENS, perfil({})).some((i) => i.chave === 'recebimento')).toBe(true)
  })
})
