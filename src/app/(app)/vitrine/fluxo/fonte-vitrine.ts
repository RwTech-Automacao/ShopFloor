import type { FonteFluxo } from '@/app/(app)/shopfloor/fluxo/fonte-fluxo'
import { postoPendenteDePeca, MANUTENCAO, type BipePeca } from '@/modules/shopfloor/domain/fluxo-op'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'
import {
  PMO_DEMO, OP_DEMO, QTD_DEMO, NOMES_POSTOS, T_INICIO_LACO, T_FIM_LACO,
  bipesAte, fluxoDemo, burninDemo, pendentesPorPeca, resumir,
  recursoDoPostoDemo, temStatusDoPostoDemo, exigeManutencaoDemo, type BipeDemo,
} from '@/modules/vitrine/domain/op-demo'

/** Minutos simulados que andam a cada segundo real (1,2 min a cada 3 s → o laço inteiro em ~2,7 min). */
export const MINUTOS_SIMULADOS_POR_SEGUNDO = 0.4
/** A cada quanto a tela da vitrine relê o fluxo (as peças andam nesse passo). */
export const INTERVALO_VITRINE_MS = 3000

const PAGINA_HISTORICO = 100
const FUSO = 'America/Sao_Paulo'

/** O relógio da vitrine: minuto simulado `t` (laço) + conversão minuto ↔ data real ancorada em "agora". */
export interface RelogioVitrine {
  agoraMs: () => number
  minuto: () => number
}

export function relogioDoLaco(inicioMs: number, agoraMs: () => number = Date.now): RelogioVitrine {
  const laco = T_FIM_LACO - T_INICIO_LACO
  return {
    agoraMs,
    minuto: () => {
      const andou = ((agoraMs() - inicioMs) / 1000) * MINUTOS_SIMULADOS_POR_SEGUNDO
      return T_INICIO_LACO + (((andou % laco) + laco) % laco)
    },
  }
}

const ehDaOp = (pmo: string, op: string) => pmo.trim() === PMO_DEMO && op.trim() === OP_DEMO

/**
 * A fonte de dados da VITRINE: implementa o `FonteFluxo` inteiro em memória, a partir do modelo
 * `op-demo`. Nenhuma função aqui chama Server Action, banco ou Compels. As datas são ancoradas no
 * relógio da tela (o bipe mais novo é "agora"), então "Hoje", tempo de Burn-in e cadência fazem sentido
 * em qualquer dia em que a vitrine for aberta.
 */
