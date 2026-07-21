import { describe, it, expect } from 'vitest'
import { prepararValoresProcesso } from '../preparar-valores-processo'
import type { CampoFormulario } from '../../infra/processo-detalhe-repository'

function campo(
  over: Partial<CampoFormulario> & {
    campo: string
    grupo: CampoFormulario['grupo']
    tipo: CampoFormulario['tipo']
  },
): CampoFormulario {
  return {
    rotulo: over.campo,
    listaChave: null,
    origem: 'comercial',
    obrigatorioFinalizacao: false,
    obrigatorioImportacao: false,
    ordem: 0,
    calculado: false,
    formula: null,
    formulaConfig: {},
    ...over,
  }
}

const deps = { fornecedoresCriticos: [], nqa: [], usuarioAtual: 'teste' }

describe('prepararValoresProcesso', () => {
  it('rejeita campo obrigatório vazio', () => {
    const campos = [
      campo({ campo: 'codigo_material', grupo: 'material', tipo: 'texto', obrigatorioImportacao: true, rotulo: 'Item Recebido' }),
    ]
    const r = prepararValoresProcesso(campos, {}, deps, {})
    expect(r).toEqual({ ok: false, erro: 'Campo obrigatório: Item Recebido.' })
  })

  it('monta só os grupos base (ignora recebimento/qualidade)', () => {
    const campos = [
      campo({ campo: 'fornecedor', grupo: 'comercial', tipo: 'texto' }),
      campo({ campo: 'codigo_material', grupo: 'material', tipo: 'texto' }),
      campo({ campo: 'responsavel', grupo: 'recebimento', tipo: 'texto' }),
    ]
    const r = prepararValoresProcesso(campos, {}, deps, {
      fornecedor: 'ACME',
      codigo_material: 'X1',
      responsavel: 'ignorar',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(Object.keys(r.valores).sort()).toEqual(['codigo_material', 'fornecedor'])
  })
})
