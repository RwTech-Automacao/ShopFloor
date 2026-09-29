import { describe, it, expect } from 'vitest'
import { montarFoto, type LinhaOrdem, type LinhaRecebimento } from '../foto'

const AGORA = new Date('2026-09-29T15:07:00.000Z')

function recebimento(sobrepor: Partial<LinhaRecebimento> = {}): LinhaRecebimento {
  return {
    id: 'r1',
    projetos: 'ACP017/26 GM',
    numero_emb: 'EMB347EA',
    data_chegada: '2026-10-05',
    situacao: 'finalizado',
    ...sobrepor,
  }
}

function ordem(sobrepor: Partial<LinhaOrdem> = {}): LinhaOrdem {
  return {
    id: 'o1',
    projetos: 'ACP017/26',
    primeiro_registro: '2026-10-08',
    concluida: false,
    ...sobrepor,
  }
}

describe('montarFoto', () => {
  it('monta o envelope (versão, geradoEm em ISO)', () => {
    const foto = montarFoto([], [], AGORA)
    expect(foto.versao).toBe(1)
    expect(foto.geradoEm).toBe('2026-09-29T15:07:00.000Z')
    expect(foto.recebimentos).toEqual([])
    expect(foto.ordens).toEqual([])
  })

  it('mantém as datas no formato aaaa-mm-dd', () => {
    const foto = montarFoto([recebimento({ data_chegada: '2026-10-05' })], [ordem({ primeiro_registro: '2026-10-08' })], AGORA)
    expect(foto.recebimentos[0]!.dataChegada).toBe('2026-10-05')
    expect(foto.ordens[0]!.primeiroRegistro).toBe('2026-10-08')
  })

  it('data null vira null (não string vazia nem "null")', () => {
    const foto = montarFoto([recebimento({ data_chegada: null })], [ordem({ primeiro_registro: null })], AGORA)
    expect(foto.recebimentos[0]!.dataChegada).toBeNull()
    expect(foto.ordens[0]!.primeiroRegistro).toBeNull()
  })

  it('corta hora/fuso grudados numa data (blindagem, mesmo o Postgres já mandando só a data)', () => {
    const foto = montarFoto([recebimento({ data_chegada: '2026-10-05T00:00:00.000Z' })], [], AGORA)
    expect(foto.recebimentos[0]!.dataChegada).toBe('2026-10-05')
  })

  it('apara o ACP (projetos) de recebimentos e ordens', () => {
    const foto = montarFoto([recebimento({ projetos: '  ACP017/26 GM  ' })], [ordem({ projetos: '  ACP017/26  ' })], AGORA)
    expect(foto.recebimentos[0]!.projetos).toBe('ACP017/26 GM')
    expect(foto.ordens[0]!.projetos).toBe('ACP017/26')
  })

  it('projetos/numeroEmb nulos viram string vazia, nunca "null"', () => {
    const foto = montarFoto([recebimento({ projetos: null, numero_emb: null })], [ordem({ projetos: null })], AGORA)
    expect(foto.recebimentos[0]!.projetos).toBe('')
    expect(foto.recebimentos[0]!.numeroEmb).toBe('')
    expect(foto.ordens[0]!.projetos).toBe('')
  })

  it('passa as três situações do contrato', () => {
    const foto = montarFoto(
      [
        recebimento({ id: 'a', situacao: 'aberto' }),
        recebimento({ id: 'b', situacao: 'em_conferencia' }),
        recebimento({ id: 'c', situacao: 'finalizado' }),
      ],
      [],
      AGORA,
    )
    expect(foto.recebimentos.map((r) => r.situacao)).toEqual(['aberto', 'em_conferencia', 'finalizado'])
  })

  it('situação fora do contrato (ex.: "cancelado" vazando por bug da 0134) lança, não sincroniza nada', () => {
    expect(() => montarFoto([recebimento({ situacao: 'cancelado' })], [], AGORA)).toThrow(/situação fora do contrato/)
  })

  it('concluida só é true quando a linha crua mandou true (não trunca undefined/null pra true)', () => {
    const foto = montarFoto([], [ordem({ concluida: null }), ordem({ id: 'o2', concluida: true })], AGORA)
    expect(foto.ordens[0]!.concluida).toBe(false)
    expect(foto.ordens[1]!.concluida).toBe(true)
  })

  it('a foto não tem nenhuma chave além das do contrato v1', () => {
    const foto = montarFoto([recebimento()], [ordem()], AGORA)
    expect(Object.keys(foto).sort()).toEqual(['geradoEm', 'ordens', 'recebimentos', 'versao'])
    expect(Object.keys(foto.recebimentos[0]!).sort()).toEqual(['dataChegada', 'id', 'numeroEmb', 'projetos', 'situacao'])
    expect(Object.keys(foto.ordens[0]!).sort()).toEqual(['concluida', 'id', 'primeiroRegistro', 'projetos'])
  })
})
