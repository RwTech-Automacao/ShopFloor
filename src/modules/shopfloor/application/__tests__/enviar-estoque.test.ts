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
    ...p,
  }
}

/**
 * Repositório de mentira com uma FILA DE VERDADE: `reservarPendentes` implementa o MESMO contrato da
 * `sf_estoque_reservar` (0132) — pendentes (não ok, não canceladas, tentativas < 5, sem reserva
 * viva), novas antes dos reenvios, mais antigas primeiro, tentativa contada na reserva — INCLUSIVE a
 * ordem do par: estorno não é elegível enquanto a entrada dele (mesmo alvo, criada antes) não estiver
 * `ok`.
 *
 * Quem IMPÕE a ordem do par é o banco, e é lá que ela está provada (testes 17 e 18 de
 * `supabase/tests/estoque_envios_test.sql`, que rodam contra um Postgres de verdade). O que se prova
 * AQUI é o outro lado da mesma decisão: que o laço não desfaz essa regra — não reordena, não entrega
 * o estorno segurado e não cobra tentativa dele —, porque uma tentativa cobrada de uma linha que
 * ninguém tentou a tira da fila em cinco rodadas sem ela nunca ter sido enviada.
 */
function repoFalso(fila: LinhaFila[]) {
  const reservas: number[] = []
  const repo: RepositorioEstoqueEnvios = {
    async reservarPendentes(limite: number) {
      reservas.push(limite)
      const alvo = (l: LinhaFila) => (l.serieNorm !== '' ? l.serieNorm : l.bipe)
      const elegiveis = fila
        .filter((l) => !l.ok && !l.cancelada && l.tentativas < 5 && !l.reservada)
        .filter(
          (l) =>
            l.operacao !== 'estorno'
            || !fila.some(
              (e) => e.operacao === 'entrada' && alvo(e) === alvo(l) && e.ordem < l.ordem && !e.ok,
            ),
        )
        .sort((a, b) => Number(a.tentativas > 0) - Number(b.tentativas > 0) || a.ordem - b.ordem)
        .slice(0, limite)
      for (const l of elegiveis) {
        l.tentativas += 1
        l.reservada = true
      }
      return elegiveis.map<EnvioEstoqueReservado>((l) => ({
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

  it('a ordem do par: estorno não é entregue antes da entrada, e não paga tentativa esperando', async () => {
    // A entrada EM VOO (uma rodada já tentou, a reserva venceu) e o estorno que a reverte — o par
    // que a sf_estoque_reverter cria de verdade ("A EXCEÇÃO À DECISÃO", 0132). O estorno é mais novo
    // e nasce com tentativas = 0, então sem a regra ele sairia PRIMEIRO.
    const fila = [
      linha({ chave: 'A/E1', ordem: 1, tentativas: 1 }),
      linha({ chave: 'A/S1', ordem: 2, operacao: 'estorno' }),
    ]
    const { repo } = repoFalso(fila)

    const r1 = compelsFalso({ falharPara: ['A/E1'] })
    await entregarEstoquePendente(r1.compels, repo)
    expect(r1.enviados).toEqual(['A/E1'])
    // segurado = intocado: sem tentativa, sem erro, sem reserva
    expect(fila[1]!).toMatchObject({ tentativas: 0, erro: null, reservada: false, ok: false })

    // a entrada chega ao ERP nesta rodada; o estorno continua segurado nela (a reserva foi antes)
    const r2 = compelsFalso()
    await entregarEstoquePendente(r2.compels, repo)
    expect(r2.enviados).toEqual(['A/E1'])
    expect(fila[0]!.ok).toBe(true)
    expect(fila[1]!.tentativas).toBe(0)

    // e na rodada SEGUINTE o estorno é liberado — é o fim normal da espera
    const r3 = compelsFalso()
    await entregarEstoquePendente(r3.compels, repo)
    expect(r3.enviados).toEqual(['A/S1'])
    expect(fila[1]!).toMatchObject({ ok: true, tentativas: 1 })
  })

  it('entrada no teto de tentativas segura o estorno, e é uma pessoa que destrava', async () => {
    // A outra forma de a espera terminar (0132): a entrada saiu da fila com 5 tentativas, então ela
    // não vira `ok` sozinha. O laço NÃO pode "resolver" isso entregando a saída sozinha — o Compels
    // ficaria com uma saída de peça que nunca recebeu.
    const fila = [
      linha({ chave: 'A/E1', ordem: 1, tentativas: 5, erro: 'ERP 500: fora do ar' }),
      linha({ chave: 'A/S1', ordem: 2, operacao: 'estorno' }),
    ]
    const { repo } = repoFalso(fila)
    const { compels, enviados } = compelsFalso()
    expect(await entregarEstoquePendente(compels, repo)).toEqual({ enviados: 0, falhas: 0 })
    expect(enviados).toEqual([])
    expect(fila[1]!.tentativas).toBe(0)
  })
})

describe('o último metro não implementado, visto pelo laço', () => {
  it('a falha do "não configurado" é uma falha de envio como qualquer outra', async () => {
    // É o requisito central da Task 3: NENHUM caminho especial para "não configurado". A linha conta
    // tentativa, guarda o motivo em português e FICA na fila — é isso que faz a fila acumular e não
    // esvaziar enquanto o compels.ts não existir, e é esperado.
    const fila = [linha({ chave: 'A/E1', ordem: 1 }), linha({ chave: 'A/S1', ordem: 2, operacao: 'estorno' })]
    const { repo } = repoFalso(fila)
    const resumo = await entregarEstoquePendente(enviarMovimentacaoCompels, repo)
    expect(resumo).toEqual({ enviados: 0, falhas: 1 })
    expect(fila[0]!).toMatchObject({ ok: false, tentativas: 1, reservada: false })
    expect(fila[0]!.erro).toContain('Integração com o Compels ainda não configurada')
    // o estorno segue segurado pela entrada que não saiu (a ordem do par não conhece o "motivo")
    expect(fila[1]!.tentativas).toBe(0)
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
