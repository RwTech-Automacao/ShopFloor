import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { HISTORICO_VERSOES, VERSAO } from '@/shared/lib/versao'
import SobrePage from '../page'

function historico(): HTMLElement {
  // A lista do bloco "Histórico de versões" é a única <ol> da tela.
  const lista = document.querySelector('ol')
  expect(lista).not.toBeNull()
  return lista as HTMLElement
}

describe('tela Sobre', () => {
  it('mostra a versão do sistema', () => {
    render(<SobrePage />)
    expect(screen.getByText(`v${VERSAO}`)).toBeInTheDocument()
  })

  it('o histórico rola dentro de um teto em vez de esticar a página', () => {
    render(<SobrePage />)
    const classes = historico().className
    expect(classes).toContain('max-h-80')
    expect(classes).toContain('overflow-y-auto')
    // Teto em rem, não em vh: mesma caixa no celular e no desktop.
    expect(classes).not.toContain('vh')
  })

  it('a lista continua completa — o teto só corta o espaço, não as versões', () => {
    render(<SobrePage />)
    const lista = historico()
    expect(lista.querySelectorAll('li')).toHaveLength(HISTORICO_VERSOES.length)
    for (const v of HISTORICO_VERSOES) {
      expect(within(lista).getByText(v.versao)).toBeInTheDocument()
      expect(within(lista).getByText(v.resumo)).toBeInTheDocument()
    }
  })
})
