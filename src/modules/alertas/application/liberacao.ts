import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { MODULOS_ALERTA, type ModuloAlerta } from '../domain/modulo'

export interface Ambiente {
  vercel?: string // VERCEL_ENV: 'preview' | 'development' | 'production' (só existe na Vercel)
  node?: string   // NODE_ENV
}

/** Preview da Vercel ou `npm run dev`: não é produção, os Alertas ficam sempre visíveis. */
function foraDeProducao(amb: Ambiente): boolean {
  if (amb.vercel === 'preview' || amb.vercel === 'development') return true
  return amb.node === 'development'
}

/** Está na lista (`a@x,b@y` ou `*`)? Vazia ou ausente = ninguém. Sem olhar o ambiente. */
function estaNaLista(email: string | null | undefined, listaEnv: string | undefined): boolean {
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
 * Lançamento escondido dos Alertas do SHOPFLOOR, SÓ em produção (AWS): lá, só os e-mails de
 * `ALERTAS_LIBERADO_PARA` veem e acessam as telas e ações. `*` = todos (é assim que se libera de
 * vez). Vazia ou ausente = NINGUÉM: esquecer a variável no deploy não pode expor a feature.
 * No preview da Vercel e no dev local a feature aparece sempre (é onde se testa).
 *
 * ⚠️ O Recebimento NÃO usa esta variável: tem a própria trava (`alertasRecebimentoLiberados`), para
 * que liberar os Alertas do ShopFloor com `*` não abra a tela do Recebimento junto.
 */
export function alertasLiberados(
  email: string | null | undefined,
  listaEnv: string | undefined = process.env.ALERTAS_LIBERADO_PARA,
  ambiente: Ambiente = { vercel: process.env.VERCEL_ENV, node: process.env.NODE_ENV },
): boolean {
  if (foraDeProducao(ambiente)) return true
  return estaNaLista(email, listaEnv)
}

/**
 * Mesma regra de `alertasLiberados`, com a lista própria do Recebimento
 * (`ALERTAS_RECEBIMENTO_LIBERADO_PARA`). Vazia ou ausente = NINGUÉM em produção.
 */
export function alertasRecebimentoLiberados(
  email: string | null | undefined,
  listaEnv: string | undefined = process.env.ALERTAS_RECEBIMENTO_LIBERADO_PARA,
  ambiente: Ambiente = { vercel: process.env.VERCEL_ENV, node: process.env.NODE_ENV },
): boolean {
  if (foraDeProducao(ambiente)) return true
  return estaNaLista(email, listaEnv)
}

/** A trava certa para o módulo da tela/ação. */
export function alertasLiberadosDoModulo(
  modulo: ModuloAlerta,
  email: string | null | undefined,
): boolean {
  return modulo === 'recebimento' ? alertasRecebimentoLiberados(email) : alertasLiberados(email)
}

/**
 * Pode usar os Alertas (Meu perfil e vínculo Telegram/Discord)? Quem administra algum módulo com
 * alertas — são essas as pessoas que podem ser responsáveis — E está liberado NAQUELE módulo. E, desde a
 * 0182, quem usa a tela do Almoxarifado (responsável possível da regra 'compels'), com a trava do ShopFloor. Sem o
 * admin, a pessoa conseguiria vincular a conta mas nunca receberia nada.
 *
 * ⚠️ A liberação é por módulo: quem administra só o Recebimento só entra aqui quando o Recebimento
 * está liberado para ele, mesmo que os Alertas do ShopFloor estejam abertos a todos.
 */
export function alertasDisponiveis(
  sessao: { email: string | null | undefined; perfil: Parameters<typeof podeNoModulo>[0] } | null,
): boolean {
  if (!sessao) return false
  const administra = MODULOS_ALERTA.some(
    (m) => podeNoModulo(sessao.perfil, m, 'administrar') && alertasLiberadosDoModulo(m, sessao.email),
  )
  // 0182: quem usa a tela do Almoxarifado pode ser responsável da regra 'compels' (do ShopFloor), então
  // precisa do Meu perfil para vincular Telegram/Discord. Segue a trava do ShopFloor, como a regra.
  return administra || (usaTelaDoAlmoxarifado(sessao.perfil) && alertasLiberadosDoModulo('shopfloor', sessao.email))
}

/**
 * As duas permissões da tela do Almoxarifado (`/recebimento/almoxarifado`): dar entrada no Recebimento
 * e ver o Fluxo de Processos. É a régua extra do responsável da regra 'compels' (`alerta_pode_receber`,
 * 0182) — as duas têm de andar juntas.
 */
function usaTelaDoAlmoxarifado(perfil: Parameters<typeof podeNoModulo>[0]): boolean {
  return podeNoModulo(perfil, 'recebimento', 'lancar') && podeNoModulo(perfil, 'shopfloor', 'visualizar')
}

/** Quais itens "Alertas" do menu aparecem para esta pessoa (um por módulo). */
export function alertasMenuPorModulo(
  email: string | null | undefined,
): Record<ModuloAlerta, boolean> {
  return {
    shopfloor: alertasLiberadosDoModulo('shopfloor', email),
    recebimento: alertasLiberadosDoModulo('recebimento', email),
  }
}
