'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import {
  MENSAGEM_SERIE_EXIGE_LOTE,
  classificarBipeAlmoxarifado,
  mensagemPostoAnteriorNaoConcluido,
  mensagemRecusaLote,
  type NecessidadeAlmoxarifado,
  type NecessidadeLote,
  type PendenciaAlmoxarifado,
  type RecusaBipeAlmoxarifado,
  type TipoBipeAlmoxarifado,
} from '../domain/almoxarifado'
import { normalizarSerie } from '../domain/serie'
import { carregarOrdem } from '../infra/lancamento-repository'

export interface EntradaAlmoxarifado {
  pmo: string
  op: string
  posto: string
  colaborador: string
  bipe: string
}

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'

/**
 * Recusa de FORMATO (classificarBipeAlmoxarifado): decidida só pelo que foi bipado, sem round-trip
 * ao banco. `vazio` também cai aqui — sem texto nenhum não há o que classificar.
 */
const RECUSAS_FORMATO: Record<RecusaBipeAlmoxarifado, string> = {
  vazio: 'Bipe o Nº de Série da peça ou o código da caixa.',
  caixa_aberta: 'Esta caixa ainda não foi fechada. Feche a caixa na Embalagem antes de dar entrada.',
  caixa_em_op_individual: 'Nesta OP a entrada é por peça. Bipe o Nº de Série.',
  serie_em_op_coletiva: 'Nesta OP a entrada é por caixa. Bipe o código da caixa.',
}

/**
 * Recusa de DADO, vinda da RPC `sf_almoxarifado_entrada`. Cada motivo vira uma frase que diz o que
 * aconteceu e o que fazer — nunca só "erro".
 *
 * `caixa_nao_encontrada` cobre DUAS situações reais: etiqueta de outra OP/código digitado errado, e
 * caixa REABERTA na Embalagem — a 0106 limpa o campo `codigo` ao reabrir, então o bipe de uma caixa
 * reaberta cai aqui também, não em `caixa_aberta`. A frase precisa dar conta das duas.
 *
 * `sem_permissao` volta SEM `detalhe` — por isso não depende dele. Os demais usam o `detalhe` da
 * RPC quando ele já é a frase pronta (data/hora/quem, faixa, etc.); quando não, um texto fixo.
 *
 * `caixa_em_op_individual`/`serie_em_op_coletiva`: a RPC confere de novo o mesmo cruzamento que
 * `classificarBipeAlmoxarifado` já fez em TS (a flag `embalagem_individual` é editável numa OP em
 * andamento — ver 0129), então a frase é a MESMA de `RECUSAS_FORMATO`, não uma redação nova.
 */
