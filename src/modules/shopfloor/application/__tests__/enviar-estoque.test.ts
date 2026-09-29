import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type {
  EnvioEstoqueReservado,
  RepositorioEstoqueEnvios,
  ResultadoEnvioEstoque,
} from '../enviar-estoque'
import { entregarEstoquePendente } from '../enviar-estoque'
import { enviarMovimentacaoCompels } from '../../infra/compels'

/**
 * Uma linha da fila de mentira. `ordem` faz o papel de `criado_em` (menor = mais antiga), e
 * `reservada` o da reserva viva — sem precisar de relógio nos testes.
 *
 * `retida` é o teste DIZENDO que o banco não devolve esta linha nesta rodada (um estorno esperando a
 * entrada dele, por exemplo). É uma afirmação do teste sobre o que a reserva decidiu, e não uma
 * regra recalculada aqui — ver o comentário do repoFalso.
 */
interface LinhaFila {
  id: string
  chave: string
  operacao: 'entrada' | 'estorno'
  bipe: string
  serieNorm: string
  quantidade: number
  ordem: number
  tentativas: number
  reservada: boolean
  ok: boolean
  erro: string | null
  cancelada: boolean
  retida: boolean
}

function linha(p: Partial<LinhaFila> & { chave: string; ordem: number }): LinhaFila {
  return {
    id: `id-${p.chave}`,
    operacao: 'entrada',
    bipe: 'CX[1][3]9900-PMOT01',
    serieNorm: '',
    quantidade: 3,
    tentativas: 0,
    reservada: false,
    ok: false,
    erro: null,
    cancelada: false,
    retida: false,
    ...p,
  }
}

/**
 * Repositório de mentira com uma FILA DE VERDADE: `reservarPendentes` faz o que a `sf_estoque_reservar`
 * (0132) faz e que o LAÇO consegue notar — pendentes (não ok, não canceladas, tentativas < 5, sem
 * reserva viva), novas antes dos reenvios, mais antigas primeiro, tentativa contada na reserva, e o
 * lote aparado pelo limite.
 *
 * O QUE ELA DE PROPÓSITO NÃO FAZ: a ordem do par (estorno não sai antes da entrada dele). Ela está no
 * filtro da `sf_estoque_reservar`, é o BANCO que a impõe, e é lá que ela está provada com dentes —
 * testes 17, 18 e 19 de `supabase/tests/estoque_envios_test.sql` e 46 de `almoxarifado_test.sql`, que
 * rodam contra um Postgres de verdade. Esta fila já reimplementou o predicado uma vez, e o preço foi
 * caro: como ela o copiava COM o defeito (`qualquer anterior && !e.ok`), nenhum dos dez testes daqui
 * podia pegar o Critical da revisão — e os dois testes que diziam cobrir a ordem do par passavam mesmo
 * com o laço embaralhando o lote, porque quem impunha a regra era a própria mentira deles.
 *
 * Então aqui a fila devolve o que o teste montar: quando o teste quer dizer "o banco segurou esta
 * linha", ele marca `retida`. O que se prova deste lado é só o que é do laço: que ele entrega o lote
 * COMO O BANCO O DEU e não vai atrás de linha que o banco não devolveu (nem pra enviar, nem pra cobrar
 * tentativa — tentativa cobrada de linha que ninguém tentou a tira da fila em cinco rodadas).
 */
function repoFalso(fila: LinhaFila[]) {
  const reservas: number[] = []
  const repo: RepositorioEstoqueEnvios = {
    async reservarPendentes(limite: number) {
      reservas.push(limite)
      const elegiveis = fila
        .filter((l) => !l.ok && !l.cancelada && l.tentativas < 5 && !l.reservada && !l.retida)
        .sort((a, b) => Number(a.tentativas > 0) - Number(b.tentativas > 0) || a.ordem - b.ordem)
        .slice(0, limite)
      for (const l of elegiveis) {
        l.tentativas += 1
        l.reservada = true
      }
      const envios = elegiveis.map<EnvioEstoqueReservado>((l) => ({
        id: l.id,
        chave: l.chave,
        operacao: l.operacao,
        pmo: 'PMOT01',
        op: '9900',
        posto: 'Almoxarifado',
        tipo: l.serieNorm === '' ? 'caixa' : 'serie',
        bipe: l.bipe,
        serieNorm: l.serieNorm,
        quantidade: l.quantidade,
        tentativas: l.tentativas,
        criadoEm: `2026-09-29T10:${String(l.ordem).padStart(2, '0')}:00Z`,
      }))
      // Fila de mentira não tem linha ilegível: aqui a linha é um objeto do próprio teste. Quem prova
      // o caminho da ilegível é o teste do lote roteirizado, mais abaixo, e o do repositório.
      return { envios, ilegiveis: 0 }
    },
    async concluirEnvio(envio: EnvioEstoqueReservado, resultado: ResultadoEnvioEstoque) {
      const l = fila.find((x) => x.id === envio.id)
      // as duas cercas do repositório de verdade: a tentativa desta reserva e a linha não cancelada
      if (!l || l.tentativas !== envio.tentativas || l.cancelada) return
      l.ok = resultado.ok
      l.erro = resultado.ok ? null : resultado.erro
      l.reservada = false
    },
  }
  return { repo, reservas }
}

