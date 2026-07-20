'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Acrescenta uma barra de rolagem horizontal "espelho" ACIMA da tabela,
 * sincronizada com a rolagem nativa do container do `Table`
 * (`[data-slot="table-container"]`, que já tem `overflow-x-auto`).
 *
 * Motivo: a tabela de processos é larga; sem isto o usuário precisa descer até
 * o fim da lista para achar a barra de rolagem lateral.
 *
 * A barra some sozinha quando o conteúdo cabe na tela (sem overflow) — inclusive
 * no mobile, onde a tabela fica `display:none` (a lista vira cards) e as medidas
 * dão zero.
 */
export function ScrollHorizontalTopo({ children }: { children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const topoRef = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(0)
  const [temOverflow, setTemOverflow] = useState(false)

  useEffect(() => {
    const wrapper = wrapperRef.current
    const topo = topoRef.current
    if (!wrapper || !topo) return
    const container = wrapper.querySelector<HTMLElement>('[data-slot="table-container"]')
    if (!container) return

    // Largura do espelho = largura real do conteúdo da tabela; a barra só
    // aparece se houver o que rolar. Re-consulta o container a cada medição
    // para não segurar um nó velho caso a navegação o substitua.
    const medir = () => {
      const alvo =
        wrapper.querySelector<HTMLElement>('[data-slot="table-container"]') ?? container
      setLargura(alvo.scrollWidth)
      setTemOverflow(alvo.scrollWidth > alvo.clientWidth)
    }

    // Agenda a medição no próximo frame: dá tempo do layout assentar depois de
    // montar/trocar dados (fontes e larguras de coluna só se acertam após o paint).
    let frame = 0
    const medirAgendado = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(medir)
    }
    medirAgendado()

    // Espelha a rolagem nos dois sentidos. Não há loop: atribuir o MESMO
    // scrollLeft não dispara um novo evento de scroll, então os dois convergem.
    const aoRolarTopo = () => {
      container.scrollLeft = topo.scrollLeft
    }
    const aoRolarTabela = () => {
      topo.scrollLeft = container.scrollLeft
    }
    topo.addEventListener('scroll', aoRolarTopo)
    container.addEventListener('scroll', aoRolarTabela)

    // Re-mede quando a janela/tabela muda de TAMANHO (redimensionar, colunas
    // mudarem de largura, sair do display:none do mobile).
    const observadorTamanho = new ResizeObserver(medirAgendado)
    observadorTamanho.observe(container)
    const tabela = container.querySelector('table')
    if (tabela) observadorTamanho.observe(tabela)

    // Re-mede quando o CONTEÚDO muda (ordenar/filtrar/paginar troca as linhas
    // sem mexer na caixa do container, então o ResizeObserver pode não disparar —
    // era esse o caso em que a barra do topo às vezes não reaparecia).
    const observadorConteudo = new MutationObserver(medirAgendado)
    observadorConteudo.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => {
      cancelAnimationFrame(frame)
      topo.removeEventListener('scroll', aoRolarTopo)
      container.removeEventListener('scroll', aoRolarTabela)
      observadorTamanho.disconnect()
      observadorConteudo.disconnect()
    }
  }, [])

  return (
    <div ref={wrapperRef}>
      {/* Barra espelho: só um espaçador da largura do conteúdo — quem desenha a
          barra é o próprio overflow do navegador. aria-hidden porque é um
          duplicado visual da rolagem que já existe na tabela. */}
      <div ref={topoRef} aria-hidden className={temOverflow ? 'overflow-x-auto' : 'hidden'}>
        <div style={{ width: largura, height: 1 }} />
      </div>
      {children}
    </div>
  )
}
