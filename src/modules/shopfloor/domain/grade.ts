import { partesSerie, normalizarSerie } from './serie'
import { pareaBurnin, estaAberto } from './burnin'

const MAX_SNS = 2000

export function gerarFaixaSNs(
  snIni: string,
  snFim: string,
): { ok: true; sns: string[] } | { ok: false; erro: string } {
  const a = partesSerie(snIni)
  const b = partesSerie(snFim)
  if (Number.isNaN(a.num) || Number.isNaN(b.num)) {
    return { ok: false, erro: 'Faixa de SN sem bloco numérico.' }
  }
  if (
    a.prefixo.toLowerCase() !== b.prefixo.toLowerCase() ||
    a.sufixo.toLowerCase() !== b.sufixo.toLowerCase()
  ) {
    return { ok: false, erro: 'Prefixo/sufixo diferentes entre o início e o fim da faixa.' }
  }
  const ini = Math.min(a.num, b.num)
  const fim = Math.max(a.num, b.num)
  const total = fim - ini + 1
  if (total > MAX_SNS) {
    return { ok: false, erro: `Faixa muito grande (${total} SNs; máximo ${MAX_SNS}).` }
  }
  const largura = Math.max(a.largura, b.largura)
  const sns: string[] = []
  for (let n = ini; n <= fim; n++) sns.push(a.prefixo + String(n).padStart(largura, '0') + a.sufixo)
  return { ok: true, sns }
}

/** Info da faixa (início/fim numéricos + formato) — base p/ contar e paginar sem gerar a lista toda. */
function faixaInfo(
  snIni: string,
  snFim: string,
): { ok: true; ini: number; fim: number; largura: number; prefixo: string; sufixo: string } | { ok: false; erro: string } {
  const a = partesSerie(snIni)
  const b = partesSerie(snFim)
  if (Number.isNaN(a.num) || Number.isNaN(b.num)) return { ok: false, erro: 'Faixa de SN sem bloco numérico.' }
  if (a.prefixo.toLowerCase() !== b.prefixo.toLowerCase() || a.sufixo.toLowerCase() !== b.sufixo.toLowerCase()) {
    return { ok: false, erro: 'Prefixo/sufixo diferentes entre o início e o fim da faixa.' }
  }
  return {
    ok: true,
    ini: Math.min(a.num, b.num),
    fim: Math.max(a.num, b.num),
    largura: Math.max(a.largura, b.largura),
    prefixo: a.prefixo,
    sufixo: a.sufixo,
  }
}

/** Total de SNs da faixa (sem gerar a lista) — usado pelo resumo e pela paginação; SEM limite. */
export function totalFaixaSNs(snIni: string, snFim: string): { ok: true; total: number } | { ok: false; erro: string } {
  const f = faixaInfo(snIni, snFim)
  if (!f.ok) return f
  return { ok: true, total: f.fim - f.ini + 1 }
}

/** Gera só os SNs de UMA página (offset/tamanho) + devolve o total. Não estoura em OP grande. */
export function gerarFaixaSNsPagina(
  snIni: string,
  snFim: string,
  offset: number,
  tamanho: number,
): { ok: true; sns: string[]; total: number } | { ok: false; erro: string } {
  const f = faixaInfo(snIni, snFim)
  if (!f.ok) return f
  const total = f.fim - f.ini + 1
  const de = f.ini + Math.max(0, offset)
  const ate = Math.min(f.fim, de + Math.max(1, tamanho) - 1)
  const sns: string[] = []
  for (let n = de; n <= ate; n++) sns.push(f.prefixo + String(n).padStart(f.largura, '0') + f.sufixo)
  return { ok: true, sns, total }
}

export interface RegistroGrade {
  snNorm: string
  posto: string
  status: string
  numeroCaixa: string
  dataHora: string
}

export interface LinhaGrade {
  sn: string
  celulas: Record<string, string>
}

/**
 * Ciclo de Burn-in aberto (peça ainda "dentro"). Pareia entrada↔saída por `dataHora`
 * (via `pareaBurnin`), robusto a saída Reprovado com N defeitos (N registros com o
 * mesmo instante) + re-entrada — casos que uma contagem simples confundiria.
 */
export function burninEmAndamento(registrosDoPosto: { dataHora: string; status: string }[]): boolean {
  return estaAberto(pareaBurnin(registrosDoPosto))
}

