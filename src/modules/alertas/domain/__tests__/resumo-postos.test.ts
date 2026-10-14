import { describe, it, expect } from 'vitest'
import { resumoPostos } from '../postos-regra'

/**
 * A coluna "Postos" da lista de regras imprimia a lista inteira separada por vírgula. Com os 12
 * postos marcados — que é o caso da regra de resumo diário — a célula virava um parágrafo e
 * esticava a linha da tabela inteira. Pedido do usuário em 14/10/2026.
 *
 * O caso "todos" é o que mais ajuda: dizer "Todos os postos" é mais curto E mais informativo do
 * que listar doze nomes, porque responde a pergunta que a pessoa tem ("falta algum?") em vez de
 * obrigá-la a conferir um a um.
 */
describe('resumoPostos', () => {
  const doze = ['Inspeção SPI', 'Inspeção SMD', 'Inspeção PTH', 'Teste', 'Burn-in', 'Teste Final',
    'Inspeção Final', 'Inspeção NQA', 'Inspeção SPI BOT', 'Inspeção SPI TOP', 'Inspeção AOI BOT',
    'Inspeção AOI TOP']

  it('a regra que tem TODOS os postos diz "Todos os postos"', () => {
    expect(resumoPostos(doze, doze)).toBe('Todos os postos')
  })

  it('um ou dois postos saem por extenso', () => {
    expect(resumoPostos(['Teste'], doze)).toBe('Teste')
    expect(resumoPostos(['Teste', 'Burn-in'], doze)).toBe('Teste, Burn-in')
  })

  it('mais de dois: os dois primeiros e quantos sobraram', () => {
    expect(resumoPostos(doze.slice(0, 5), doze)).toBe('Inspeção SPI, Inspeção SMD +3')
  })

  // A ordem é a da REGRA, não a alfabética: é a ordem do fluxo, e quem lê reconhece o começo da linha.
  it('mantém a ordem em que os postos vieram', () => {
    expect(resumoPostos(['Teste', 'Inspeção SPI', 'Burn-in', 'Inspeção NQA'], doze))
      .toBe('Teste, Inspeção SPI +2')
  })

  // "Todos" só vale se forem todos MESMO: faltando um, a pessoa precisa saber que falta.
  it('onze de doze NÃO é "Todos os postos"', () => {
    const onze = doze.slice(0, 11)
    expect(resumoPostos(onze, doze)).toBe('Inspeção SPI, Inspeção SMD +9')
  })

  // Catálogo vazio (nenhum posto cadastrado) não pode fazer uma regra vazia virar "Todos".
  it('regra sem posto nenhum fica vazia, mesmo com catálogo vazio', () => {
    expect(resumoPostos([], [])).toBe('')
    expect(resumoPostos([], doze)).toBe('')
  })

  it('posto que não está mais no catálogo continua contando', () => {
    expect(resumoPostos(['Posto Extinto', 'Teste'], doze)).toBe('Posto Extinto, Teste')
  })
})
