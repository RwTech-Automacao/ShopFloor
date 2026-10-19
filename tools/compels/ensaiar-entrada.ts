/**
 * ENSAIO de uma entrada, SEM GRAVAR e SEM PEGAR A TRAVA: lê a OP no Compels, decide, consulta os
 * componentes e mostra os corpos que SERIAM enviados no Requisitar e no Apontar.
 *
 * Uso: node tools/compels/ensaiar-entrada.mjs NUMERO_DA_OP PMO QUANTIDADE [ACUMULADO_ANTERIOR]
 *   PMO = o código do produto, ou `-` para usar o que o Compels mostra na OP (a PMO é impressa).
 *   ACUMULADO_ANTERIOR = peças desta OP já enviadas antes (padrão 0), ou `auto` para assumir que tudo
 *   o que o Compels já mostra apontado foi enviado por nós (a quantidade apontada é impressa).
 * Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (obrigatórias); COMPELS_EZPOINT_EMPRESA,
 *   COMPELS_EZPOINT_URL, COMPELS_API_URL, COMPELS_ESTOQUE_ID, COMPELS_LOCACAO_ID (opcionais).
 * Nunca imprime senha nem token. O custo dos componentes sai mascarado.
 *
 * O arquivo `.mjs` ao lado é GERADO a partir deste. Para gerar de novo:
 *   npx esbuild tools/compels/ensaiar-entrada.ts --bundle --platform=node --format=esm --target=node20 \
 *     --outfile=tools/compels/ensaiar-entrada.mjs
 */
import { estadoDaOp } from '../../src/modules/compels/domain/estado-op'
import { ensaiarEntrada } from '../../src/modules/compels/application/enviar-entrada'
import { ClienteCompels } from '../../src/modules/compels/infra/cliente'
import { configDoAmbiente, destinoDoAmbiente } from '../../src/modules/compels/infra/config'

const [numeroOp, pmo, quantidadeTexto, anteriorTexto] = process.argv.slice(2)
const quantidade = Number(quantidadeTexto)
const automatico = anteriorTexto === 'auto'
let acumuladoAnterior = automatico ? 0 : Number(anteriorTexto ?? 0)

if (!numeroOp || !pmo || !(quantidade > 0) || !(acumuladoAnterior >= 0)) {
  console.log('uso: node tools/compels/ensaiar-entrada.mjs NUMERO_DA_OP PMO QUANTIDADE [ACUMULADO_ANTERIOR]')
  process.exit(1)
}

function mascarar(valor: unknown): unknown {
  return JSON.parse(JSON.stringify(valor, (chave, v) => (chave === 'precoCusto' ? '[custo]' : v)))
}

try {
  const cliente = new ClienteCompels(configDoAmbiente())
  let pmoUsada = pmo
  if (pmo === '-' || automatico) {
    const op = /^\d+$/.test(numeroOp) ? await cliente.buscarOp(Number(numeroOp)) : null
    if (!op) throw new Error(`OP ${numeroOp} não encontrada no Compels.`)
    if (pmo === '-') {
      pmoUsada = op.codigoItem
      console.log(`PMO usada (lida do Compels): ${pmoUsada}`)
    }
    if (automatico) {
      acumuladoAnterior = estadoDaOp(await cliente.lerOp(op)).apontada
      console.log(`Acumulado anterior assumido (apontado no Compels): ${acumuladoAnterior}`)
    }
  }
  const plano = await ensaiarEntrada(
    cliente,
    { pmo: pmoUsada, op: numeroOp, quantidade, acumuladoAnterior },
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
