import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const status = vi.hoisted(() => ({ pending: false }))
vi.mock('next/link', () => ({ useLinkStatus: () => status }))

import { IndicadorLinkPendente } from '../indicador-link-pendente'

describe('IndicadorLinkPendente', () => {
  it('fica no DOM, invisível, quando a navegação não está pendente (o rótulo não pula)', () => {
    status.pending = false
    const { container } = render(<IndicadorLinkPendente />)
    const el = container.querySelector('[data-pendente]')!
    expect(el.getAttribute('data-pendente')).toBe('nao')
    expect(el.className).toContain('opacity-0')
    expect(el.className).not.toContain('animate-spin')
  })

  it('gira na hora do clique, enquanto a navegação está pendente', () => {
    status.pending = true
    const { container } = render(<IndicadorLinkPendente />)
    const el = container.querySelector('[data-pendente]')!
    expect(el.getAttribute('data-pendente')).toBe('sim')
    expect(el.className).toContain('animate-spin')
    expect(el.getAttribute('aria-hidden')).toBe('true')
  })
})
