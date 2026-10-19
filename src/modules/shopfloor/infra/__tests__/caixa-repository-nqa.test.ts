import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Supabase de mentira que RESPEITA os filtros (`eq`/`in`/`like`), a ordenação e o `limit` — o fake
 * do outro teste (caixa-repository-consulta) ignora tudo isso, e é exatamente o filtro que está
 * sendo provado aqui: desde que o bipe de caixa no Almoxarifado passou a gravar uma linha por peça
 * (0129), a linha MAIS RECENTE com `numero_caixa` preenchido de uma peça é a do Almoxarifado, e a
 * busca da caixa precisa ignorá-la pelo PERFIL do posto.
 */
type Linha = Record<string, unknown>
const tabelas: Record<string, Linha[]> = { sf_postos: [], sf_registros: [], sf_caixas: [] }

function consulta(tabela: string) {
  const eqs: [string, unknown][] = []
  const ins: [string, unknown[]][] = []
  const ordens: { col: string; asc: boolean }[] = []
  let likeCol = ''
  let likePrefixo = ''
  let limite = Number.POSITIVE_INFINITY
  let de = 0
  let ate = Number.POSITIVE_INFINITY

  function resolver(): Linha[] {
    let fonte = (tabelas[tabela] ?? []).filter((r) => {
      if (!eqs.every(([c, v]) => r[c] === v)) return false
      if (!ins.every(([c, vs]) => vs.includes(r[c] as never))) return false
      if (likeCol !== '' && !String(r[likeCol] ?? '').startsWith(likePrefixo)) return false
      return true
    })
    for (const o of [...ordens].reverse()) {
      fonte = [...fonte].sort((a, b) => {
        const x = a[o.col] as string | number
        const y = b[o.col] as string | number
        const cmp = x === y ? 0 : x < y ? -1 : 1
        return o.asc ? cmp : -cmp
      })
    }
    if (ate !== Number.POSITIVE_INFINITY) fonte = fonte.slice(de, ate + 1)
    if (limite !== Number.POSITIVE_INFINITY) fonte = fonte.slice(0, limite)
    return fonte
  }

  const q = {
    select: () => q,
    eq(c: string, v: unknown) { eqs.push([c, v]); return q },
    in(c: string, v: unknown[]) { ins.push([c, v]); return q },
    like(c: string, p: string) { likeCol = c; likePrefixo = p.replace(/%$/, ''); return q },
    order(c: string, o?: { ascending?: boolean }) { ordens.push({ col: c, asc: o?.ascending !== false }); return q },
    limit(n: number) { limite = n; return q },
    range(a: number, b: number) { de = a; ate = b; return q },
    maybeSingle() {
      return { then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
        Promise.resolve({ data: resolver()[0] ?? null, error: null }).then(ok, erro) }
    },
    then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
      return Promise.resolve({ data: resolver(), error: null }).then(ok, erro)
    },
  }
  return q
}

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ from: consulta }),
}))

const { resolverCaixaPorSn } = await import('../caixa-repository')

const PERFIL_EMBALAGEM = { chave: 'embalagem', nome: 'Embalagem', tem_status: false, reprova: 'nenhum', gate: 'registrado', exige_manutencao: false, recurso: 'caixa' }
const PERFIL_ALMOX = { chave: 'almoxarifado', nome: 'Almoxarifado', tem_status: false, reprova: 'nenhum', gate: 'registrado', exige_manutencao: false, recurso: 'almoxarifado' }
const PERFIL_NQA = { chave: 'nqa', nome: 'NQA', tem_status: true, reprova: 'escolhido', gate: 'registrado', exige_manutencao: false, recurso: 'nqa' }

function registro(posto: string, sn: string, caixa: string, hora: string): Linha {
  return { id: hora, posto, pmo: 'PMOC14', op: '8498', numero_serie: `SN-${sn}`, numero_serie_norm: sn, numero_caixa: caixa, status: '', posto_retorno: null, data_hora: hora }
}