/** Porta do ERP de mentira: registra o que passou por ela e falha sob comando. */
function compelsFalso(opcoes: { falharPara?: string[]; lancarPara?: string[] } = {}) {
  const enviados: string[] = []
  async function compels(envio: EnvioEstoqueReservado): Promise<ResultadoEnvioEstoque> {
    if (opcoes.lancarPara?.includes(envio.chave)) throw new Error('rede caiu')
    enviados.push(envio.chave)
    if (opcoes.falharPara?.includes(envio.chave)) return { ok: false, erro: 'ERP 500: fora do ar' }
    return { ok: true }
  }
  return { compels, enviados }
}

describe('entregarEstoquePendente — o laço da fila de estoque', () => {
  it('lote vazio: não chama o ERP e não explode', async () => {
    const { repo, reservas } = repoFalso([])
    const { compels, enviados } = compelsFalso()
    const resumo = await entregarEstoquePendente(compels, repo)
    expect(resumo).toEqual({ enviados: 0, falhas: 0 })
    expect(enviados).toEqual([])
    // reservou uma vez (e parou: lote vazio não é lote cheio)
    expect(reservas).toHaveLength(1)
  })

  it('entrega o lote e grava o resultado na linha', async () => {
    const fila = [linha({ chave: 'A/E1', ordem: 1 }), linha({ chave: 'A/E2', ordem: 2 })]
    const { repo } = repoFalso(fila)
    const { compels, enviados } = compelsFalso()
    const resumo = await entregarEstoquePendente(compels, repo)
    expect(resumo).toEqual({ enviados: 2, falhas: 0 })
    expect(enviados).toEqual(['A/E1', 'A/E2'])
    expect(fila.every((l) => l.ok && l.erro === null && !l.reservada)).toBe(true)
  })

  it('linha que falha: tentativa contada, erro guardado, e ela CONTINUA na fila', async () => {
    const fila = [linha({ chave: 'A/E1', ordem: 1 })]
    const { repo } = repoFalso(fila)
    const { compels } = compelsFalso({ falharPara: ['A/E1'] })

    expect(await entregarEstoquePendente(compels, repo)).toEqual({ enviados: 0, falhas: 1 })
    expect(fila[0]!).toMatchObject({ ok: false, tentativas: 1, erro: 'ERP 500: fora do ar', reservada: false })

    // e volta na rodada seguinte, contando a segunda tentativa (até o teto de 5 da 0132)
    const segunda = compelsFalso()
    expect(await entregarEstoquePendente(segunda.compels, repo)).toEqual({ enviados: 1, falhas: 0 })
    expect(segunda.enviados).toEqual(['A/E1'])
    expect(fila[0]!).toMatchObject({ ok: true, tentativas: 2, erro: null })
  })

  it('exceção do último metro é falha de envio como qualquer outra (não derruba a rodada)', async () => {
    const fila = [linha({ chave: 'A/E1', ordem: 1 }), linha({ chave: 'A/E2', ordem: 2 })]
    const { repo } = repoFalso(fila)
    const { compels, enviados } = compelsFalso({ lancarPara: ['A/E1'] })
    const erros = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await entregarEstoquePendente(compels, repo)).toEqual({ enviados: 1, falhas: 1 })
    } finally {
      erros.mockRestore()
    }
    expect(enviados).toEqual(['A/E2'])
    expect(fila[0]!).toMatchObject({ ok: false, tentativas: 1 })
    expect(fila[0]!.erro).toContain('rede caiu')
    expect(fila[1]!).toMatchObject({ ok: true, tentativas: 1 })
  })

  it('idempotência da rodada: nenhuma linha é enviada duas vezes, nem quando o laço vira o lote', async () => {
    const fila = [
      linha({ chave: 'A/E1', ordem: 1 }),
      linha({ chave: 'A/E2', ordem: 2 }),
      linha({ chave: 'A/E3', ordem: 3 }),
    ]
    const { repo, reservas } = repoFalso(fila)
    const { compels, enviados } = compelsFalso()
    // limite 2: o primeiro lote vem CHEIO e o laço reserva o próximo — é a volta do lote que
    // poderia repetir uma linha, se a reserva não a tivesse escondido
    const resumo = await entregarEstoquePendente(compels, repo, { limite: 2 })
    expect(resumo).toEqual({ enviados: 3, falhas: 0 })
    expect(enviados).toEqual(['A/E1', 'A/E2', 'A/E3'])
    expect(new Set(enviados).size).toBe(enviados.length)
    expect(reservas.length).toBeGreaterThan(1)
  })

  it('idempotência da rodada: a linha que acabou de falhar não é reenviada na mesma rodada', async () => {
    // A falha solta a reserva (a linha volta pra fila), então sem a parada por "nada entregue" o
    // laço a pegaria de novo na volta do lote e gastaria as 5 tentativas numa rodada só.
    const fila = [linha({ chave: 'A/E1', ordem: 1 }), linha({ chave: 'A/E2', ordem: 2 })]
    const { repo } = repoFalso(fila)
    const { compels, enviados } = compelsFalso({ falharPara: ['A/E1'] })
    const resumo = await entregarEstoquePendente(compels, repo, { limite: 1 })
    expect(resumo).toEqual({ enviados: 0, falhas: 1 })
    expect(enviados).toEqual(['A/E1'])
    expect(fila[0]!.tentativas).toBe(1)
    expect(fila[1]!.tentativas).toBe(0)
  })

  it('o laço entrega o lote NA ORDEM em que o banco o deu (não reordena por operação nem por nada)', async () => {
    // O laço não tem regra de par nenhuma, e é isso que este teste trava: a ordem em que ele fala com
    // o ERP é a ordem em que a reserva devolveu. Quem decide que ordem é essa é a
    // `sf_estoque_reservar` (0132) — inclusive a de que um estorno não sai antes da entrada dele. Se
    // alguém reordenar o lote aqui (por `operacao`, pra "mandar as entradas primeiro", ou por
    // qualquer outro critério), essa decisão do banco vira mentira e este teste cai.
    const fila = [
      linha({ chave: 'A/S1', ordem: 1, operacao: 'estorno' }),
      linha({ chave: 'A/E1', ordem: 2 }),
      linha({ chave: 'A/E2', ordem: 3 }),
    ]
    const { repo } = repoFalso(fila)
    const { compels, enviados } = compelsFalso()
    expect(await entregarEstoquePendente(compels, repo)).toEqual({ enviados: 3, falhas: 0 })
    expect(enviados).toEqual(['A/S1', 'A/E1', 'A/E2'])
  })

  it('linha que o banco SEGUROU fica intocada: o laço não a envia nem cobra tentativa dela', async () => {
    // O outro lado da decisão de a ordem do par morar na reserva (0132): a linha segurada nem sai do
    // banco, então o laço não tem como enviá-la — e, principalmente, não tem como COBRAR TENTATIVA
    // dela. Se pagasse, cinco rodadas de espera a tirariam da fila (`tentativas < 5`) sem ela nunca ter
    // sido enviada: o desastre que o teto existe pra evitar, chegando pelo lado errado.
    //
    // `retida` é o teste dizendo "a reserva não devolveu esta linha nesta rodada" — quem decide isso de
    // verdade é o predicado do banco, provado nos testes SQL 17/18/19. Aqui o assunto é só o laço.
    const fila = [
      linha({ chave: 'A/E1', ordem: 1, tentativas: 1 }),
      linha({ chave: 'A/S1', ordem: 2, operacao: 'estorno', retida: true }),
    ]
    const { repo } = repoFalso(fila)

    const r1 = compelsFalso({ falharPara: ['A/E1'] })
    await entregarEstoquePendente(r1.compels, repo)
    expect(r1.enviados).toEqual(['A/E1'])
    // segurado = intocado: sem tentativa, sem erro, sem reserva
    expect(fila[1]!).toMatchObject({ tentativas: 0, erro: null, reservada: false, ok: false })

    // a entrada chega ao ERP nesta rodada; o estorno continua segurado (o banco ainda não o soltou)
    const r2 = compelsFalso()
    await entregarEstoquePendente(r2.compels, repo)
    expect(r2.enviados).toEqual(['A/E1'])
    expect(fila[0]!.ok).toBe(true)
    expect(fila[1]!.tentativas).toBe(0)

    // e quando o banco solta (a entrada virou `ok`, é o fim normal da espera), o laço entrega
    fila[1]!.retida = false
    const r3 = compelsFalso()
    await entregarEstoquePendente(r3.compels, repo)
    expect(r3.enviados).toEqual(['A/S1'])
    expect(fila[1]!).toMatchObject({ ok: true, tentativas: 1 })
  })
})

