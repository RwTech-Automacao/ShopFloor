import { describe, expect, it } from 'vitest'
import { resumoJanelaRegra, resumoLimite, validarRegra, type EntradaRegra } from '../regra'
import { postoServeAoTipo, postosOferecidos } from '../postos-regra'
import { DESCRICAO_TIPO_REGRA, ehTipoRegra, NOME_TIPO_REGRA, TIPOS_REGRA } from '../tipos'
import { TIPOS_REGRA_POR_MODULO, tipoPertenceAoModulo } from '../modulo'

const BASE: EntradaRegra = {
  modulo: 'shopfloor',
  tipo: 'ficha',
  nome: 'Ficha do Almoxarifado',
  postos: [],
  taxaMinima: '',
  janelaTipo: '',
  janelaValor: null,
  minimoBipes: '',
  lembreteMin: null,
  canais: [],
  destinatarios: ['u1'],
  avisarPessoas: false,
  avisarCanal: true,
  ativa: true,
}

function erroDe(e: EntradaRegra): string | null {
  const r = validarRegra(e)
  return r.ok ? null : r.erro
}

describe('o tipo ficha', () => {
  it('existe, tem nome e descrição e é do ShopFloor (não do Recebimento)', () => {
    expect(ehTipoRegra('ficha')).toBe(true)
    expect(TIPOS_REGRA).toContain('ficha')
    expect(NOME_TIPO_REGRA.ficha).toBe('Ficha de apontamento (Almoxarifado)')
    expect(DESCRICAO_TIPO_REGRA.ficha).toMatch(/caixa ou um lote/)
    expect(DESCRICAO_TIPO_REGRA.ficha).toMatch(/QR/)
    expect(TIPOS_REGRA_POR_MODULO.shopfloor).toContain('ficha')
    expect(tipoPertenceAoModulo('ficha', 'recebimento')).toBe(false)
  })

  it('não usa posto nenhum (a rota de cada OP diz onde é o Almoxarifado)', () => {
    const almox = { chave: 'Almoxarifado', temStatus: false, coletaDefeito: false, almoxarifado: true }
    const teste = { chave: 'Teste', temStatus: true, coletaDefeito: true }
    expect(postoServeAoTipo('ficha', almox)).toBe(false)
    expect(postosOferecidos('ficha', [teste, almox], [])).toEqual([])
  })
})

describe('validarRegra no tipo ficha', () => {
  it('aceita sem posto, sem janela, sem limite e sem lembrete', () => {
    const r = validarRegra(BASE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.tipo).toBe('ficha')
    expect(r.valor.postos).toEqual([])
    // Janela de fachada: o banco exige 'op' com valor nulo.
    expect(r.valor.janelaTipo).toBe('op')
    expect(r.valor.janelaValor).toBeNull()
    expect(r.valor.taxaMinima).toBeNull()
    expect(r.valor.minimoBipes).toBeNull()
    expect(r.valor.limiteTempoSeg).toBeNull()
    expect(r.valor.limiteOcorrencias).toBeNull()
    expect(r.valor.pausaMaxMin).toBeNull()
    expect(r.valor.horaResumo).toBeNull()
    expect(r.valor.limiteHoras).toBeNull()
    expect(r.valor.lembreteMin).toBeNull()
    expect(r.valor.intervalos).toEqual([])
    expect(r.valor.pmos).toEqual([])
  })

  it('ignora o tipo de janela que o formulário mandar', () => {
    const r = validarRegra({ ...BASE, janelaTipo: 'intervalos' })
    expect(r.ok && r.valor.janelaTipo).toBe('op')
  })

  it('RECUSA os campos que não são dele (a ficha é uma mensagem única por unidade)', () => {
    expect(erroDe({ ...BASE, lembreteMin: 60 })).toBe('A ficha de apontamento não usa este campo.')
    expect(erroDe({ ...BASE, janelaValor: 30 })).toBe('A ficha de apontamento não usa este campo.')
    expect(erroDe({ ...BASE, taxaMinima: '90' })).toBe('A ficha de apontamento não usa este campo.')
    expect(erroDe({ ...BASE, minimoBipes: '5' })).toBe('A ficha de apontamento não usa este campo.')
    expect(erroDe({ ...BASE, horaResumo: '18:00' })).toBe('A ficha de apontamento não usa este campo.')
  })

  it('o filtro de PMO é mantido (diferente do fim de EMB)', () => {
    const r = validarRegra({ ...BASE, pmos: [' PRT797 ', 'PRT797', 'PRT800'] })
    expect(r.ok && r.valor.pmos).toEqual(['PRT797', 'PRT800'])
  })

  it('pede responsável e canal como as outras', () => {
    expect(erroDe({ ...BASE, destinatarios: [] })).toBe('Escolha pelo menos 1 responsável.')
    expect(erroDe({ ...BASE, avisarPessoas: true, canais: [], avisarCanal: false })).toMatch(/canal/)
    expect(erroDe({ ...BASE, avisarPessoas: false, avisarCanal: false })).toMatch(/Escolha avisar/)
  })

  it('avisa por mensagem direta (telegram/email mandam o texto sem imagem)', () => {
    const r = validarRegra({ ...BASE, avisarPessoas: true, avisarCanal: false, canais: ['telegram', 'email'] })
    expect(r.ok && r.valor.canais).toEqual(['telegram', 'email'])
  })

  it('no Recebimento é recusado', () => {
    expect(erroDe({ ...BASE, modulo: 'recebimento' })).toBe('Este tipo de regra não existe no Recebimento.')
  })
})

describe('lista de regras da ficha', () => {
  it('a coluna Limite e a Janela dizem o gatilho', () => {
    expect(resumoLimite({ tipo: 'ficha', taxaMinima: null, limiteTempoSeg: null, limiteOcorrencias: null }))
      .toBe('Uma ficha por caixa ou lote')
    expect(resumoJanelaRegra({ tipo: 'ficha', janelaTipo: 'op', janelaValor: null, horaResumo: null }))
      .toBe('Entrada pendente no Almoxarifado')
  })
})
