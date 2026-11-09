import type { PerfilPosto } from './perfil-posto'

/**
 * Rota de uma OP NOVA: o posto Almoxarifado é OBRIGATÓRIO e vem sempre como ÚLTIMO posto, "como se
 * fosse o card de Concluído" (decisão de 09/11/2026). Sendo o último, é ele que manda no % de conclusão
 * e na finalização automática (0145): a OP nova só fecha em 100% quando a produção entra no estoque.
 *
 * Vale ao CRIAR a OP (pela tela, por Padrão de fluxo e, no servidor, mesmo que o formulário não mande).
 * Na EDIÇÃO a trava só existe se a rota GRAVADA já tem o Almoxarifado; numa OP antiga sem ele nada é
 * acrescentado: numa rota antiga ele derrubaria o % e reabriria OPs já concluídas (sem backfill).
 */

/**
 * O posto Almoxarifado do catálogo: o PRIMEIRO, na ordem do catálogo, cujo perfil tem recurso
 * `almoxarifado` (decide o perfil, nunca o nome). O Cadastrar Posto só deixa existir um; se mesmo assim
 * houver mais, a ordem do catálogo desempata. Nenhum = `null` (a rota fica como está, sem erro).
 */
export function postoAlmoxarifadoPadrao(
  catalogo: readonly string[],
  perfilDo: (posto: string) => Pick<PerfilPosto, 'recurso'>,
): string | null {
  return catalogo.find((p) => perfilDo(p).recurso === 'almoxarifado') ?? null
}

/**
 * Monta a rota com o Almoxarifado fixo no fim a partir de uma base (vazia, os postos de um Padrão ou o
 * que o formulário mandou): mantém a ordem da base sem repetir posto e põe o Almoxarifado no fim, uma
 * vez só — se a base já o tinha em outra posição, ele é movido para o fim; se não tinha, entra. Sem
 * posto Almoxarifado (`null`), devolve a base sem repetições.
 */
export function rotaPadraoOpNova(base: readonly string[], almoxarifado: string | null): string[] {
  const rota: string[] = []
  for (const p of base) {
    if (p !== almoxarifado && !rota.includes(p)) rota.push(p)
  }
  if (almoxarifado !== null) rota.push(almoxarifado)
  return rota
}

/**
 * Acrescenta um posto à rota. Se o Almoxarifado é o último, o posto novo entra ANTES dele (o
 * Almoxarifado continua fechando a rota); senão, vai para o fim. Posto já presente = rota intacta.
 */
export function adicionarPostoNaRota(rota: readonly string[], posto: string, almoxarifado: string | null): string[] {
  if (rota.includes(posto)) return [...rota]
  const ultimo = rota[rota.length - 1]
  if (almoxarifado !== null && posto !== almoxarifado && ultimo === almoxarifado) {
    return [...rota.slice(0, -1), posto, almoxarifado]
  }
  return [...rota, posto]
}

/**
 * Move o posto da posição `i` em `delta` (−1 sobe, +1 desce). Com o Almoxarifado fixo, nem ele se move
 * nem outro posto passa para depois dele: a rota continua terminando no Almoxarifado.
 */
export function moverPostoNaRota(rota: readonly string[], i: number, delta: number, fixo: string | null): string[] {
  const j = i + delta
  if (j < 0 || j >= rota.length || i < 0 || i >= rota.length) return [...rota]
  if (fixo !== null && (rota[i] === fixo || rota[j] === fixo)) return [...rota]
  const copia = [...rota]
  const [item] = copia.splice(i, 1)
  copia.splice(j, 0, item!)
  return copia
}

export const MSG_ALMOXARIFADO_OBRIGATORIO = 'O posto Almoxarifado é obrigatório nesta OP e não pode ser retirado da rota.'

/**
 * Rota a gravar na EDIÇÃO. A trava vem da rota GRAVADA no banco (nunca do formulário): se ela já tem o
 * Almoxarifado, ele não pode sair (recusa) e é mantido como último. Se a OP gravada não tem o
 * Almoxarifado (OP antiga), a rota do formulário passa como veio — nada é acrescentado.
 */
export function rotaDaEdicao(
  rotaGravada: readonly string[],
  rotaNova: readonly string[],
  almoxarifado: string | null,
): { ok: true; rota: string[] } | { ok: false; erro: string } {
  if (almoxarifado === null || !rotaGravada.includes(almoxarifado)) return { ok: true, rota: [...rotaNova] }
  if (!rotaNova.includes(almoxarifado)) return { ok: false, erro: MSG_ALMOXARIFADO_OBRIGATORIO }
  return { ok: true, rota: rotaPadraoOpNova(rotaNova, almoxarifado) }
}