function mensagemRecusaBanco(
  motivo: string,
  detalhe?: string,
  anterior?: {
    tipo: TipoBipeAlmoxarifado; postoAnterior?: string; precisaAprovado?: boolean
    faltam?: number; pecas?: number
  },
): string {
  switch (motivo) {
    case 'sem_permissao':
      return SEM_PERMISSAO
    case 'ordem_nao_encontrada':
      return detalhe || 'Ordem não encontrada.'
    case 'posto_invalido':
      return detalhe || 'Este posto não é um posto de Almoxarifado.'
    case 'posto_fora_da_op':
      // Sem este `case`, a recusa cairia no `default` ("Não foi possível registrar a entrada.") e o
      // operador ficaria sem o que fazer — justamente a recusa que se resolve com um gesto de
      // cadastro. O `detalhe` da RPC já nomeia o posto, a OP e a tela onde se resolve.
      return detalhe || 'Este posto não está nos postos desta OP. Acrescente-o em Cadastrar OP.'
    case 'caixa_em_op_individual':
      return RECUSAS_FORMATO.caixa_em_op_individual
    case 'serie_em_op_coletiva':
      return RECUSAS_FORMATO.serie_em_op_coletiva
    case 'caixa_nao_encontrada':
      return 'Caixa não encontrada nesta OP. Se ela foi reaberta na Embalagem, feche-a de novo antes de dar entrada.'
    case 'caixa_aberta':
      return 'Esta caixa ainda não foi fechada. Feche a caixa na Embalagem antes de dar entrada.'
    case 'caixa_reprovada':
      return detalhe || 'Esta caixa foi reprovada no NQA e vai ser remontada.'
    case 'caixa_sem_pecas':
      // A entrada grava uma linha por PEÇA da caixa, e as peças são as linhas que a Embalagem
      // carimbou com o código dela. Caixa fechada sem nenhuma peça só existe depois de um
      // cancelamento de lançamento levar essas linhas pra auditoria — quem resolve é a Embalagem.
      return detalhe || 'Esta caixa não tem nenhuma peça registrada na Embalagem.'
    case 'ja_lancado':
      // O `detalhe` da RPC é a frase inteira e é ela que vale: além de quando e por quem, ele agora
      // diz QUANTAS DAS N PEÇAS da caixa estão lançadas ("3 de 14") e, quando o estado é parcial,
      // aponta o caminho de volta (cancelar a caixa inteira em Registros). Antes a recusa dizia só
      // "já lançada": num estado parcial — a caixa entrou inteira e um cancelamento linha a linha
      // parou no meio — o operador via a mesma frase de sempre e não tinha saída nenhuma.
      // O texto fixo aqui é só o caso de a RPC não mandar detalhe; ele não tem como saber a contagem.
      return detalhe || 'Este bipe já deu entrada antes.'
    case 'serie_fora_da_faixa':
      return detalhe || 'Esta série está fora da faixa desta OP.'
    case 'serie_sem_embalagem':
      return 'Esta peça ainda não passou pela Embalagem.'
    case 'posto_anterior_nao_concluido':
      // 0155: o posto imediatamente antes do Almoxarifado na rota ainda não concluiu a peça/caixa. A
      // RPC devolve QUAL posto e se ele exige aprovação; a frase do operador sai do domínio. Sem esses
      // campos (RPC de outra versão), vale o `detalhe` pronto da RPC.
      if (anterior?.postoAnterior) {
        return mensagemPostoAnteriorNaoConcluido({
          tipo: anterior.tipo,
          postoAnterior: anterior.postoAnterior,
          precisaAprovado: anterior.precisaAprovado === true,
          faltam: anterior.faltam,
          pecas: anterior.pecas,
        })
      }
      return detalhe || 'O posto anterior ainda não concluiu este bipe.'
    case 'serie_exige_lote':
      // 0156: na OP individual com NQA no posto anterior, a entrada é pelo LOTE (Confirmar lote).
      return MENSAGEM_SERIE_EXIGE_LOTE
    default:
      return 'Não foi possível registrar a entrada.'
  }
}

/**
 * A etiqueta prometia um número e entrou outro — a frase que o painel mostra ao operador. A entrada
 * FOI aceita (quem manda é a peça, não o número impresso), então isto não é recusa: é o aviso de que
 * a caixa física e o código não combinam mais, e que alguém precisa olhar. Antes da 0129 devolver
 * `qtd_etiqueta`, essa divergência só existia num `raise warning` do Postgres — engolido pelo
 * supabase-js, invisível na tela, e a peça que faltava ficava parada na Embalagem pra sempre.
 */
function mensagemDivergenciaEtiqueta(qtdEtiqueta: number, quantidade: number): string {
  const etiqueta = qtdEtiqueta === 1 ? '1 peça' : `${qtdEtiqueta} peças`
  return `${etiqueta} na etiqueta, ${quantidade} ${quantidade === 1 ? 'entrou' : 'entraram'}.`
}

/**
 * Entrada no Almoxarifado: bipa o que acabou de ser embalado. `classificarBipeAlmoxarifado`
 * decide pelo FORMATO se peça ou caixa (sem tocar o banco); o que depende de dado — caixa existe,
 * está fechada, já foi lançada, a peça passou pela Embalagem — é a RPC `sf_almoxarifado_entrada`
 * quem confere, numa transação só (corrida entre dois operadores incluída).
 *
 * `quantidade` volta da RPC e é a contagem das PEÇAS que entraram: o bipe de caixa grava uma linha
 * por peça de dentro dela (ver 0129), então numa caixa de 14 voltam 14. O fallback pra `quantidade`
 * do domínio (a do código da etiqueta) só vale se a RPC não devolver o número.
 *
 * `divergencia` é o aviso de que a etiqueta e a contagem real não batem — a entrada foi aceita, mas
 * o painel tem que dizer as duas quantidades em vez de deixar a diferença só no log do Postgres.
 */
