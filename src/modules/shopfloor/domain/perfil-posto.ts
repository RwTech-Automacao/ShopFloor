import type { LinhaDefeito, DadosLinhas } from './lancamento-linhas'
import { type DadosLancamento, type ResultadoRegra } from './regras-lancamento'

export type ReprovaColeta = 'defeitos' | 'posicoes' | 'nenhum'
export type GateSeq = 'aprovado' | 'registrado'
export type RecursoPosto = 'nenhum' | 'caixa' | 'nqa' | 'integracao' | 'burnin' | 'manutencao'

export interface PerfilPosto {
  chave: string
  nome: string
  temStatus: boolean
  reprova: ReprovaColeta
  gate: GateSeq
  exigeManutencao: boolean
  recurso: RecursoPosto
}

export const PERFIL_PADRAO: PerfilPosto = {
  chave: 'passagem', nome: 'Passagem', temStatus: false, reprova: 'nenhum', gate: 'registrado', exigeManutencao: false, recurso: 'nenhum',
}

export const perfilTemStatus = (p: PerfilPosto): boolean => p.temStatus
export const perfilPrecisaAprovado = (p: PerfilPosto): boolean => p.gate === 'aprovado'
export const perfilExigeManutencao = (p: PerfilPosto): boolean => p.exigeManutencao

/**
 * Recursos "de sistema" cujo comportamento é amarrado ao NOME do posto no código
 * (RPCs/telas próprias): Burn-in, Integração, Manutenção. Atribuir esses perfis a um
 * posto NOVO não funciona (o RPC/tela grava/usa o nome fixo) — então NÃO são oferecidos
 * no cadastro de posto.
 */
const RECURSOS_NAO_ATRIBUIVEIS: RecursoPosto[] = ['burnin', 'integracao', 'manutencao']

/** O perfil pode ser atribuído a um posto novo pela tela de Cadastrar Posto? */
export function perfilAtribuivel(p: PerfilPosto): boolean {
  return !RECURSOS_NAO_ATRIBUIVEIS.includes(p.recurso)
}

/** Expande a reprova em linhas conforme o perfil. Não reprovado → []. */
export function montarLinhasPerfil(p: PerfilPosto, dados: DadosLinhas): LinhaDefeito[] {
  const reprovado = (dados.status ?? '').toLowerCase() === 'reprovado'
  if (!reprovado) return []
  if (p.reprova === 'posicoes') {
    return (dados.posicoes ?? []).filter((x) => x.trim() !== '').map((posicao) => ({ codigo_defeito: '', posicao, tipo_defeito: '' }))
  }
  return (dados.defeitos ?? [])
    .filter((d) => d.codigo.trim() !== '' || d.posicao.trim() !== '')
    .map((d) => ({ codigo_defeito: d.codigo, posicao: d.posicao, tipo_defeito: d.tipo }))
}

const vazio = (v: string | undefined) => !v || String(v).trim() === ''

/** Obrigatórios por perfil (porta obrigatoriosPorPosto decidindo por recurso/temStatus/reprova). */
export function obrigatoriosPorPerfil(p: PerfilPosto, d: DadosLancamento): ResultadoRegra {
  const base = !vazio(d.colaborador) && !vazio(d.pmo) && !vazio(d.op) && !vazio(d.numeroSerie)
  if (!base) return { ok: false, erro: 'Preencha Colaborador, PMO, OP e Nº de Série.' }

  if (p.recurso === 'caixa') {
    return !vazio(d.numeroCaixa) && !vazio(d.limiteCaixa)
      ? { ok: true }
      : { ok: false, erro: 'Para Embalagem, preencha Colaborador, PMO, OP, Nº da Caixa, QTD por caixa e Nº de Série.' }
  }
  if (p.recurso === 'nqa') {
    return !vazio(d.nqaVisual) && !vazio(d.nqaFuncional)
      ? { ok: true }
      : { ok: false, erro: 'Para Inspeção NQA, preencha Nº de Série, Inspeção Visual e Funcional.' }
  }
  if (!p.temStatus) return { ok: true } // passagem/integração

  if (vazio(d.status)) return { ok: false, erro: 'Preencha Colaborador, PMO, OP, Nº de Série e Status.' }
  const reprovado = d.status!.toLowerCase() === 'reprovado'
  if (p.reprova === 'posicoes') {
    if (reprovado && vazio(d.pos)) return { ok: false, erro: 'Para Inspeção SPI reprovada, informe ao menos uma posição.' }
    return { ok: true }
  }
  if (p.reprova === 'defeitos' && reprovado && (vazio(d.cod) || vazio(d.pos) || vazio(d.tipo))) {
    return { ok: false, erro: 'Para reprovado, preencha código, posição e tipo do defeito.' }
  }
  return { ok: true }
}
