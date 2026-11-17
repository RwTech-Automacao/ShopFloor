import { lerAba, montarOs, type AbaPlanilha, type LinhaPlanilha, type OsPlanilha } from '../domain/planilha'

/**
 * Uma rodada da cópia da planilha "Peças em garantia" para o banco (spec 2026-11-17-sat-entrada-design.md,
 * decisão 3): baixa as abas NA ORDEM DE PRIORIDADE, junta as linhas em OS e grava em lotes. Acrescenta e
 * atualiza; nunca apaga. Uma aba que falha não impede as outras (o que ela tinha continua no banco); se todas
 * falham, a rodada falha (o cron vê).
 */
export interface ContagemGravacao {
  os_novas: number
  os_atualizadas: number
  itens_novos: number
  itens_atualizados: number
}

export interface PortasSincronizacao {
  baixarAba(aba: AbaPlanilha): Promise<string>
  gravar(lote: OsPlanilha[]): Promise<ContagemGravacao>
}

export interface ResumoSincronizacao {
  abas: { nome: string; linhas: number; erro: string | null }[]
  os: number
  itens: number
  gravado: ContagemGravacao
}

const LOTE_PADRAO = 200

export async function sincronizarPlanilha(
  abas: AbaPlanilha[], portas: PortasSincronizacao, tamanhoLote = LOTE_PADRAO,
): Promise<ResumoSincronizacao> {
  const linhas: LinhaPlanilha[] = []
  const resumoAbas: ResumoSincronizacao['abas'] = []
  for (const aba of abas) {
    try {
      const daAba = lerAba(await portas.baixarAba(aba), aba)
      linhas.push(...daAba)
      resumoAbas.push({ nome: aba.nome, linhas: daAba.length, erro: null })
    } catch (e) {
      resumoAbas.push({ nome: aba.nome, linhas: 0, erro: e instanceof Error ? e.message : String(e) })
    }
  }
  if (resumoAbas.every((a) => a.erro !== null)) {
    throw new Error(`nenhuma aba lida: ${resumoAbas.map((a) => `${a.nome}: ${a.erro}`).join(' | ')}`)
  }

  const os = montarOs(linhas)
  const gravado: ContagemGravacao = { os_novas: 0, os_atualizadas: 0, itens_novos: 0, itens_atualizados: 0 }
  for (let i = 0; i < os.length; i += tamanhoLote) {
    const c = await portas.gravar(os.slice(i, i + tamanhoLote))
    gravado.os_novas += c.os_novas
    gravado.os_atualizadas += c.os_atualizadas
    gravado.itens_novos += c.itens_novos
    gravado.itens_atualizados += c.itens_atualizados
  }
  return { abas: resumoAbas, os: os.length, itens: os.reduce((n, o) => n + o.itens.length, 0), gravado }
}