export async function registrarEntradaAlmoxarifado(
  entrada: EntradaAlmoxarifado,
): Promise<
  | { ok: true; quantidade: number; tipo: 'serie' | 'caixa'; divergencia?: string }
  | { ok: false; erro: string }
> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'lancar')) {
    return { ok: false, erro: SEM_PERMISSAO }
  }

  // 'vazio' não depende de OP nenhuma — resolvido sem round-trip ao banco.
  const bipeBruto = entrada.bipe ?? ''
  if (bipeBruto.trim() === '') {
    return { ok: false, erro: RECUSAS_FORMATO.vazio }
  }

  const pmo = entrada.pmo.trim()
  const op = entrada.op.trim()
  const posto = entrada.posto.trim()
  const colaborador = entrada.colaborador.trim()
  if (!colaborador || !pmo || !op || !posto) {
    return { ok: false, erro: 'Preencha Colaborador, contexto (OP) e Posto antes de bipar.' }
  }

  // A OP diz se a embalagem é individual ou coletiva — é o que classificarBipeAlmoxarifado precisa
  // pra saber se o formato bipado (série × código de caixa) é o esperado nesta OP.
  const ordem = await carregarOrdem(pmo, op)
  if (!ordem) return { ok: false, erro: 'Ordem não encontrada.' }

  const classificado = classificarBipeAlmoxarifado(bipeBruto, ordem.embalagem_individual)
  if (!classificado.ok) {
    return { ok: false, erro: RECUSAS_FORMATO[classificado.recusa] }
  }

  const { tipo, serie, codigoCaixa, quantidade } = classificado.bipe
  // p_serie_norm vem PRONTO do aplicativo (vazio na caixa) — é a mesma normalização que a
  // Embalagem grava em numero_serie_norm; sem isso a checagem de duplicidade da RPC não casa.
  const bipeParaRpc = tipo === 'caixa' ? codigoCaixa : serie
  const serieNorm = tipo === 'serie' ? normalizarSerie(serie) : ''

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_almoxarifado_entrada', {
    p_pmo: pmo,
    p_op: op,
    p_posto: posto,
    p_colaborador: colaborador,
    p_bipe: bipeParaRpc,
    p_tipo: tipo,
    p_quantidade: quantidade,
    p_serie_norm: serieNorm,
  })
  if (error) return { ok: false, erro: 'Não foi possível registrar a entrada.' }

  const r = data as {
    ok: boolean; motivo?: string; detalhe?: string; quantidade?: number; qtd_etiqueta?: number
    posto_anterior?: string; precisa_aprovado?: boolean; faltam?: number; pecas?: number
  }
  if (!r.ok) {
    return {
      ok: false,
      erro: mensagemRecusaBanco(r.motivo ?? '', r.detalhe, {
        tipo,
        postoAnterior: r.posto_anterior,
        precisaAprovado: r.precisa_aprovado,
        faltam: r.faltam,
        pecas: r.pecas,
      }),
    }
  }
  const gravadas = r.quantidade ?? quantidade
  // `qtd_etiqueta` só vem quando a etiqueta promete um número diferente do que entrou (ver 0129).
  const divergencia =
    r.qtd_etiqueta !== undefined && r.qtd_etiqueta !== null && r.qtd_etiqueta !== gravadas
      ? mensagemDivergenciaEtiqueta(r.qtd_etiqueta, gravadas)
      : undefined
  return { ok: true, quantidade: gravadas, tipo, divergencia }
}

const FALHA_NECESSIDADES = 'Não foi possível carregar as caixas esperando confirmação.'

