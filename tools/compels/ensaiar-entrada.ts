/**
 * ENSAIO de uma entrada, SEM GRAVAR e SEM PEGAR A TRAVA: lê a OP no Compels, decide, consulta os
 * componentes e mostra os corpos que SERIAM enviados no Requisitar e no Apontar.
 *
 * Uso: node tools/compels/ensaiar-entrada.mjs NUMERO_DA_OP PMO QUANTIDADE [ACUMULADO_ANTERIOR]
 *   ACUMULADO_ANTERIOR = peças desta OP já enviadas antes (padrão 0).
 * Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (obrigatórias); COMPELS_EZPOINT_EMPRESA,
 *   COMPELS_EZPOINT_URL, COMPELS_API_URL, COMPELS_ESTOQUE_ID, COMPELS_LOCACAO_ID (opcionais).
 * Nunca imprime senha nem token. O custo dos componentes sai mascarado.
 *
 * O arquivo `.mjs` ao lado é GERADO a partir deste. Para gerar de novo:
 *   npx esbuild tools/compels/ensaiar-entrada.ts --bundle --platform=node --format=esm --target=node20 \
 *     --outfile=tools/compels/ensaiar-entrada.mjs
 */
import { ensaiarEntrada } from '../../src/modules/compels/application/enviar-entrada'
import { ClienteCompels } from '../../src/modules/compels/infra/cliente'
import { configDoAmbiente, destinoDoAmbiente } from '../../src/modules/compels/infra/config'

const [numeroOp, pmo, quantidadeTexto, anteriorTexto] = process.argv.slice(2)
const quantidade = Number(quantidadeTexto)
const acumuladoAnterior = Number(anteriorTexto ?? 0)

if (!numeroOp || !pmo || !(quantidade > 0) || !(acumuladoAnterior >= 0)) {
  console.log('uso: node tools/compels/ensaiar-entrada.mjs NUMERO_DA_OP PMO QUANTIDADE [ACUMULADO_ANTERIOR]')
  process.exit(1)
}

function mascarar(valor: unknown): unknown {
  return JSON.parse(JSON.stringify(valor, (chave, v) => (chave === 'precoCusto' ? '[custo]' : v)))
}

try {
  const cliente = new ClienteCompels(configDoAmbiente())
  const plano = await ensaiarEntrada(
    cliente,
    { pmo, op: numeroOp, quantidade, acumuladoAnterior },
    { destino: destinoDoAmbiente() },
  )

  if (plano.tipo === 'erro') {
    console.log(`ENSAIO: a entrada NÃO seria enviada.\nMotivo: ${plano.erro}\nTentaria de novo: ${plano.tentarDeNovo ? 'sim' : 'não'}`)
  } else if (plano.tipo === 'ja_enviada') {
    console.log('ENSAIO: o Compels já tem esta entrada; nada seria enviado.')
  } else {
    console.log(`ENSAIO: seria enviada. OP ${plano.op.numero} (id ${plano.op.id}), produto ${plano.op.codigoItem}, novo acumulado ${plano.novoAcumulado}.`)
    console.log(plano.requisitar ? '\n--- Requisitar (requisicaoOrdemProducao/save) ---' : '\n--- Requisitar: não precisa (a requisição desta entrada já existe) ---')
    if (plano.requisitar) console.log(JSON.stringify(mascarar(plano.requisitar), null, 1))
    console.log('\n--- Apontar (apontamentoOrdemProducao/save) ---')
    console.log(JSON.stringify(mascarar(plano.apontar), null, 1))
  }
  console.log('\nFIM: só leitura, nada foi gravado e a trava não foi pega.')
} catch (e) {
  console.log(`FALHOU: ${e instanceof Error ? e.message : 'erro desconhecido'}`)
  process.exit(1)
}