/**
 * Repositório de LOTES ROTEIRIZADOS: devolve, em ordem, os lotes que o teste escreveu — inclusive
 * quantas linhas o banco mandou e o repositório não entendeu. Serve pro que a fila de mentira não
 * consegue montar: o lote que veio CHEIO do banco mas com uma linha ilegível dentro.
 */
function repoRoteirizado(lotes: { envios: EnvioEstoqueReservado[]; ilegiveis: number }[]) {
  let i = 0
  const repo: RepositorioEstoqueEnvios = {
    async reservarPendentes() {
      return lotes[i++] ?? { envios: [], ilegiveis: 0 }
    },
    async concluirEnvio() {},
  }
  return repo
}

function envio(chave: string, tentativas = 1): EnvioEstoqueReservado {
  return {
    id: `id-${chave}`, chave, operacao: 'entrada', pmo: 'PMOT01', op: '9900',
    posto: 'Almoxarifado', tipo: 'caixa', bipe: 'CX[1][3]9900-PMOT01', serieNorm: '',
    quantidade: 3, tentativas, criadoEm: '2026-09-29T10:00:00Z',
  }
}

describe('a linha que o banco devolveu e o código não entendeu', () => {
  it('conta como FALHA no resumo, e conta pro lote estar CHEIO', async () => {
    // O repositório conclui a linha ilegível como falha e não a devolve — mas as duas consequências
    // disso são do laço, e as duas eram erradas em silêncio:
    //   • o resumo dizia `falhas: 0` embora uma linha tivesse falhado, e o resumo é o que o cron
    //     escreve no log — o único olho que alguém tem nesta fila;
    //   • "cheio" era medido no array já filtrado, então este lote (limite 2, DUAS linhas vindas do
    //     banco, uma ilegível) parecia incompleto e o laço parava antes da hora, deixando na fila o
    //     que caberia nesta rodada.
    const repo = repoRoteirizado([
      { envios: [envio('A/E1')], ilegiveis: 1 },
      { envios: [envio('A/E2')], ilegiveis: 0 },
    ])
    const { compels, enviados } = compelsFalso()
    const resumo = await entregarEstoquePendente(compels, repo, { limite: 2 })
    expect(resumo).toEqual({ enviados: 2, falhas: 1 })
    expect(enviados).toEqual(['A/E1', 'A/E2'])
  })
})

