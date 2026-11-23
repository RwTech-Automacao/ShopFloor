'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Carrega dados de uma Server Action SEM usar `startTransition(async …)`.
 *
 * Por quê (perf/parados-clique-lento, 23/11/2026): enquanto uma transição assíncrona do React está pendente,
 * TODA transição nova entra no mesmo "lote" e só é aplicada quando a assíncrona termina. A navegação do
 * `<Link>` do Next é uma transição. Então, se uma tela dispara `startTransition(async () => await acao())` e a
 * ação demora 9 s (o Dashboard da Análise, ao abrir), qualquer clique no menu ou nas abas fica 9 s sem resposta:
 * a tela antiga continua lá e só depois aparece o "Carregando…" da tela nova. É limitação documentada do React
 * ("If there are multiple ongoing Transitions, React currently batches them together") e está no código do
 * react-dom (`entangleAsyncAction` / `currentEntangledLane`).
 *
 * Este hook faz a mesma coisa com estado comum: `carregando` liga na hora, a resposta é aplicada com um
 * `setState` normal e a navegação não espera por ela. Também descarta resposta velha: se `executar` for chamado
 * de novo antes da anterior voltar (troca de filtro, de página, de OP), só a ÚLTIMA chamada é aplicada.
 *
 * Uso:
 *   const [carregando, executar] = useCarga()
 *   executar(() => acao(filtro), (r) => { if (r.ok) setDados(r.dados) })
 */
export function useCarga(): [
  carregando: boolean,
  executar: <T>(buscar: () => Promise<T>, aplicar: (resultado: T) => void, aoFalhar?: (erro: unknown) => void) => void,
] {
  const [carregando, setCarregando] = useState(false)
  const ultima = useRef(0)
  const montado = useRef(true)

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  const executar = useCallback(
    <T,>(buscar: () => Promise<T>, aplicar: (resultado: T) => void, aoFalhar?: (erro: unknown) => void) => {
      const id = ++ultima.current
      setCarregando(true)
      const atual = () => montado.current && ultima.current === id
      buscar().then(
        (resultado) => {
          if (!atual()) return
          try {
            aplicar(resultado)
          } finally {
            setCarregando(false)
          }
        },
        (erro: unknown) => {
          if (!atual()) return
          setCarregando(false)
          if (aoFalhar) aoFalhar(erro)
          else console.error(erro)
        },
      )
    },
    [],
  )

  return [carregando, executar]
}
