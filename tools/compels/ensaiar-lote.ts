/**
 * ENSAIO EM LOTE, SEM GRAVAR e SEM PEGAR A TRAVA: para cada OP da lista, simula a entrada de 1 peça
 * (supondo que tudo o que o Compels já mostra apontado foi enviado por nós) e diz se a integração
 * enviaria ou por que deixaria manual. Serve para medir quantas OPs a integração atende de verdade.
 *
 * Uso: node tools/compels/ensaiar-lote.mjs OP1 OP2 OP3 ...
 * Variáveis: as mesmas de `ensaiar-entrada.ts`. Nunca imprime senha, token nem corpos.
 *
 * O `.mjs` ao lado é GERADO. Para gerar de novo:
 *   npx rolldown tools/compels/ensaiar-lote.ts --file tools/compels/ensaiar-lote.mjs --format esm --platform node
 */
import { ensaiarEntrada } from '../../src/modules/compels/application/enviar-entrada'
import { estadoDaOp } from '../../src/modules/compels/domain/estado-op'
import { ClienteCompels } from '../../src/modules/compels/infra/cliente'
import { configDoAmbiente, destinoDoAmbiente } from '../../src/modules/compels/infra/config'

const ops = process.argv.slice(2)
if (ops.length === 0) {
  console.log('uso: node tools/compels/ensaiar-lote.mjs OP1 OP2 OP3 ...')
  process.exit(1)
}

const cliente = new ClienteCompels(configDoAmbiente())
const destino = destinoDoAmbiente()
const contagem = new Map<string, number>()
const somar = (chave: string) => contagem.set(chave, (contagem.get(chave) ?? 0) + 1)

for (const numero of ops) {
  try {
    const op = /^\d+$/.test(numero) ? await cliente.buscarOp(Number(numero)) : null
    if (!op) {
      console.log(`OP ${numero}: não encontrada (ou não numérica)`)
      somar('OP não encontrada ou não numérica')
      continue
    }
    const apontada = estadoDaOp(await cliente.lerOp(op)).apontada
    const plano = await ensaiarEntrada(
      cliente,
      { pmo: op.codigoItem, op: numero, quantidade: 1, acumuladoAnterior: apontada },
      { destino },
    )
    const base = `OP ${numero} | ${op.codigoItem} | ${op.unidade} | ${op.status} | ${apontada}/${op.quantidade} apontadas`
    if (plano.tipo === 'enviar') {
      console.log(`${base} | ENVIARIA (${plano.requisitar ? 'requisita e aponta' : 'só aponta'})`)
      somar('seria enviada')
    } else if (plano.tipo === 'ja_enviada') {
      console.log(`${base} | já tem a entrada`)
      somar('já tem a entrada')
    } else {
      console.log(`${base} | MANUAL: ${plano.erro}`)
      somar(plano.erro.replace(/\d+/g, 'N').slice(0, 70))
    }
  } catch (e) {
    console.log(`OP ${numero}: FALHOU (${e instanceof Error ? e.message : 'erro'})`)
    somar('falhou a leitura')
  }
}

console.log('\nRESUMO')
for (const [motivo, n] of [...contagem.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${motivo}`)
console.log(`\nTotal: ${ops.length} OPs. Só leitura: nada foi gravado e a trava não foi pega.`)
