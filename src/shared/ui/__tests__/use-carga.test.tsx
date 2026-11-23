import { describe, expect, it, vi } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import { startTransition, useEffect, useState, useTransition } from 'react'
import { useCarga } from '../use-carga'

/** Promessa controlada pelo teste: resolve/rejeita quando o teste mandar. */
function adiada<T>() {
  let resolver!: (v: T) => void
  let rejeitar!: (e: unknown) => void
  const promessa = new Promise<T>((res, rej) => {
    resolver = res
    rejeitar = rej
  })
  return { promessa, resolver, rejeitar }
}

/**
 * Simula a situação da produção: uma tela (o Dashboard) dispara uma carga lenta ao abrir e, enquanto ela não
 * volta, o usuário clica no menu. O "clique" aqui é um `startTransition(() => setTela(...))`, que é como o
 * `<Link>` do Next aplica a navegação.
 */
function Cenario({ modo, carga }: { modo: 'transicao-async' | 'use-carga'; carga: Promise<string> }) {
  const [tela, setTela] = useState('dashboard')
  const [, startCarga] = useTransition()
  const [, executar] = useCarga()
  useEffect(() => {
    if (modo === 'transicao-async') startCarga(async () => { await carga })
    else executar(() => carga, () => {})
  }, [modo, carga, startCarga, executar])
  return (
    <>
      <p data-testid="tela">{tela}</p>
      <button onClick={() => startTransition(() => setTela('parados'))}>Peças paradas</button>
    </>
  )
}

describe('navegação × carga lenta da tela anterior', () => {
  it('com startTransition(async) pendente, o clique fica preso (a causa dos 9 s)', async () => {
    const lenta = adiada<string>()
    render(<Cenario modo="transicao-async" carga={lenta.promessa} />)
    await act(async () => { screen.getByRole('button').click() })
    // A navegação entrou no mesmo lote da carga lenta: a tela antiga continua.
    expect(screen.getByTestId('tela').textContent).toBe('dashboard')
    await act(async () => { lenta.resolver('ok') })
    expect(screen.getByTestId('tela').textContent).toBe('parados')
  })

  it('com useCarga, o clique navega na hora, mesmo com a carga ainda pendente', async () => {
    const lenta = adiada<string>()
    render(<Cenario modo="use-carga" carga={lenta.promessa} />)
    await act(async () => { screen.getByRole('button').click() })
    expect(screen.getByTestId('tela').textContent).toBe('parados')
    await act(async () => { lenta.resolver('ok') })
  })
})

describe('useCarga', () => {
  it('liga carregando na hora e aplica o resultado ao voltar', async () => {
    const { result } = renderHook(() => useCarga())
    const p = adiada<number>()
    const aplicar = vi.fn()
    act(() => { result.current[1](() => p.promessa, aplicar) })
    expect(result.current[0]).toBe(true)
    await act(async () => { p.resolver(42) })
    expect(aplicar).toHaveBeenCalledWith(42)
    expect(result.current[0]).toBe(false)
  })

  it('só a última chamada é aplicada (resposta velha que volta depois é descartada)', async () => {
    const { result } = renderHook(() => useCarga())
    const velha = adiada<string>()
    const nova = adiada<string>()
    const aplicar = vi.fn()
    act(() => { result.current[1](() => velha.promessa, aplicar) })
    act(() => { result.current[1](() => nova.promessa, aplicar) })
    await act(async () => { nova.resolver('nova') })
    expect(result.current[0]).toBe(false)
    await act(async () => { velha.resolver('velha') })
    expect(aplicar).toHaveBeenCalledTimes(1)
    expect(aplicar).toHaveBeenCalledWith('nova')
  })

  it('segue carregando enquanto a última não volta, mesmo que a anterior já tenha voltado', async () => {
    const { result } = renderHook(() => useCarga())
    const velha = adiada<string>()
    const nova = adiada<string>()
    act(() => { result.current[1](() => velha.promessa, () => {}) })
    act(() => { result.current[1](() => nova.promessa, () => {}) })
    await act(async () => { velha.resolver('velha') })
    expect(result.current[0]).toBe(true)
    await act(async () => { nova.resolver('nova') })
    expect(result.current[0]).toBe(false)
  })

  it('erro: desliga carregando e chama aoFalhar', async () => {
    const { result } = renderHook(() => useCarga())
    const p = adiada<string>()
    const aoFalhar = vi.fn()
    act(() => { result.current[1](() => p.promessa, () => {}, aoFalhar) })
    await act(async () => { p.rejeitar(new Error('caiu')) })
    expect(result.current[0]).toBe(false)
    expect(aoFalhar).toHaveBeenCalledWith(expect.objectContaining({ message: 'caiu' }))
  })

  it('aplicar que lança não deixa carregando preso', async () => {
    const { result } = renderHook(() => useCarga())
    const p = adiada<string>()
    act(() => { result.current[1](() => p.promessa, () => { throw new Error('quebrou') }) })
    // O erro do `aplicar` sobe como rejeição não tratada (é o esperado); o ouvinte só evita que o vitest a
    // conte como falha do arquivo.
    const ouvinte = () => {}
    process.on('unhandledRejection', ouvinte)
    await act(async () => { p.resolver('x') })
    await new Promise((r) => setTimeout(r, 0))
    process.off('unhandledRejection', ouvinte)
    expect(result.current[0]).toBe(false)
  })

  it('depois de desmontar, não aplica nada', async () => {
    const { result, unmount } = renderHook(() => useCarga())
    const p = adiada<string>()
    const aplicar = vi.fn()
    act(() => { result.current[1](() => p.promessa, aplicar) })
    unmount()
    await act(async () => { p.resolver('x') })
    expect(aplicar).not.toHaveBeenCalled()
  })
})
