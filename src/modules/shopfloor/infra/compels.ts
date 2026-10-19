import 'server-only'
import { enviarEntrada, type PortaErp } from '@/modules/compels/application/enviar-entrada'
import { opLiberada } from '@/modules/compels/domain/liberacao'
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { ConfiguracaoIncompleta, configDoAmbiente, destinoDoAmbiente } from '@/modules/compels/infra/config'
import type { EnvioEstoqueReservado, PortaCompels, ResultadoEnvioEstoque } from '../application/enviar-estoque'
import { criarSomaEnviada } from './estoque-envios-repository'

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
 * 5314: estoque PA, locação Padrão); COMPELS_OPS_LIBERADAS (OPs que a integração pode enviar, ou `*`;
 * VAZIA = nenhuma).
 *
 * Esperar não é falhar: tudo o que é recusado ANTES de gravar no ERP e passa sozinho (OP em uso, sem
 * empenho, pendência de material, falta de saldo, ERP fora do ar, OP ainda não liberada) volta como
 * `aguardar` e a fila não gasta tentativa. Quando uma OP já deu "espere" nesta rodada, as outras linhas
 * dela recebem a mesma resposta sem chamar o ERP de novo.
 */

const MOTIVO_ESTORNO =
  'O estorno no Compels ainda é manual: estorne o apontamento, a requisição e o empenho na tela do ERP.'

export interface DependenciasPortaCompels {
  env?: Record<string, string | undefined>
  /** Para teste: o ERP de mentira. Em produção é o `ClienteCompels`. */
  erp?: PortaErp
  /** Para teste: a soma já enviada por OP. Em produção é a função do banco (0153). */
  somaEnviada?: (pmo: string, op: string, excetoId: string) => Promise<number>
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
  const esperando = new Map<string, ResultadoEnvioEstoque>()

  return async function enviarMovimentacaoCompels(envio: EnvioEstoqueReservado): Promise<ResultadoEnvioEstoque> {
    // Estorno automático é a fase 2: por ora fica visível na tela de pendências, sem gastar tentativa.
    if (envio.operacao === 'estorno') return { ok: false, erro: MOTIVO_ESTORNO, aguardar: true }

    if (!opLiberada(envio.op, env.COMPELS_OPS_LIBERADAS)) {
      return {
        ok: false,
        erro: `OP ${envio.op} ainda não está liberada para a integração com o Compels. Faça a entrada à mão no ERP, ou libere a OP.`,
        aguardar: true,
      }
    }

    const jaEsperando = esperando.get(envio.op)
    if (jaEsperando) return jaEsperando

    try {
      erp ??= new ClienteCompels(configDoAmbiente(env))
      const destino = destinoDoAmbiente(env)
      const acumuladoAnterior = await somaEnviada(envio.pmo, envio.op, envio.id)
      const r = await enviarEntrada(
        erp,
        { pmo: envio.pmo, op: envio.op, quantidade: envio.quantidade, acumuladoAnterior, marca: marcaDaLinha(envio) },
        { destino },
      )
      if (r.ok) return { ok: true }
      const resultado: ResultadoEnvioEstoque = { ok: false, erro: r.erro, ...(r.aguardar ? { aguardar: true } : {}) }
      if (r.aguardar) esperando.set(envio.op, resultado)
      return resultado
    } catch (e) {
      if (e instanceof ConfiguracaoIncompleta) {
        return { ok: false, erro: `Integração com o Compels não configurada neste ambiente. ${e.message}`, aguardar: true }
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
