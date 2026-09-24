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
    // 12rem, calibrado: na largura cheia a lista mede ~248px num monitor de 1920px, com piso de
    // 228px, então 16rem (256px) e 20rem (320px) não disparavam a rolagem. Ver o comentário na tela.
    expect(classes).toContain('max-h-48')
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

describe('tela Sobre — largura', () => {
  it('a tela cobre a largura disponível, sem teto nem centralização no container', () => {
    const { container } = render(<SobrePage />)
    const raiz = container.firstElementChild as HTMLElement
    // O `<main>` do app-shell já dá o respiro nas laterais, como em Registros e Processos.
    expect(raiz.className).not.toContain('max-w-')
    expect(raiz.className).not.toContain('mx-auto')
  })

  it('só o texto corrido do cabeçalho tem largura de leitura', () => {
    render(<SobrePage />)
    expect(screen.getByText(/Sistema de gestão de chão de fábrica/).className).toContain('max-w-2xl')
  })

  it('grade, módulos e histórico ficam com a largura toda', () => {
    render(<SobrePage />)
    // O histórico é lista de changelog, não texto corrido: cada entrada cabe numa linha só.
    for (const bloco of [document.querySelector('dl'), document.querySelector('ul'), historico()]) {
      expect(bloco).not.toBeNull()
      expect((bloco as HTMLElement).className).not.toContain('max-w-')
    }
  })
})