describe('resolverCaixaPorSn — a caixa da peça sai do posto de EMBALAGEM', () => {
  beforeEach(() => {
    tabelas.sf_postos = [
      // 'Estoque' é um posto de almoxarifado cuja CHAVE ordena DEPOIS de 'Embalagem' — se a busca
      // voltasse a depender de ordem/nome, este é o cadastro que quebraria.
      { chave: 'Embalagem', perfil: 'embalagem', sf_posto_perfis: PERFIL_EMBALAGEM },
      { chave: 'Estoque', perfil: 'almoxarifado', sf_posto_perfis: PERFIL_ALMOX },
      { chave: 'Inspeção NQA', perfil: 'nqa', sf_posto_perfis: PERFIL_NQA },
    ]
    tabelas.sf_caixas = []
    tabelas.sf_registros = []
  })

  it('a entrada no Almoxarifado é a linha mais recente e NÃO rouba a caixa da peça', async () => {
    const codigo = 'CX[7][2]8498-PMOC14'
    tabelas.sf_caixas = [{ pmo: 'PMOC14', op: '8498', posto: 'Embalagem', codigo, fechada: true, revisao: 0 }]
    tabelas.sf_registros = [
      registro('Embalagem', '8001', codigo, '2026-09-29T10:00:00Z'),
      registro('Embalagem', '8002', codigo, '2026-09-29T10:01:00Z'),
      // Depois de fechar a caixa, o operador bipou a caixa no Almoxarifado: uma linha por peça, com
      // a série E o código da caixa. É a mais recente das duas.
      registro('Estoque', '8001', codigo, '2026-09-29T11:00:00Z'),
      registro('Estoque', '8002', codigo, '2026-09-29T11:00:01Z'),
    ]

    const caixa = await resolverCaixaPorSn('PMOC14', '8498', '8001', 'Inspeção NQA')

    expect(caixa).not.toBeNull()
    expect(caixa!.posto).toBe('Embalagem')
    expect(caixa!.numeroCaixa).toBe(codigo)
    // O que o NQA lê pra decidir: caixa fechada (era o `false` falso do defeito — a mensagem
    // "feche a caixa na Embalagem" numa caixa fechada e já embarcada) e as 2 peças da caixa.
    expect(caixa!.fechada).toBe(true)
    expect(caixa!.qtd).toBe(2)
    expect(caixa!.snsNorm.sort()).toEqual(['8001', '8002'])
    expect(caixa!.jaInspecionadaNqa).toBe(false)
  })

  it('caixa ABERTA continua sendo encontrada (marcador CX[seq], sem código em sf_caixas)', async () => {
    // Prova que o filtro é por PERFIL e não por "existir em sf_caixas": a caixa aberta não tem
    // `codigo` gravado, e é dela que sai o aviso legítimo "feche a caixa antes do NQA".
    tabelas.sf_caixas = [{ pmo: 'PMOC14', op: '8498', posto: 'Embalagem', codigo: '', fechada: false, revisao: 0 }]
    tabelas.sf_registros = [registro('Embalagem', '8001', 'CX[7]', '2026-09-29T10:00:00Z')]

    const caixa = await resolverCaixaPorSn('PMOC14', '8498', '8001', 'Inspeção NQA')

    expect(caixa).not.toBeNull()
    expect(caixa!.posto).toBe('Embalagem')
    expect(caixa!.numeroCaixa).toBe('CX[7]')
    expect(caixa!.fechada).toBe(false)
  })

  it('sem nenhum posto de perfil caixa, a peça não está em caixa nenhuma', async () => {
    tabelas.sf_postos = [{ chave: 'Estoque', perfil: 'almoxarifado', sf_posto_perfis: PERFIL_ALMOX }]
    tabelas.sf_registros = [registro('Estoque', '8001', 'CX[7][2]8498-PMOC14', '2026-09-29T11:00:00Z')]

    expect(await resolverCaixaPorSn('PMOC14', '8498', '8001', 'Inspeção NQA')).toBeNull()
  })
})
