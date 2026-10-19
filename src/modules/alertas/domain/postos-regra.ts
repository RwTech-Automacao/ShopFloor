import type { PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import type { TipoRegra } from './tipos'

/**
 * O posto como o formulário de regra precisa conhecê-lo: o nome e o que o perfil dele faz.
 * Nada de lista fixa de posto no código — quem manda é o perfil cadastrado em `sf_postos`.
 */
export interface PostoRegra {
  chave: string
  /** O posto grava Aprovado/Reprovado (`sf_posto_perfis.tem_status`). */
  temStatus: boolean
  /** O posto registra o CÓDIGO do defeito na reprova (`sf_posto_perfis.reprova` ≠ 'nenhum'). */
  coletaDefeito: boolean
}

/** Traduz o perfil do posto para o que a regra de alerta precisa saber. */
export function postoRegraDe(chave: string, perfil: PerfilPosto): PostoRegra {
  return { chave, temStatus: perfil.temStatus, coletaDefeito: perfil.reprova !== 'nenhum' }
}

/**
 * O posto serve para este tipo de regra? Oferecer um posto que nunca dispara é pior do que não ter
 * a regra: o gestor acha que está coberto.
 *
 *  - aprovação: só quem grava status. `alerta_taxas` conta apenas os bipes Aprovado/Reprovado, então
 *    num posto de passagem (Inicial, Integração, Embalagem, Printer) a janela vem com 0 amostras e a
 *    regra nunca fica avaliável. Inspeção NQA ENTRA: ela reprova, só não guarda código de defeito.
 *  - resumo: igual à aprovação. `0141` só conta Aprovado/Reprovado; posto de passagem não tem linha
 *    e seria removido do relatório em silêncio.
 *  - defeito: só quem registra o código. `alerta_defeitos` exige status reprovado E
 *    `codigo_defeito` preenchido — sem código não há o que repetir.
 *  - tempo médio: qualquer posto, que todo posto tem intervalo entre um bipe e o próximo.
 *  - fim de EMB: nenhum posto. A regra não tem posto nenhum (o gatilho é a EMB fechar, e EMB não é
 *    posto), e a lista de postos não aparece no formulário dele. É o único tipo que devolve false
 *    para TODO posto — por isso o teste "todo tipo aceita pelo menos o posto de teste" o exclui.
 */
export function postoServeAoTipo(tipo: TipoRegra, posto: PostoRegra): boolean {
  if (tipo === 'emb') return false
  // O resumo traz a taxa de aprovação: posto sem status não tem linha Aprovado/Reprovado e sumiria.
  if (tipo === 'aprovacao' || tipo === 'resumo') return posto.temStatus
  if (tipo === 'defeito') return posto.coletaDefeito
  return true
}

/** Um posto na lista do formulário. `foraDoTipo` = só está aí porque a regra salva já o tinha. */
export interface PostoOferecido {
  chave: string
  foraDoTipo: boolean
}

/**
 * Os postos que o formulário oferece, na ordem do fluxo: os que servem ao tipo, mais os que a regra
 * SALVA já trazia. Um posto que o filtro novo esconderia não pode desaparecer em silêncio ao editar
 * uma regra antiga (ou depois de alguém trocar o perfil do posto) — ele continua na lista, marcado
 * e com aviso, e o gestor decide se tira.
 */
export function postosOferecidos(
  tipo: TipoRegra,
  postos: PostoRegra[],
  jaNaRegra: string[],
): PostoOferecido[] {
  return postos
    .map((p) => ({ chave: p.chave, foraDoTipo: !postoServeAoTipo(tipo, p) }))
    .filter((p) => !p.foraDoTipo || jaNaRegra.includes(p.chave))
}

/** Quantos postos a coluna mostra por extenso antes de resumir o resto num contador. */
const POSTOS_VISIVEIS = 2

/**
 * O texto curto da coluna "Postos" da lista de regras.
 *
 * Antes a lista inteira era impressa separada por vírgula, e a regra de resumo diário — que tem os
 * 12 postos marcados — esticava a linha da tabela até virar um parágrafo (pedido do usuário,
 * 14/10/2026).
 *
 *   todos os postos do catálogo  ->  'Todos os postos'
 *   até dois                     ->  'Teste, Burn-in'
 *   mais de dois                 ->  'Inspeção SPI, Inspeção SMD +3'
 *
 * O caso "todos" é o que mais vale: responde "falta algum?" sem obrigar a conferir doze nomes.
 * Só vale quando são TODOS mesmo — faltando um, a pessoa precisa enxergar que falta.
 *
 * A ordem é a que veio na regra (a do fluxo), nunca alfabética: quem lê reconhece o começo da
 * linha de produção. Posto que saiu do catálogo continua contando, senão o resumo mentiria a
 * quantidade de uma regra antiga.
 *
 * A lista completa não se perde: quem chama põe no `title`.
 */
export function resumoPostos(daRegra: string[], doCatalogo: string[]): string {
  if (daRegra.length === 0) return ''
  if (doCatalogo.length > 0 && daRegra.length === doCatalogo.length) {
    const catalogo = new Set(doCatalogo)
    if (daRegra.every((p) => catalogo.has(p))) return 'Todos os postos'
  }
  if (daRegra.length <= POSTOS_VISIVEIS) return daRegra.join(', ')
  return `${daRegra.slice(0, POSTOS_VISIVEIS).join(', ')} +${daRegra.length - POSTOS_VISIVEIS}`
}