export function criarFonteVitrine(relogio: RelogioVitrine): FonteFluxo {
  // Uma "foto" por chamada: o mesmo t e o mesmo agora para todas as contas dela.
  const foto = () => {
    const t = relogio.minuto()
    const agora = relogio.agoraMs()
    const iso = (m: number) => new Date(agora - (t - m) * 60000).toISOString()
    const minutoDe = (dataIso: string) => t - (agora - Date.parse(dataIso)) / 60000
    return { t, iso, minutoDe }
  }
  const naJanela = (b: BipeDemo, ini: number | null, fim: number | null) =>
    (ini == null || b.minuto >= ini) && (fim == null || b.minuto < fim)
  const doPosto = (bipes: BipeDemo[], posto: string) => bipes.filter((b) => b.posto.toLowerCase() === posto.toLowerCase())
  const semOp = { ok: false as const, erro: 'OP não encontrada.' }

  return {
    async carregarFluxo(pmo, op) {
      if (!ehDaOp(pmo, op)) return semOp
      const { t, iso } = foto()
      const { nodes, edges } = fluxoDemo(t, iso)
      return { ok: true, nodes, edges, qtd: QTD_DEMO }
    },

    async fluxoPeriodo(pmo, op, faixas) {
      if (!ehDaOp(pmo, op)) return semOp
      const { t, minutoDe } = foto()
      const bipes = bipesAte(t)
      const postos: Record<string, { registros: number; aprovadas: number; reprovadas: number }> = {}
      for (const f of faixas) {
        const ini = minutoDe(f.ini)
        const fim = minutoDe(f.fim)
        for (const b of bipes) {
          if (!naJanela(b, ini, fim)) continue
          const a = postos[b.posto] ?? { registros: 0, aprovadas: 0, reprovadas: 0 }
          a.registros++
          if (b.status === 'Aprovado') a.aprovadas++
          postos[b.posto] = a
        }
      }
      return { ok: true, postos }
    },

    async rotaSn(pmo, op, sn) {
      if (!ehDaOp(pmo, op)) return semOp
      const alvo = normalizarSerie(sn)
      const regs = bipesAte(foto().t).filter((b) => normalizarSerie(b.sn) === alvo)
      if (regs.length === 0) return { ok: true, postos: [], atual: null }
      const postos = [...new Set(regs.map((b) => b.posto))]
      const bipes: BipePeca[] = regs.map((b) => ({ posto: b.posto, status: b.status }))
      return { ok: true, postos, atual: postoPendenteDePeca(bipes, NOMES_POSTOS, exigeManutencaoDemo, recursoDoPostoDemo) }
    },

    async detalhePosto(pmo, op, posto) {
      if (!ehDaOp(pmo, op)) return semOp
      const pend = pendentesPorPeca(foto().t)
      const agora = [...pend.entries()]
        .filter(([, p]) => p != null && p.toLowerCase() === posto.toLowerCase())
        .map(([sn]) => ({ sn, status: '', vezes: 1 }))
        .sort((a, b) => a.sn.localeCompare(b.sn))
      return { ok: true, agora, historico: [] }
    },

    async historicoPosto(pmo, op, posto, offset = 0) {
      if (!ehDaOp(pmo, op)) return semOp
      const { t, iso } = foto()
      const linhas = doPosto(bipesAte(t), posto)
        .reverse()
        .slice(Math.max(0, offset), Math.max(0, offset) + PAGINA_HISTORICO)
        .map((b) => ({ sn: b.sn, status: b.status, dataHora: iso(b.minuto) }))
      return { ok: true, linhas, temMais: linhas.length === PAGINA_HISTORICO }
    },

    async producaoPeriodo(pmo, op, posto, ini, fim, bucket) {
      if (!ehDaOp(pmo, op)) return semOp
      const { t, iso, minutoDe } = foto()
      const formato = new Intl.DateTimeFormat('pt-BR', {
        timeZone: FUSO, day: '2-digit', month: '2-digit', ...(bucket === 'hora' ? { hour: '2-digit', hourCycle: 'h23' as const } : {}),
      })
      const rotulo = (dataIso: string) => {
        const p = Object.fromEntries(formato.formatToParts(new Date(dataIso)).map((x) => [x.type, x.value]))
        return bucket === 'hora' ? `${p.day}/${p.month} ${p.hour}h` : `${p.day}/${p.month}`
      }
      const a = ini ? minutoDe(ini) : null
      const b = fim ? minutoDe(fim) : null
      const contagem = new Map<string, number>()
      for (const x of doPosto(bipesAte(t), posto)) {
        if (!naJanela(x, a, b)) continue
        const r = rotulo(iso(x.minuto))
        contagem.set(r, (contagem.get(r) ?? 0) + 1)
      }
      return { ok: true, linhas: [...contagem].map(([rotulo, qtd]) => ({ rotulo, qtd })) }
    },

    async burninDetalhe(pmo, op, posto) {
      if (!ehDaOp(pmo, op)) return semOp
      const { t, iso } = foto()
      return { ok: true, detalhe: burninDemo(t, posto, iso) }
    },

    async embalagemCaixas(pmo, op, posto) {
      if (!ehDaOp(pmo, op)) return semOp
      const itens = doPosto(bipesAte(foto().t), posto).reverse().map((b) => ({ sn: b.sn, caixa: b.caixa || '—' }))
      return { ok: true, itens }
    },

    async snsManutencao(pmo, op) {
      if (!ehDaOp(pmo, op)) return semOp
      return { ok: true, sns: [] } // produção perfeita: ninguém em Manutenção
    },

    async opsComBipes(ini, fim) {
      const { t, minutoDe } = foto()
      const a = ini ? minutoDe(ini) : null
      const b = fim ? minutoDe(fim) : null
      const bipes = bipesAte(t).filter((x) => naJanela(x, a, b)).length
      const pct = (resumir(t, () => '').finalizadas / QTD_DEMO) * 100
      return { [`${PMO_DEMO}||${OP_DEMO}`]: { bipes, pct } }
    },

    async buscarHistoricoSN(sn) {
      const alvo = normalizarSerie(sn)
      const { t, iso } = foto()
      const registros = bipesAte(t)
        .filter((b) => normalizarSerie(b.sn) === alvo)
        .map((b) => ({
          dataHora: iso(b.minuto), colaborador: b.colaborador, posto: b.posto, pmo: PMO_DEMO, op: OP_DEMO,
          status: b.status, numeroCaixa: b.caixa, numeroSerie: b.sn, cod: '', pos: '', tipo: '',
          nqaVisual: b.posto === 'NQA' ? 'Aprovado' : '', nqaFuncional: b.posto === 'NQA' ? 'Aprovado' : '',
          idIntegracao: '', reparoConserto: '', reparoPosicao: '',
        }))
      return { ok: true, registros }
    },

    async carregarDefeitosDaOp() {
      return { ok: true, linhas: [], temMais: false }
    },

    async carregarResumoDefeitos() {
      return { ok: true, resumo: [] }
    },

    async carregarDashboard(pmo, op, de, ate) {
      if (!ehDaOp(pmo, op)) return semOp
      const { t, minutoDe } = foto()
      const dia = (d: string | undefined, fimDoDia: boolean) =>
        d ? minutoDe(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T${fimDoDia ? '23:59:59' : '00:00:00'}-03:00` : d) : null
      const a = dia(de, false)
      const b = dia(ate, true)
      const sns = new Map<string, Set<string>>()
      for (const x of bipesAte(t)) {
        if (!naJanela(x, a, b)) continue
        if (temStatusDoPostoDemo(x.posto) && x.status !== 'Aprovado') continue // a entrada do Burn-in não conta
        const s = sns.get(x.posto) ?? new Set<string>()
        s.add(x.sn)
        sns.set(x.posto, s)
      }
      const itens = [...NOMES_POSTOS, MANUTENCAO].map((posto) => ({ posto, contagem: sns.get(posto)?.size ?? 0 }))
      return { ok: true, itens, total: QTD_DEMO }
    },

    async lerEstoqueCompels() {
      const finalizadas = resumir(foto().t, () => '').finalizadas
      return {
        tipo: 'ok',
        disponivel: finalizadas,
        porEstoque: [{ estoque: 'PA', saldo: finalizadas }, { estoque: 'EINTER', saldo: 0 }],
        consultadoEm: new Date(relogio.agoraMs()).toISOString(),
      }
    },

    async lerPendenteCompels() {
      return null // nada esperando o Compels: tudo que entrou no Almoxarifado já está no estoque
    },
  }
}
