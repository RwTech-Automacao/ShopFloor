import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { MODULOS_ALERTA } from '../domain/modulo'

export interface Ambiente {
  vercel?: string // VERCEL_ENV: 'preview' | 'development' | 'production' (só existe na Vercel)
  node?: string   // NODE_ENV
}

/** Preview da Vercel ou `npm run dev`: não é produção, os Alertas ficam sempre visíveis. */
function foraDeProducao(amb: Ambiente): boolean {
  if (amb.vercel === 'preview' || amb.vercel === 'development') return true
  return amb.node === 'development'
}

/**
 * Lançamento escondido dos Alertas SÓ em produção (AWS): lá, só os e-mails de
 * `ALERTAS_LIBERADO_PARA` veem e acessam as telas e ações de Alertas. `*` = todos (é assim que se
 * libera de vez). Vazia ou ausente = NINGUÉM: esquecer a variável no deploy não pode expor a feature.
 * No preview da Vercel e no dev local a feature aparece sempre (é onde se testa).
 */
export function alertasLiberados(
  email: string | null | undefined,
  listaEnv: string | undefined = process.env.ALERTAS_LIBERADO_PARA,
  ambiente: Ambiente = { vercel: process.env.VERCEL_ENV, node: process.env.NODE_ENV },
): boolean {
  if (foraDeProducao(ambiente)) return true

  const lista = (listaEnv ?? '').trim()
  if (lista === '') return false

  const emails = lista
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (emails.includes('*')) return true

  const alvo = (email ?? '').trim().toLowerCase()
  if (!alvo) return false
  return emails.includes(alvo)
}

/**
 * Pode usar os Alertas (menu, Meu perfil e vínculo Telegram/Discord)? Quem administra QUALQUER
 * módulo com alertas — são essas as pessoas que podem ser responsáveis — e, em produção, está na
 * liberação acima. Sem o admin, a pessoa conseguiria vincular a conta mas nunca receberia nada.
 *
 * ⚠️ Era `'shopfloor'` fixo. Com as regras do Recebimento (spec, decisão 6), quem administra só o
 * Recebimento tem de poder vincular o Telegram/Discord em Meu perfil — senão é escolhido como
 * responsável e não recebe nada, sem nenhum aviso.
 */
export function alertasDisponiveis(
  sessao: { email: string | null | undefined; perfil: Parameters<typeof podeNoModulo>[0] } | null,
): boolean {
  if (!sessao) return false
  const admin = MODULOS_ALERTA.some((m) => podeNoModulo(sessao.perfil, m, 'administrar'))
  return admin && alertasLiberados(sessao.email)
}
