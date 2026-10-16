/**
 * GRAVA DE VERDADE no Compels uma entrada de TESTE (Requisitar + Apontar), com a trava da OP.
 * Ferramenta só para os primeiros testes: limitada a 100 peças e exige `--confirmo-gravar`.
 * Rode ANTES o ensaio (`ensaiar-entrada.mjs`) e confira os corpos.
 *
 * Uso: node tools/compels/enviar-entrada.mjs NUMERO_DA_OP PMO QUANTIDADE ACUMULADO_ANTERIOR --confirmo-gravar
 *   PMO = código do produto, ou `-` para usar o que o Compels mostra na OP.
 *   ACUMULADO_ANTERIOR = peças já enviadas antes, ou `auto` (o que o Compels já mostra apontado).
 * Variáveis: as mesmas de `ensaiar-entrada.ts`. Nunca imprime senha, token nem corpos.
 * Depois do teste, ESTORNE na tela, nesta ordem: apontamento, requisição, empenho.
 *
 * O `.mjs` ao lado é GERADO. Para gerar de novo:
 *   npx rolldown tools/compels/enviar-entrada.ts --file tools/compels/enviar-entrada.mjs --format esm --platform node
 */
import { enviarEntrada } from '../../src/modules/compels/application/enviar-entrada'
import { estadoDaOp } from '../../src/modules/compels/domain/estado-op'
import { ClienteCompels } from '../../src/modules/compels/infra/cliente'
import { configDoAmbiente, destinoDoAmbiente } from '../../src/modules/compels/infra/config'

const TETO_DO_TESTE = 100
const args = process.argv.slice(2)
const confirmou = args.includes('--confirmo-gravar')
const [numeroOp, pmo, quantidadeTexto, anteriorTexto] = args.filter((a) => !a.startsWith('--'))
const quantidade = Number(quantidadeTexto)

if (!numeroOp || !pmo || !quantidadeTexto || !anteriorTexto) {
  console.log('uso: node tools/compels/enviar-entrada.mjs NUMERO_DA_OP PMO QUANTIDADE ACUMULADO_ANTERIOR --confirmo-gravar')
  process.exit(1)
}
if (!(quantidade > 0) || quantidade > TETO_DO_TESTE) {
  console.log(`RECUSADO: esta ferramenta de teste só grava de 1 a ${TETO_DO_TESTE} peças.`)
  process.exit(1)
}
if (!confirmou) {
  console.log('NADA FOI FEITO: falta --confirmo-gravar. Rode antes o ensaio (ensaiar-entrada.mjs) e confira os corpos.')
  process.exit(1)
}

try {
  const cliente = new ClienteCompels(configDoAmbiente())
  const op = /^\d+$/.test(numeroOp) ? await cliente.buscarOp(Number(numeroOp)) : null
  if (!op) throw new Error(`OP ${numeroOp} não encontrada no Compels.`)

  const pmoUsada = pmo === '-' ? op.codigoItem : pmo
  const antes = estadoDaOp(await cliente.lerOp(op))
  const acumuladoAnterior = anteriorTexto === 'auto' ? antes.apontada : Number(anteriorTexto)
  if (!(acumuladoAnterior >= 0)) throw new Error('ACUMULADO_ANTERIOR inválido.')
  console.log(`OP ${op.numero} (${op.codigoItem}), antes: ${antes.empenhada} empenhadas, ${antes.requisitada} requisitadas, ${antes.apontada} apontadas.`)
  console.log(`Gravando ${quantidade} peça(s) (acumulado anterior ${acumuladoAnterior})...`)

  const resultado = await enviarEntrada(
    cliente,
    { pmo: pmoUsada, op: numeroOp, quantidade, acumuladoAnterior, marca: 'ShopFloor teste de integracao' },
    { destino: destinoDoAmbiente() },
  )

  if (resultado.ok) {
    const depois = estadoDaOp(await cliente.lerOp(op))
    console.log(`\nRESULTADO: OK. ${resultado.detalhe}`)
    console.log(`Depois: ${depois.empenhada} empenhadas, ${depois.requisitada} requisitadas, ${depois.apontada} apontadas.`)
    console.log('\nAGORA ESTORNE na tela: 1) apontamento, 2) requisição, 3) empenho.')
  } else {
    console.log(`\nRESULTADO: NÃO ENVIADO.\nMotivo: ${resultado.erro}\nTentaria de novo: ${resultado.tentarDeNovo ? 'sim' : 'não'}`)
    process.exit(2)
  }
} catch (e) {
  console.log(`FALHOU: ${e instanceof Error ? e.message : 'erro desconhecido'}`)
  process.exit(1)
}