describe('o último metro não implementado, visto pelo laço', () => {
  it('a falha do "não configurado" é uma falha de envio como qualquer outra', async () => {
    // É o requisito central da Task 3: NENHUM caminho especial para "não configurado". A linha conta
    // tentativa, guarda o motivo em português e FICA na fila — é isso que faz a fila acumular e não
    // esvaziar enquanto o compels.ts não existir, e é esperado.
    const fila = [linha({ chave: 'A/E1', ordem: 1 })]
    const { repo } = repoFalso(fila)
    const resumo = await entregarEstoquePendente(enviarMovimentacaoCompels, repo)
    expect(resumo).toEqual({ enviados: 0, falhas: 1 })
    expect(fila[0]!).toMatchObject({ ok: false, tentativas: 1, reservada: false })
    expect(fila[0]!.erro).toContain('Integração com o Compels ainda não configurada')
  })

  it('o não-implementado diz a operação em português, e o texto vai inteiro para a tela', async () => {
    const entrada = await enviarMovimentacaoCompels({
      id: 'x', chave: 'ALMOX/PMOT01/9900/Almoxarifado/CX[1][3]9900-PMOT01/E1', operacao: 'entrada',
      pmo: 'PMOT01', op: '9900', posto: 'Almoxarifado', tipo: 'caixa',
      bipe: 'CX[1][3]9900-PMOT01', serieNorm: '', quantidade: 3, tentativas: 1,
      criadoEm: '2026-09-29T10:00:00Z',
    })
    expect(entrada.ok).toBe(false)
    if (!entrada.ok) expect(entrada.erro).toContain('A entrada continua na fila')
  })
})
