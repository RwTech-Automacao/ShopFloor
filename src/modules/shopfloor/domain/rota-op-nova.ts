import type { PerfilPosto } from './perfil-posto'

/**
 * Rota padrão de uma OP NOVA: o posto Almoxarifado vem pré-marcado como ÚLTIMO posto, "como se fosse o
 * card de Concluído" (decisão de 09/11/2026). Sendo o último, é ele que manda no % de conclusão e na
 * finalização automática (0145): a OP nova só fecha em 100% quando a produção entra no estoque.
 *
 * Só vale ao CRIAR a OP (pela tela ou puxando um Padrão de fluxo). A pessoa pode tirar o posto antes de
 * salvar. Editar uma OP existente NUNCA acrescenta o Almoxarifado: numa rota antiga ele derrubaria o %
 * e reabriria OPs já concluídas — por isso nada aqui roda no servidor nem em OP gravada.
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
 * Monta a rota de uma OP nova a partir de uma base (vazia ou os postos de um Padrão): mantém a ordem
 * da base sem repetir posto e põe o Almoxarifado no fim, uma vez só — se a base já o tinha em outra
 * posição, ele é movido para o fim. Sem posto Almoxarifado, devolve a base sem repetições.
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