/**
 * Chave canônica de casamento de SN (como o legado): pelo BLOCO NUMÉRICO dentro
 * do prefixo/sufixo — assim 'AB9C' casa com a linha 'AB009C' independente do
 * zero-padding. Sem bloco numérico, cai no normalizado puro.
 */
function chaveSn(s: string): string {
  const p = partesSerie(s)
  if (Number.isNaN(p.num)) return normalizarSerie(s)
  return `${p.prefixo.toLowerCase()}|${p.num}|${p.sufixo.toLowerCase()}`
}

/** Monta a matriz SN × postos. Colunas = postos do fluxo da OP + 'Manutenção'. */
export function montarGrade(
  sns: string[],
  postosDaOp: string[],
  registros: RegistroGrade[],
  temStatus: (posto: string) => boolean,
): LinhaGrade[] {
  const porSn = new Map<string, RegistroGrade[]>()
  for (const r of registros) {
    const chave = chaveSn(r.snNorm)
    const arr = porSn.get(chave)
    if (arr) arr.push(r)
    else porSn.set(chave, [r])
  }
  const colunas = [...postosDaOp, 'Manutenção']
  return sns.map((sn) => {
    const regs = porSn.get(chaveSn(sn)) ?? []
    const celulas: Record<string, string> = {}
    for (const posto of colunas) {
      const doPosto = regs.filter((r) => r.posto.toLowerCase() === posto.toLowerCase())
      if (posto === 'Manutenção') {
        celulas[posto] = doPosto.length > 0 ? 'Concluído' : '—'
        continue
      }
      if (doPosto.length === 0) {
        celulas[posto] = 'Pendente'
        continue
      }
      if (posto.toLowerCase() === 'embalagem') {
        const caixa = doPosto.find((r) => r.numeroCaixa.trim() !== '')?.numeroCaixa ?? ''
        celulas[posto] = caixa !== '' ? caixa : 'Registrado'
        continue
      }
      if (posto.toLowerCase() === 'burn-in' && burninEmAndamento(doPosto)) {
        celulas[posto] = 'Em andamento'
        continue
      }
      if (temStatus(posto)) {
        if (doPosto.some((r) => r.status.toLowerCase() === 'aprovado')) celulas[posto] = 'Aprovado'
        else if (doPosto.some((r) => r.status.toLowerCase() === 'reprovado')) celulas[posto] = 'Reprovado'
        else celulas[posto] = 'Registrado'
        continue
      }
      celulas[posto] = 'Registrado'
    }
    return { sn, celulas }
  })
}

export interface ResumoPosto {
  posto: string
  produzido: number  // peças que passaram pelo posto (têm registro nele)
  pendentes: number  // total da OP − produzido
  aprovados: number  // peças com status Aprovado no posto
  reprovados: number // peças com status Reprovado no posto (sem aprovação depois)
}

/**
 * Resumo por posto (o cabeçalho do "Visão Geral da OP" do legado): contagens agregadas.
 * Funciona pra OP de QUALQUER tamanho — recebe o `total` da faixa (calculado sem gerar a lista).
 */
export function montarResumoPorPosto(
  total: number,
  postosDaOp: string[],
  registros: RegistroGrade[],
  temStatus: (posto: string) => boolean,
): ResumoPosto[] {
  const porSn = new Map<string, RegistroGrade[]>()
  for (const r of registros) {
    const chave = chaveSn(r.snNorm)
    const arr = porSn.get(chave)
    if (arr) arr.push(r)
    else porSn.set(chave, [r])
  }
  const colunas = [...postosDaOp, 'Manutenção']
  return colunas.map((posto) => {
    let produzido = 0
    let aprovados = 0
    let reprovados = 0
    for (const regs of porSn.values()) {
      const doPosto = regs.filter((r) => r.posto.toLowerCase() === posto.toLowerCase())
      if (doPosto.length === 0) continue
      produzido++
      if (posto !== 'Manutenção' && temStatus(posto)) {
        // Aprovado tem precedência (mesma regra da célula da grade).
        if (doPosto.some((r) => r.status.toLowerCase() === 'aprovado')) aprovados++
        else if (doPosto.some((r) => r.status.toLowerCase() === 'reprovado')) reprovados++
      }
    }
    return { posto, produzido, pendentes: Math.max(0, total - produzido), aprovados, reprovados }
  })
}