/**
 * As caixas que o Almoxarifado tem que confirmar nesta OP (sf_almox_necessidades, 0155): fechadas,
 * concluídas no posto anterior da rota e ainda sem entrada. Confirmar continua sendo o bipe do código
 * da caixa (registrarEntradaAlmoxarifado) — esta lista só mostra o que está esperando.
 *
 * Mesmos gates da tela: `recebimento.lancar` (quem dá entrada) e `shopfloor.visualizar` (as OPs são
 * do ShopFloor). Falha do banco volta como ERRO, nunca como lista vazia: "nenhuma caixa esperando"
 * quando na verdade a leitura falhou faria o operador achar que não há nada a confirmar.
 */
export async function listarNecessidadesAlmoxarifado(
  pmo: string,
  op: string,
): Promise<{ ok: true; necessidades: NecessidadeAlmoxarifado[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (
    !sessao ||
    !podeNoModulo(sessao.perfil, 'recebimento', 'lancar') ||
    !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')
  ) {
    return { ok: false, erro: SEM_PERMISSAO }
  }

  const p = (pmo ?? '').trim()
  const o = (op ?? '').trim()
  // Sem OP no cabeçalho ainda (ele é carregado pelo primeiro bipe): não há o que perguntar.
  if (!p || !o) return { ok: true, necessidades: [] }

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_almox_necessidades', { p_pmo: p, p_op: o })
  if (error) {
    return { ok: false, erro: error.message?.includes('SEM_PERMISSAO') ? SEM_PERMISSAO : FALHA_NECESSIDADES }
  }
  if (!Array.isArray(data)) return { ok: false, erro: FALHA_NECESSIDADES }

  const linhas = data as { codigo: string; seq: number; pecas: number; fechada_em: string | null }[]
  return {
    ok: true,
    necessidades: linhas.map((l) => ({
      codigo: l.codigo,
      seq: Number(l.seq),
      pecas: Number(l.pecas),
      fechadaEm: l.fechada_em ?? null,
    })),
  }
}

const FALHA_LOTES = 'Não foi possível carregar os lotes esperando confirmação.'

/**
 * Os lotes do NQA individual que o Almoxarifado tem que confirmar nesta OP (sf_almox_lotes, 0156):
 * aprovados no posto NQA anterior da rota, com SN ainda sem entrada, cada um com TODOS os SNs e a
 * amostra da Tabela NQA. Uma action à parte da lista de caixas (e não a mesma devolvendo os dois): a
 * OP coletiva só tem caixa, a individual com NQA só tem lote, e a tela já sabe qual é o caso.
 *
 * Mesmos gates e a mesma regra da lista de caixas: falha do banco é ERRO, nunca lista vazia.
 */
export async function listarLotesAlmoxarifado(
  pmo: string,
  op: string,
): Promise<{ ok: true; lotes: NecessidadeLote[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (
    !sessao ||
    !podeNoModulo(sessao.perfil, 'recebimento', 'lancar') ||
    !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')
  ) {
    return { ok: false, erro: SEM_PERMISSAO }
  }

  const p = (pmo ?? '').trim()
  const o = (op ?? '').trim()
  if (!p || !o) return { ok: true, lotes: [] }

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_almox_lotes', { p_pmo: p, p_op: o })
  if (error) {
    return { ok: false, erro: error.message?.includes('SEM_PERMISSAO') ? SEM_PERMISSAO : FALHA_LOTES }
  }
  if (!Array.isArray(data)) return { ok: false, erro: FALHA_LOTES }

  const linhas = data as {
    lote_id: string; rotulo: string; pecas: number; amostra: number | null; sns: string[] | null
    ja_lancadas: number; aprovado_em: string | null
  }[]
  return {
    ok: true,
    lotes: linhas.map((l) => ({
      loteId: l.lote_id,
      rotulo: l.rotulo,
      pecas: Number(l.pecas),
      amostra: l.amostra === null || l.amostra === undefined ? null : Number(l.amostra),
      sns: Array.isArray(l.sns) ? l.sns : [],
      jaLancadas: Number(l.ja_lancadas ?? 0),
      aprovadoEm: l.aprovado_em ?? null,
    })),
  }
}

export interface ConfirmacaoLote {
  pmo: string
  op: string
  posto: string
  colaborador: string
  loteId: string
  /** Os SNs bipados da amostra, como vieram do coletor. */
  amostra: string[]
}

/**
 * Confirma o LOTE com a amostra bipada (sf_almoxarifado_lote, 0156). A amostra vai NORMALIZADA (a mesma
 * forma que o NQA gravou em numero_serie_norm) e sem repetido; quem confere de verdade — SN do lote,
 * tamanho pela Tabela NQA, lote aprovado, nada lançado antes — é a RPC, numa transação, sob a trava do
 * lote. Ela grava uma entrada por SN e UM envio ao Compels; `quantidade` são as peças que entraram.
 */
export async function confirmarLoteAlmoxarifado(
  c: ConfirmacaoLote,
): Promise<{ ok: true; quantidade: number; lote: string } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'lancar')) {
    return { ok: false, erro: SEM_PERMISSAO }
  }
  const pmo = (c.pmo ?? '').trim()
  const op = (c.op ?? '').trim()
  const posto = (c.posto ?? '').trim()
  const colaborador = (c.colaborador ?? '').trim()
  const loteId = (c.loteId ?? '').trim()
  if (!colaborador || !pmo || !op || !posto) {
    return { ok: false, erro: 'Preencha Colaborador, contexto (OP) e Posto antes de confirmar.' }
  }
  if (!loteId) return { ok: false, erro: 'Escolha o lote a confirmar.' }
  const amostra = [...new Set((c.amostra ?? []).map((s) => normalizarSerie(s)).filter((s) => s !== ''))]

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_almoxarifado_lote', {
    p_pmo: pmo,
    p_op: op,
    p_posto: posto,
    p_colaborador: colaborador,
    p_lote_id: loteId,
    p_amostra: amostra,
  })
  if (error) return { ok: false, erro: 'Não foi possível confirmar o lote.' }
  const r = (data ?? {}) as { ok?: boolean; motivo?: string; detalhe?: string; quantidade?: number; lote?: string }
  if (!r.ok) return { ok: false, erro: mensagemRecusaLote(r.motivo ?? '', r.detalhe) }
  return { ok: true, quantidade: Number(r.quantidade ?? 0), lote: r.lote ?? '' }
}

