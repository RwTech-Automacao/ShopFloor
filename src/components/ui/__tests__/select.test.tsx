import type * as React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { Select as SelectPrimitive } from '@base-ui/react/select'

type PropsRaiz = {
  children?: React.ReactNode
  onOpenChange?: (aberto: boolean, detalhes: SelectPrimitive.Root.ChangeEventDetails) => void
}

// `vi.mock` é hoisted para o topo do arquivo, então qualquer coisa que a fábrica use tem
// que vir de `vi.hoisted` — senão dá erro de acesso antes da inicialização.
const mocks = vi.hoisted(() => ({
  blindarCliqueFantasma: vi.fn(),
  propsRaiz: null as PropsRaiz | null,
}))

vi.mock('@/shared/lib/clique-fantasma', () => ({
  blindarCliqueFantasma: mocks.blindarCliqueFantasma,
}))

// Mocka só o `Select.Root` do Base UI, para observar exatamente o que `select.tsx` repassa
// a ele — sem depender de floating-ui/portal funcionando em jsdom.
vi.mock('@base-ui/react/select', () => ({
  Select: {
    Root: (props: PropsRaiz) => {
      mocks.propsRaiz = props
      return props.children ?? null
    },
  },
}))

import { Select } from '../select'

/** Objeto mínimo compatível com `SelectRootChangeEventDetails`, só para o teste. */
function detalhesFalsos(): SelectPrimitive.Root.ChangeEventDetails {
  return {
    reason: 'item-press',
    event: new MouseEvent('click'),
    cancel: () => {},
    allowPropagation: () => {},
    isCanceled: false,
    isPropagationAllowed: true,
    trigger: undefined,
  } as SelectPrimitive.Root.ChangeEventDetails
}

describe('Select', () => {
  beforeEach(() => {
    mocks.blindarCliqueFantasma.mockClear()
    mocks.propsRaiz = null
  })

  it('ao fechar, aciona a blindagem e repassa onOpenChange de quem usa, com os mesmos argumentos', () => {
    const onOpenChange = vi.fn()
    const detalhes = detalhesFalsos()
    render(<Select onOpenChange={onOpenChange} />)

    mocks.propsRaiz?.onOpenChange?.(false, detalhes)

    expect(mocks.blindarCliqueFantasma).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false, detalhes)
  })

  it('ao abrir, não aciona a blindagem, mas repassa onOpenChange igual', () => {
    const onOpenChange = vi.fn()
    const detalhes = detalhesFalsos()
    render(<Select onOpenChange={onOpenChange} />)

    mocks.propsRaiz?.onOpenChange?.(true, detalhes)

    expect(mocks.blindarCliqueFantasma).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(true, detalhes)
  })

  it('funciona sem onOpenChange (não é obrigatório passar um)', () => {
    render(<Select />)
    expect(() => mocks.propsRaiz?.onOpenChange?.(false, detalhesFalsos())).not.toThrow()
    expect(mocks.blindarCliqueFantasma).toHaveBeenCalled()
  })
})
