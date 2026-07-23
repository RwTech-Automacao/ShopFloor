import { partesSerie, normalizarSerie } from './serie'
import { postoTemStatus } from './lancamento-linhas'

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

export interface RegistroGrade {
  snNorm: string
  posto: string
  status: string
  numeroCaixa: string
}

export interface LinhaGrade {
  sn: string
  celulas: Record<string, string>
}

/** Monta a matriz SN × postos. Colunas = postos do fluxo da OP + 'Manutenção'. */
export function montarGrade(
  sns: string[],
  postosDaOp: string[],
  registros: RegistroGrade[],
): LinhaGrade[] {
  const porSn = new Map<string, RegistroGrade[]>()
  for (const r of registros) {
    const arr = porSn.get(r.snNorm)
    if (arr) arr.push(r)
    else porSn.set(r.snNorm, [r])
  }
  const colunas = [...postosDaOp, 'Manutenção']
  return sns.map((sn) => {
    const regs = porSn.get(normalizarSerie(sn)) ?? []
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
      if (postoTemStatus(posto)) {
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
