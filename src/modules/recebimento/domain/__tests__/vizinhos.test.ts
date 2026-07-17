import { describe, expect, it } from 'vitest'
import { vizinhosDaLista } from '../vizinhos'

const IDS = ['a', 'b', 'c', 'd']

describe('vizinhosDaLista', () => {
  it('id no meio → anterior e próximo com suas posições', () => {
    expect(vizinhosDaLista(IDS, 'b', null)).toEqual({
      anterior: { id: 'a', posicao: 0 },
      proximo: { id: 'c', posicao: 2 },
    })
  })

  it('id no começo → anterior null', () => {
    expect(vizinhosDaLista(IDS, 'a', null)).toEqual({
      anterior: null,
      proximo: { id: 'b', posicao: 1 },
    })
  })

  it('id no fim → próximo null', () => {
    expect(vizinhosDaLista(IDS, 'd', null)).toEqual({
      anterior: { id: 'c', posicao: 2 },
      proximo: null,
    })
  })

  it('id presente IGNORA a posição informada (auto-corrige)', () => {
    // a lista mudou desde que o link foi gerado: a posição real manda
    expect(vizinhosDaLista(IDS, 'b', 99)).toEqual({
      anterior: { id: 'a', posicao: 0 },
      proximo: { id: 'c', posicao: 2 },
    })
  })

  it('id AUSENTE com posição → usa a posição que ele ocupava', () => {
    // 'x' saiu do filtro; estava na posição 2. Quem estava em 3 agora está em 2.
    expect(vizinhosDaLista(IDS, 'x', 2)).toEqual({
      anterior: { id: 'b', posicao: 1 },
      proximo: { id: 'c', posicao: 2 },
    })
  })

  it('id ausente com posição no fim da lista → próximo null', () => {
    expect(vizinhosDaLista(IDS, 'x', 4)).toEqual({
      anterior: { id: 'd', posicao: 3 },
      proximo: null,
    })
  })

  it('id ausente com posição 0 → anterior null', () => {
    expect(vizinhosDaLista(IDS, 'x', 0)).toEqual({
      anterior: null,
      proximo: { id: 'a', posicao: 0 },
    })
  })

  it('id ausente SEM posição → ambos null (não inventa)', () => {
    expect(vizinhosDaLista(IDS, 'x', null)).toEqual({ anterior: null, proximo: null })
  })

  it('id ausente com posição negativa → ambos null', () => {
    expect(vizinhosDaLista(IDS, 'x', -1)).toEqual({ anterior: null, proximo: null })
  })

  it('lista vazia → ambos null', () => {
    expect(vizinhosDaLista([], 'a', 0)).toEqual({ anterior: null, proximo: null })
  })

  it('lista de 1 item, ele mesmo → ambos null', () => {
    expect(vizinhosDaLista(['a'], 'a', 0)).toEqual({ anterior: null, proximo: null })
  })

  it('não muta a entrada', () => {
    const ids = [...IDS]
    vizinhosDaLista(ids, 'b', null)
    expect(ids).toEqual(IDS)
  })
})
