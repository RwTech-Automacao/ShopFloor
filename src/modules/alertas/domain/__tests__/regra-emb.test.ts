import { describe, it, expect } from 'vitest'
import { resumoJanelaRegra, resumoLimite, validarRegra, type EntradaRegra } from '../regra'

function entrada(o: Partial<EntradaRegra> = {}): EntradaRegra {
  return {
    modulo: 'recebimento',
    tipo: 'emb',
    nome: 'Fim de EMB',
    postos: [],
    taxaMinima: '',
    janelaTipo: '',
    janelaValor: null,
    minimoBipes: '',
    lembreteMin: null,
    canais: ['telegram'],
    destinatarios: ['u1'],
    ativa: true,
    ...o,
  }
}

describe('validarRegra no tipo emb', () => {
  it('aceita sem posto, sem janela e sem limite', () => {
    const r = validarRegra(entrada())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.postos).toEqual([])
    // A janela é de fachada: 'op' com valor nulo é o que o banco aceita sem mexer nos checks.
    expect(r.valor.janelaTipo).toBe('op')
    expect(r.valor.janelaValor).toBeNull()
    expect(r.valor.pmos).toEqual([])
    expect(r.valor.taxaMinima).toBeNull()
    expect(r.valor.minimoBipes).toBeNull()
    expect(r.valor.lembreteMin).toBeNull()
    expect(r.valor.horaResumo).toBeNull()
    expect(r.valor.intervalos).toEqual([])
    // O check `alerta_regras_campos_por_tipo` da 0150 também exige estes três nulos no ramo 'emb'.
    expect(r.valor.limiteTempoSeg).toBeNull()
    expect(r.valor.limiteOcorrencias).toBeNull()
    expect(r.valor.pausaMaxMin).toBeNull()
  })

  // ⚠️ Como o resumo diário (regra-resumo.test.ts): o janelaTIPO que o formulário mandar é
  // IGNORADO (sai sempre 'op'), e o janelaVALOR preenchido é RECUSADO, porque ele é campo de
  // medida como a taxa e os bipes. São duas regras diferentes para dois campos diferentes.
  it('ignora o tipo de janela que o formulário mandar (como o resumo diário faz)', () => {
    const r = validarRegra(entrada({ janelaTipo: 'intervalos' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.janelaTipo).toBe('op')
    expect(r.valor.janelaValor).toBeNull()
  })

  it('recusa janelaValor preenchido, como os demais campos alheios', () => {
    expect(validarRegra(entrada({ janelaValor: '60' }))).toEqual({
      ok: false,
      erro: 'O aviso de fim de EMB não usa este campo.',
    })
  })

  it('ignora posto e PMO que o formulário mandar', () => {
    const r = validarRegra(entrada({ postos: ['Teste'], pmos: ['PMOA'] }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valor.postos).toEqual([])
      expect(r.valor.pmos).toEqual([])
    }
  })

  it('recusa o campo de medida que não é dele', () => {
    expect(validarRegra(entrada({ taxaMinima: '90' })).ok).toBe(false)
    expect(validarRegra(entrada({ limiteOcorrencias: '5' })).ok).toBe(false)
    expect(validarRegra(entrada({ lembreteMin: '30' })).ok).toBe(false)
    expect(validarRegra(entrada({ horaResumo: '18:00' })).ok).toBe(false)
  })

  it('continua exigindo nome, responsável e um canal', () => {
    expect(validarRegra(entrada({ nome: '  ' }))).toEqual({ ok: false, erro: 'Informe o nome da regra.' })
    expect(validarRegra(entrada({ destinatarios: [] })).ok).toBe(false)
    expect(validarRegra(entrada({ canais: [] })).ok).toBe(false)
  })

  it('o tipo emb só existe no Recebimento', () => {
    expect(validarRegra(entrada({ modulo: 'shopfloor' })).ok).toBe(false)
  })

  it('a lista mostra frase própria em Janela e em Limite, nunca o valor cru', () => {
    const r = validarRegra(entrada())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(resumoJanelaRegra(r.valor)).toBe('Quando a EMB fecha')
    expect(resumoLimite(r.valor)).toBe('Todos os processos no fim')
    // 'op' nunca aparece: seria uma janela que a regra não tem.
    expect(resumoJanelaRegra(r.valor)).not.toContain('OP')
  })
})
