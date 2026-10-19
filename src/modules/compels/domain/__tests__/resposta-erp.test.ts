import { describe, expect, it } from 'vitest'
import { resultadoDaGravacao, textoLimpo } from '../resposta-erp'

describe('resultadoDaGravacao', () => {
  it('sucesso do Empenhar (200 com message)', () => {
    const r = resultadoDaGravacao(200, { message: 'Empenho realizado com sucesso!', result: null })
    expect(r).toEqual({ ok: true, mensagem: 'Empenho realizado com sucesso!' })
  })

  it('sucesso do Apontar (200 com success e msg em HTML)', () => {
    const corpo = {
      success: true,
      msg: "<center><font color='green'><b>Apontamento de Nº 1</b> realizada com sucesso!</font></center>",
    }
    expect(resultadoDaGravacao(200, corpo)).toEqual({ ok: true, mensagem: 'Apontamento de Nº 1 realizada com sucesso!' })
  })

  it('OP travada: HTTP 400, tenta de novo, mensagem sem HTML', () => {
    const corpo = {
      code: null,
      message: "Este registro está sendo acessado pelo usuário <b><font color='red'> fulano@x.com</b></font>!",
    }
    expect(resultadoDaGravacao(400, corpo)).toEqual({
      ok: false,
      codigo: 'op_em_uso',
      tentarDeNovo: true,
      mensagem: 'Este registro está sendo acessado pelo usuário fulano@x.com !',
    })
  })

  it('quantidade acima do permitido: HTTP 400, não tenta de novo', () => {
    const corpo = { message: 'Quantidade Empenhada é maior que a Quantidade da Composição. Item: RWPC99' }
    expect(resultadoDaGravacao(400, corpo)).toMatchObject({
      ok: false,
      codigo: 'quantidade_acima',
      tentarDeNovo: false,
    })
  })

  it('"excede a quantidade permitida" (estorno) também é quantidade acima', () => {
    expect(resultadoDaGravacao(400, { message: 'Quantidade Estornar excede a quantidade permitida.' })).toMatchObject({
      codigo: 'quantidade_acima',
    })
  })

  it('mensagem com "saldo" é falta de saldo e pode ser reenviada depois', () => {
    expect(resultadoDaGravacao(400, { message: 'Saldo insuficiente do item RWPC99.' })).toMatchObject({
      codigo: 'sem_saldo',
      tentarDeNovo: true,
    })
  })

  it('200 com success:false é recusa, não sucesso', () => {
    const r = resultadoDaGravacao(200, { success: false, msg: 'Algo deu errado' })
    expect(r).toMatchObject({ ok: false, mensagem: 'Algo deu errado' })
  })

  it('401 renova a sessão e tenta de novo; 403 não; 5xx tenta de novo', () => {
    expect(resultadoDaGravacao(401, {})).toMatchObject({ codigo: 'sessao_expirada', tentarDeNovo: true })
    expect(resultadoDaGravacao(403, {})).toMatchObject({ codigo: 'sem_permissao', tentarDeNovo: false })
    expect(resultadoDaGravacao(502, 'x')).toMatchObject({ codigo: 'indisponivel', tentarDeNovo: true })
  })

  it('erro sem mensagem mostra o código HTTP, sem inventar texto', () => {
    expect(resultadoDaGravacao(400, null)).toEqual({
      ok: false,
      codigo: 'desconhecido',
      tentarDeNovo: false,
      mensagem: 'O Compels recusou a gravação (HTTP 400).',
    })
  })
})

describe('textoLimpo', () => {
  it('tira tags e junta espaços', () => {
    expect(textoLimpo('<b>a</b>   <i>b</i>')).toBe('a b')
  })
})
