import 'server-only'
import { AGUARDANDO_REQUISICAO, enviarEntrada, type PortaErp } from '@/modules/compels/application/enviar-entrada'
import { opLiberada } from '@/modules/compels/domain/liberacao'
import { semSufixo } from '@/modules/compels/domain/sem-sufixo'
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import {
  ConfiguracaoIncompleta,
  EstoqueNaoConfigurado,
  configDoAmbiente,
  destinoDoEstoque,
  pagarPendenciaLigado,
} from '@/modules/compels/infra/config'
import type { EnvioEstoqueReservado, PortaCompels, ResultadoEnvioEstoque } from '../application/enviar-estoque'
import {
  criarBaseDaOp,
  criarErroAnterior,
  criarFilhaAtual,
  criarOpIntegrada,
  criarOrdemDaLinha,
  criarSomaEnviada,
  criarTrocarOpDaLinha,
  type BaseDaOp,
} from './estoque-envios-repository'

/**
 * O ÚLTIMO METRO DA FILA DE ESTOQUE: entrega UMA linha da fila ao Compels (Requisitar + Apontar).
 *
 * A inteligência mora em `src/modules/compels` (estado da OP, decisão, corpos conferidos com a captura,
 * trava, token pela rota do ezpointweb). Este arquivo só liga a fila a ela: decide se a OP está liberada,
 * calcula o acumulado já enviado e traduz o resultado para o que o laço da fila entende. Spec:
 * `docs/superpowers/specs/2026-10-16-integracao-compels-apontamento-design.md`.
 *
 * Uma linha = um apontamento. Em OP de produto único o bipe é peça a peça (149 bipes = 149 apontamentos).
 *
 * VARIÁVEIS (nunca no código): COMPELS_EZPOINT_USUARIO e COMPELS_EZPOINT_SENHA (login do ezpointweb);
 * COMPELS_EZPOINT_EMPRESA (padrão `enterplak`); COMPELS_ESTOQUE_ID e COMPELS_LOCACAO_ID (padrão 217 e
 * 5314: estoque PA, locação Padrão); COMPELS_ESTOQUE_EINTER_ID e COMPELS_LOCACAO_EINTER_ID (SEM padrão:
 * o estoque EINTER escolhido no Almoxarifado, 0175; sem as duas, a linha EINTER espera); COMPELS_OPS_LIBERADAS (OPs que a integração pode enviar, ou `*`;
 * VAZIA = nenhuma lista; a OP criada a partir de 09/11/2026 fica liberada sozinha: `sf_ordens.integrar_compels`, 0176,
 * e vale a lista OU a coluna); COMPELS_PAGAR_PENDENCIA (`1` liga o "Pagar Pendência" automático, só a partir da 2ª tentativa
 * da linha que esperou por falta de saldo; ausente/vazia = desligado).
 *
 * Esperar não é falhar: tudo o que é recusado ANTES de gravar no ERP e passa sozinho (OP em uso, sem
 * empenho, pendência de material, falta de saldo, ERP fora do ar, OP ainda não liberada) volta como
 * `aguardar` e a fila não gasta tentativa. As três esperas que NÃO são problema (OP não liberada,
 * integração não configurada, estorno manual) vão além, com `esperado`: o alerta de problemas do Compels
 * as ignora (0170). Quando uma OP já deu "espere" nesta rodada, as outras linhas dela recebem a mesma
 * resposta sem chamar o ERP de novo.
 */

const MOTIVO_ESTORNO =
  'O estorno no Compels ainda é manual: estorne o apontamento, a requisição e o empenho na tela do ERP.'

export interface DependenciasPortaCompels {
  env?: Record<string, string | undefined>
  /** Para teste: o ERP de mentira. Em produção é o `ClienteCompels`. */
  erp?: PortaErp
  /** Para teste: a soma já enviada por OP. Em produção é a função do banco (0153). */
  somaEnviada?: (pmo: string, op: string, excetoId: string) => Promise<number>
  /** Para teste: o ponto de partida por OP do Compels. Em produção é a tabela da 0168. */
  base?: BaseDaOp
  /** Para teste: o erro da tentativa anterior da linha. Em produção é a coluna `erro` da fila. */
  erroAnterior?: (id: string) => Promise<string | null>
  /** Para teste: a OP foi criada com a integração automática ligada? Em produção é `sf_ordens.integrar_compels` (0176). */
  opIntegrada?: (pmo: string, op: string) => Promise<boolean>
  /** Para teste: a OP do ShopFloor de uma linha de PRT (0184). Em produção é `sf_ordens`. */
  ordemDaLinha?: (ordemId: string) => Promise<{ op: string; integrar: boolean } | null>
  /** Para teste: a OP filha ATUAL do trecho (sf_ordem_trechos.compels_op por OP e código da PRT). */
  filhaAtual?: (ordemId: string, codigo: string) => Promise<string | null>
  /** Para teste: regrava a op de uma linha de PRT que estava com a filha antiga (melhor esforço). */
  trocarOpDaLinha?: (id: string, op: string) => Promise<void>
}

