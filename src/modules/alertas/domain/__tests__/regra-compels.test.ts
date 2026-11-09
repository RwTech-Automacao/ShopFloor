import { describe, expect, it } from 'vitest'
import { resumoJanelaRegra, resumoLimite, validarRegra, type EntradaRegra } from '../regra'
import { formatarValorOcorrencia } from '../ocorrencia'
import { postoServeAoTipo, postosOferecidos } from '../postos-regra'
import { ehTipoRegra, NOME_TIPO_REGRA } from '../tipos'
import { TIPOS_REGRA_POR_MODULO, tipoPertenceAoModulo } from '../modulo'

const BASE: EntradaRegra = {
  modulo: 'shopfloor',
  tipo: 'compels',
  nome: 'Compels Valdei',
  postos: ['Almoxarifado'],
  taxaMinima: '',
  janelaTipo: '',
  janelaValor: null,
  minimoBipes: '',
  lembreteMin: 60,
  canais: ['telegram'],
  destinatarios: ['u1'],
  ativa: true,
}

function erroDe(e: EntradaRegra): string | null {
  const r = validarRegra(e)
  return r.ok ? null : r.erro
}

describe('o tipo compels', () => {
  it('existe, tem nome e é do ShopFloor (não do Recebimento)', () => {
    expect(ehTipoRegra('compels')).toBe(true)
    expect(NOME_TIPO_REGRA.compels).toBe('Problemas no envio ao Compels')
    expect(TIPOS_REGRA_POR_MODULO.shopfloor).toContain('compels')
    expect(tipoPertenceAoModulo('compels', 'recebimento')).toBe(false)
  })

  it('só serve ao posto de perfil Almoxarifado', () => {
    const almox = { chave: 'Almoxarifado', temStatus: false, coletaDefeito: false, almoxarifado: true }
    const teste = { chave: 'Teste', temStatus: true, coletaDefeito: true }
    expect(postoServeAoTipo('compels', almox)).toBe(true)
    expect(postoServeAoTipo('compels', teste)).toBe(false)
    expect(postosOferecidos('compels', [teste, almox], []).map((p) => p.chave)).toEqual(['Almoxarifado'])
  })
})

describe('validarRegra no tipo compels', () => {
  it('aceita e sai com janela de fachada e só os campos dele', () => {
    const r = validarRegra(BASE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.tipo).toBe('compels')
    expect(r.valor.postos).toEqual(['Almoxarifado'])
    expect(r.valor.janelaTipo).toBe('op')
    expect(r.valor.janelaValor).toBeNull()
    expect(r.valor.taxaMinima).toBeNull()
    expect(r.valor.minimoBipes).toBeNull()
    expect(r.valor.limiteTempoSeg).toBeNull()
    expect(r.valor.limiteOcorrencias).toBeNull()
    expect(r.valor.pausaMaxMin).toBeNull()
    expect(r.valor.horaResumo).toBeNull()
    expect(r.valor.limiteHoras).toBeNull()
    expect(r.valor.intervalos).toEqual([])
    expect(r.valor.lembreteMin).toBe(60)
  })

  it('o lembrete é configurável e opcional', () => {
    const vazio = validarRegra({ ...BASE, lembreteMin: null })
    expect(vazio.ok && vazio.valor.lembreteMin).toBe(null)
    const trinta = validarRegra({ ...BASE, lembreteMin: '30' })
    expect(trinta.ok && trinta.valor.lembreteMin).toBe(30)
    expect(erroDe({ ...BASE, lembreteMin: 0 })).toMatch(/lembrete/i)
  })

  it('ignora a janela, o limite em horas e os turnos que o formulário mandar', () => {
    const r = validarRegra({
      ...BASE, janelaTipo: 'tempo', janelaValor: 30, limiteHoras: 5,
      intervalos: [{ inicio: '07:00', fim: '12:00' }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.janelaTipo).toBe('op')
    expect(r.valor.janelaValor).toBeNull()
    expect(r.valor.limiteHoras).toBeNull()
    expect(r.valor.intervalos).toEqual([])
  })

  it('pede posto, responsável e canal como as outras', () => {
    expect(erroDe({ ...BASE, postos: [] })).toBe('Escolha pelo menos 1 posto.')
    expect(erroDe({ ...BASE, destinatarios: [] })).toBe('Escolha pelo menos 1 responsável.')
    expect(erroDe({ ...BASE, canais: [] })).toMatch(/canal/)
  })

  it('avisa só no canal do Discord, sem canais privados', () => {
    const r = validarRegra({ ...BASE, canais: [], avisarPessoas: false, avisarCanal: true })
    expect(r.ok).toBe(true)
  })

  it('o filtro de PMO é mantido', () => {
    const r = validarRegra({ ...BASE, pmos: [' PRT797 ', 'PRT797', 'PRT800'] })
    expect(r.ok && r.valor.pmos).toEqual(['PRT797', 'PRT800'])
  })

  it('não exige tipo de janela do formulário', () => {
    expect(erroDe({ ...BASE, janelaTipo: 'qualquer' })).toBeNull()
  })

  it('no Recebimento é recusado', () => {
    expect(erroDe({ ...BASE, modulo: 'recebimento' })).toBe('Este tipo de regra não existe no Recebimento.')
  })
})

describe('lista de regras e ocorrências do compels', () => {
  it('a coluna Limite e a Janela dizem o gatilho, não um número', () => {
    expect(resumoLimite({ tipo: 'compels', taxaMinima: null, limiteTempoSeg: null, limiteOcorrencias: null }))
      .toBe('Na primeira falha do envio')
    expect(resumoJanelaRegra({ tipo: 'compels', janelaTipo: 'op', janelaValor: null, horaResumo: null }))
      .toBe('Fila de envio ao Compels')
  })

  it('o valor da ocorrência é quantas linhas estão com problema', () => {
    expect(formatarValorOcorrencia('compels', 1)).toBe('1 linha')
    expect(formatarValorOcorrencia('compels', 4)).toBe('4 linhas')
    expect(formatarValorOcorrencia('compels', null)).toBe('—')
  })
})
