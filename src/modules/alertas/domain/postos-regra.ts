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
 *  - defeito: só quem registra o código. `alerta_defeitos` exige status reprovado E
 *    `codigo_defeito` preenchido — sem código não há o que repetir.
 *  - tempo médio: qualquer posto, que todo posto tem intervalo entre um bipe e o próximo.
 */
export function postoServeAoTipo(tipo: TipoRegra, posto: PostoRegra): boolean {
  if (tipo === 'aprovacao') return posto.temStatus
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
