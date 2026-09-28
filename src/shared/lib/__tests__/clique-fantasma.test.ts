import { describe, it, expect, afterEach, vi } from 'vitest'
import { blindarCliqueFantasma } from '../clique-fantasma'

/**
 * Troca `window.matchMedia` para simular os ponteiros do aparelho. `algumGrosso` responde a
 * `(any-pointer: coarse)` — a consulta que a blindagem faz — e `primarioGrosso`, a
 * `(pointer: coarse)`, só para provar que o ponteiro primário não decide nada aqui.
 */
function definirPonteiro({
  algumGrosso,
  primarioGrosso = algumGrosso,
}: {
  algumGrosso: boolean
  primarioGrosso?: boolean
}) {
  window.matchMedia = ((consulta: string) => ({
    matches:
      consulta === '(any-pointer: coarse)' ? algumGrosso : consulta === '(pointer: coarse)' ? primarioGrosso : false,
    media: consulta,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

/** Dispara um `click` real e cancelável no elemento dado (padrão: `document.body`). */
function clicar(alvo: Element = document.body): MouseEvent {
  const evento = new MouseEvent('click', { bubbles: true, cancelable: true })
  alvo.dispatchEvent(evento)
  return evento
}

describe('blindarCliqueFantasma', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('em ponteiro grosso, o primeiro clique depois de fechar é cancelado', () => {
    definirPonteiro({ algumGrosso: true })
    blindarCliqueFantasma()

    const evento = clicar()

    expect(evento.defaultPrevented).toBe(true)
  })

  it('o segundo clique na mesma janela de tempo passa normalmente', () => {
    definirPonteiro({ algumGrosso: true })
    blindarCliqueFantasma()

    clicar()
    const segundo = clicar()

    expect(segundo.defaultPrevented).toBe(false)
  })

  it('clique dentro de [data-slot="select-content"] ou [data-slot="select-trigger"] passa normalmente', () => {
    // Fake timers aqui: um clique em alvo legítimo não desarma a proteção (só um clique
    // fora dela conta), então sem avançar o relógio o listener ficaria pendurado no
    // `document` até os 350ms reais passarem, vazando para os testes seguintes.
    vi.useFakeTimers()
    definirPonteiro({ algumGrosso: true })
    const lista = document.createElement('div')
    lista.setAttribute('data-slot', 'select-content')
    const campo = document.createElement('button')
    campo.setAttribute('data-slot', 'select-trigger')
    document.body.append(lista, campo)

    try {
      blindarCliqueFantasma()
      const cliqueNaLista = clicar(lista)
      expect(cliqueNaLista.defaultPrevented).toBe(false)
      vi.advanceTimersByTime(400)

      blindarCliqueFantasma()
      const cliqueNoCampo = clicar(campo)
      expect(cliqueNoCampo.defaultPrevented).toBe(false)
      vi.advanceTimersByTime(400)
    } finally {
      lista.remove()
      campo.remove()
    }
  })

  it('passada a janela de tempo, o clique passa normalmente', () => {
    vi.useFakeTimers()
    definirPonteiro({ algumGrosso: true })
    blindarCliqueFantasma(350)

    vi.advanceTimersByTime(351)
    const evento = clicar()

    expect(evento.defaultPrevented).toBe(false)
  })

  it('em aparelho só com mouse (nenhum ponteiro grosso), nenhum clique é cancelado', () => {
    definirPonteiro({ algumGrosso: false })
    blindarCliqueFantasma()

    const evento = clicar()

    expect(evento.defaultPrevented).toBe(false)
  })

  it('ponteiro primário FINO com toque disponível (mini PC com mouse plugado): a proteção liga', () => {
    // O aparelho onde o bug foi relatado: tela de toque com mouse plugado. `(pointer: coarse)` é
    // falso ali, e era por isso que a blindagem não fazia nada justamente onde ela é necessária.
    definirPonteiro({ algumGrosso: true, primarioGrosso: false })
    blindarCliqueFantasma()

    const evento = clicar()

    expect(evento.defaultPrevented).toBe(true)
  })
})