/** Marca gravada na Observação do apontamento: curta, e a chave diz que bipe foi. */
function marcaDaLinha(envio: EnvioEstoqueReservado): string {
  return `ShopFloor ${envio.chave}`.slice(0, 100)
}

/**
 * Cria a porta para UMA rodada do cron (o cache de "esta OP está esperando" vale só dentro dela).
 * Lê a configuração na hora de usar, não ao importar: o build e os testes não precisam das variáveis.
 */
export function criarPortaCompels(deps: DependenciasPortaCompels = {}): PortaCompels {
  const env = deps.env ?? process.env
  let erp: PortaErp | undefined = deps.erp
  const somaEnviada = deps.somaEnviada ?? criarSomaEnviada()
  const baseDaOp = deps.base ?? criarBaseDaOp()
  const erroAnterior = deps.erroAnterior ?? criarErroAnterior()
  const opIntegrada = deps.opIntegrada ?? criarOpIntegrada()
  const ordemDaLinha = deps.ordemDaLinha ?? criarOrdemDaLinha()
  const filhaAtual = deps.filhaAtual ?? criarFilhaAtual()
  const trocarOpDaLinha = deps.trocarOpDaLinha ?? criarTrocarOpDaLinha()
  const esperando = new Map<string, ResultadoEnvioEstoque>()

  return async function enviarMovimentacaoCompels(reservado: EnvioEstoqueReservado): Promise<ResultadoEnvioEstoque> {
    let envio = reservado
    // Estorno automático é a fase 2: por ora fica visível na tela de pendências, sem gastar tentativa.
    if (envio.operacao === 'estorno') return { ok: false, erro: MOTIVO_ESTORNO, aguardar: true, esperado: true }

    // Liberada pela lista do ambiente OU pela própria OP (criada a partir de 09/11/2026, 0176). O banco só é
    // consultado quando a lista não liberou; se a leitura falhar, a linha espera (nada foi gravado no ERP).
    // LINHA DE PRT (estrutura da OP, 0184): liberada pela chave das PRTs E pela OP do ShopFloor de onde veio.
    if (envio.ordemId) {
      if (env.COMPELS_PRT_LIGADO !== '1') {
        return {
          ok: false, aguardar: true, esperado: true,
          erro: 'Apontamento das PRTs ainda desligado: a linha fica esperando até a chave COMPELS_PRT_LIGADO ser ligada.',
        }
      }
      let pai: { op: string; integrar: boolean } | null
      try {
        pai = await ordemDaLinha(envio.ordemId)
      } catch (e) {
        return { ok: false, aguardar: true, erro: `Não foi possível conferir a OP da PRT ${envio.pmo}: ${e instanceof Error ? e.message : String(e)}` }
      }
      if (!pai || !(opLiberada(pai.op, env.COMPELS_OPS_LIBERADAS) || pai.integrar)) {
        return {
          ok: false, aguardar: true, esperado: true,
          erro: `OP ${pai?.op ?? '?'} ainda não está liberada para a integração com o Compels (${envio.pmo} da OP ${envio.op}). Faça a entrada à mão no ERP, ou libere a OP.`,
        }
      }
      // A filha vale a do TRECHO da OP agora, não a gravada na linha: a linha pode ter nascido antes de a filha ser
      // casada, ou ter ficado com a antiga (reservada no momento em que o gravarFilhas reapontou as pendentes).
      let filha: string
      try {
        filha = ((await filhaAtual(envio.ordemId, envio.pmo)) ?? '').trim()
      } catch (e) {
        return { ok: false, aguardar: true, erro: `Não foi possível conferir a OP filha da PRT ${envio.pmo}: ${e instanceof Error ? e.message : String(e)}` }
      }
      // O adaptador não procura a filha no Compels: quem procura é o salvamento da OP (aplicarEstruturaNaOp).
      if (!filha) {
        return {
          ok: false, aguardar: true, esperado: true,
          erro: `${envio.pmo} não tem OP filha no Compels: confira a estrutura e salve a OP ${pai.op} de novo para procurar.`,
        }
      }
      if (filha !== envio.op) {
        const antiga = envio.op
        envio = { ...envio, op: filha }
        try {
          await trocarOpDaLinha(envio.id, filha)
        } catch (e) {
          console.error(`[estoque] regravar a op da linha ${envio.chave} (${antiga} → ${filha}) falhou:`, e instanceof Error ? e.message : e)
        }
      }
    } else if (!opLiberada(envio.op, env.COMPELS_OPS_LIBERADAS)) {
      let automatica: boolean
      try {
        automatica = await opIntegrada(envio.pmo, envio.op)
      } catch (e) {
        return {
          ok: false,
          erro: `Não foi possível conferir se a OP ${envio.op} está liberada para o Compels: ${e instanceof Error ? e.message : String(e)}`,
          aguardar: true,
        }
      }
      if (!automatica) {
        return {
          ok: false,
          erro: `OP ${envio.op} ainda não está liberada para a integração com o Compels. Faça a entrada à mão no ERP, ou libere a OP.`,
          aguardar: true,
          esperado: true,
        }
      }
    }

    const jaEsperando = esperando.get(envio.op)
    if (jaEsperando) return jaEsperando

    try {
      // O destino é POR LINHA (0175): o PA é o de sempre; o EINTER vem das variáveis próprias e, sem elas, a linha
      // espera com a mensagem de configuração (nada foi gravado, não gasta tentativa). Antes do cliente do ERP,
      // para nem pedir token por uma linha que não tem para onde ir.
      const destino = destinoDoEstoque(envio.estoque ?? 'PA', env)
      erp ??= new ClienteCompels(configDoAmbiente(env))
      // O Compels tem UMA OP para a OP do ShopFloor e para a sua "segunda leva" (8682 e 8682_F): o que já
      // foi enviado pela OP sem sufixo também conta no apontado que o ERP mostra.
      let acumuladoAnterior = await somaEnviada(envio.pmo, envio.op, envio.id)
      const opBase = semSufixo(envio.op)
      const pmoBase = semSufixo(envio.pmo)
      if (opBase !== envio.op.trim() || pmoBase !== envio.pmo.trim()) {
        acumuladoAnterior += await somaEnviada(pmoBase, opBase, envio.id)
      }
      // PONTO DE PARTIDA: o apontado que a OP já tinha no Compels antes da integração (guardado na primeira
      // gravação, tabela da 0168). Chave = o número da OP no Compels, que é o mesmo para 8682 e 8682_F.
      const opCompels = opBase
      const base = await baseDaOp.ler(opCompels)
      // PAGAR PENDÊNCIA (09/11/2026): só a partir da 2ª tentativa. A 1ª que bate em falta de saldo só espera (e o
      // erro fica na linha); se a seguinte ainda faltar, a integração paga a pendência do empenho e da requisição.
      const pagarPendencia =
        pagarPendenciaLigado(env) && (await erroAnterior(envio.id))?.startsWith(AGUARDANDO_REQUISICAO) === true
      const r = await enviarEntrada(
        erp,
        {
          pmo: envio.pmo,
          op: envio.op,
          quantidade: envio.quantidade,
          acumuladoAnterior,
          marca: marcaDaLinha(envio),
          base,
          guardarBase: (valor) => baseDaOp.guardar(opCompels, valor),
          pagarPendencia,
        },
        { destino },
      )
      if (r.ok) return r.aviso ? { ok: true, aviso: r.aviso } : { ok: true }
      const resultado: ResultadoEnvioEstoque = { ok: false, erro: r.erro, ...(r.aguardar ? { aguardar: true } : {}) }
      if (r.aguardar) esperando.set(envio.op, resultado)
      return resultado
    } catch (e) {
      if (e instanceof EstoqueNaoConfigurado) return { ok: false, erro: e.message, aguardar: true }
      if (e instanceof ConfiguracaoIncompleta) {
        return {
          ok: false,
          erro: `Integração com o Compels não configurada neste ambiente. ${e.message}`,
          aguardar: true,
          esperado: true,
        }
      }
      // Erro do banco ao somar, ou configuração inválida: nada foi gravado no ERP, vale esperar.
      return {
        ok: false,
        erro: `Erro ao preparar o envio ao Compels: ${e instanceof Error ? e.message : String(e)}`,
        aguardar: true,
      }
    }
  }
}