const FALHA_PENDENCIAS = 'Não foi possível carregar o que está esperando confirmação no Almoxarifado.'

/**
 * Tudo o que espera confirmação no Almoxarifado, de TODAS as OPs ativas (0158): a tela abre com a lista
 * e a pessoa escolhe por onde começar. Falha de leitura é erro, nunca lista vazia: "nada esperando"
 * quando na verdade não leu faria o operador parar de procurar.
 */
export async function listarPendenciasAlmoxarifado(): Promise<
  { ok: true; pendencias: PendenciaAlmoxarifado[] } | { ok: false; erro: string }
> {
  const sessao = await getSessao()
  if (
    !sessao ||
    !podeNoModulo(sessao.perfil, 'recebimento', 'lancar') ||
    !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')
  ) {
    return { ok: false, erro: SEM_PERMISSAO }
  }
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_almox_pendencias')
  if (error) {
    return { ok: false, erro: error.message?.includes('SEM_PERMISSAO') ? SEM_PERMISSAO : FALHA_PENDENCIAS }
  }
  if (!Array.isArray(data)) return { ok: false, erro: FALHA_PENDENCIAS }
  const linhas = data as { pmo: string; op: string; tipo: string; codigo: string; pecas: number; amostra: number | null }[]
  return {
    ok: true,
    pendencias: linhas.map((l) => ({
      pmo: l.pmo,
      op: l.op,
      tipo: l.tipo === 'lote' ? 'lote' : 'caixa',
      codigo: l.codigo,
      pecas: Number(l.pecas),
      amostra: l.amostra === null || l.amostra === undefined ? null : Number(l.amostra),
    })),
  }
}
