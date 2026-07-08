export type FaixaNqa = { quantidadeMin: number; quantidadeMax: number | null; tamanhoAmostra: number | null }
export type CampoCalc = { campo: string; formula: string | null; formulaConfig: Record<string, string> }
export type ContextoCalculo = {
  criticidade: { fornecedor: string; critico: string }[]
  nqa: FaixaNqa[]
  usuarioAtual: string
  valoresAtuais: Record<string, unknown>
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function diferencaDias(chegadaISO: string | null, previstaISO: string | null): number | null {
  if (!chegadaISO || !previstaISO) return null
  const a = Date.parse(chegadaISO + 'T00:00:00Z')
  const b = Date.parse(previstaISO + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((a - b) / 86400000)
}

export function diferencaNumerica(a: unknown, b: unknown): number | null {
  const na = numero(a), nb = numero(b)
  if (na === null || nb === null) return null
  return na - nb
}

export function buscarCriticidade(
  fornecedor: string | null,
  tabela: { fornecedor: string; critico: string }[],
): string | null {
  if (!fornecedor) return null
  const alvo = fornecedor.trim().toLowerCase()
  const achou = tabela.find((r) => r.fornecedor.trim().toLowerCase() === alvo)
  return achou ? achou.critico : null
}

export function buscarNqa(quantidade: unknown, tabela: FaixaNqa[]): number | null {
  const q = numero(quantidade)
  if (q === null) return null
  const faixa = tabela.find((f) => q >= f.quantidadeMin && (f.quantidadeMax === null || q <= f.quantidadeMax))
  return faixa && faixa.tamanhoAmostra !== null ? faixa.tamanhoAmostra : null
}

function valorConfig(cfg: Record<string, string>, chave: string): string {
  return cfg[chave] ?? ''
}

export function calcularCamposCalculados(
  valores: Record<string, unknown>,
  campos: CampoCalc[],
  ctx: ContextoCalculo,
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {}
  for (const campo of campos) {
    const cfg = campo.formulaConfig
    switch (campo.formula) {
      case 'diferenca_dias':
        out[campo.campo] = diferencaDias(
          (valores[valorConfig(cfg, 'a')] as string) ?? null,
          (valores[valorConfig(cfg, 'b')] as string) ?? null,
        )
        break
      case 'diferenca_numerica':
        out[campo.campo] = diferencaNumerica(valores[valorConfig(cfg, 'a')], valores[valorConfig(cfg, 'b')])
        break
      case 'lookup_fornecedor_critico':
        out[campo.campo] = buscarCriticidade(
          (valores[valorConfig(cfg, 'campo')] as string) ?? null,
          ctx.criticidade,
        )
        break
      case 'tabela_nqa':
        out[campo.campo] = buscarNqa(valores[valorConfig(cfg, 'campo')], ctx.nqa)
        break
      case 'usuario_primeiro': {
        const atual = ctx.valoresAtuais[campo.campo]
        out[campo.campo] =
          atual === null || atual === undefined || String(atual).trim() === ''
            ? ctx.usuarioAtual
            : (atual as string)
        break
      }
      default:
        break
    }
  }
  return out
}
