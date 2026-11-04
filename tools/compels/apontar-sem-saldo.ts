/**
 * TESTE: o Compels aceita APONTAR quando falta saldo de componente? Faz só o apontamento (não requisita), para uma
 * OP cuja requisição desta quantidade JÁ EXISTE (mesmo Pendente). Mostra o que o Compels diz por componente e
 * devolve a resposta dele, sem interpretar.
 *
 * Uso: node tools/compels/apontar-sem-saldo.mjs NUMERO_DA_OP QUANTIDADE [--confirmo-gravar]
 *   Sem a flag: só LÊ e mostra o que enviaria (não pega a trava, não grava).
 *   Com a flag: GRAVA o apontamento (de 1 a 100 peças), com a trava da OP, e relê o estado.
 * Variáveis: as mesmas de `ensaiar-entrada.ts`. Nunca imprime senha nem token.
 * Se gravar, o apontamento fica na OP: ESTORNE na tela se não for para ficar (apontamento primeiro).
 *
 * O `.mjs` ao lado é GERADO. Para gerar de novo:
 *   npx rolldown tools/compels/apontar-sem-saldo.ts --file tools/compels/apontar-sem-saldo.mjs --format esm --platform node
 */
import { corpoApontamento, dataHoraLocal, inicioDoDia } from '../../src/modules/compels/domain/corpos'
import { estadoDaOp } from '../../src/modules/compels/domain/estado-op'
import { ClienteCompels } from '../../src/modules/compels/infra/cliente'
import { configDoAmbiente, destinoDoAmbiente } from '../../src/modules/compels/infra/config'

const TETO_DO_TESTE = 100
const args = process.argv.slice(2)
const confirmou = args.includes('--confirmo-gravar')
const [numeroOp, quantidadeTexto] = args.filter((a) => !a.startsWith('--'))
const quantidade = Number(quantidadeTexto)

if (!numeroOp || !quantidadeTexto || !/^\d+$/.test(numeroOp) || !(quantidade > 0) || quantidade > TETO_DO_TESTE) {
  console.log(`uso: node tools/compels/apontar-sem-saldo.mjs NUMERO_DA_OP QUANTIDADE(1 a ${TETO_DO_TESTE}) [--confirmo-gravar]`)
  process.exit(1)
}

try {
  const cliente = new ClienteCompels(configDoAmbiente())
  const op = await cliente.buscarOp(Number(numeroOp))
  if (!op) throw new Error(`OP ${numeroOp} não encontrada no Compels.`)

  const antes = estadoDaOp(await cliente.lerOp(op))
  console.log(`OP ${op.numero} (${op.codigoItem}): ${antes.empenhada} empenhadas, ${antes.requisitada} requisitadas, ${antes.apontada} apontadas. Requisição pendente: ${antes.temPendencia ? 'sim' : 'não'}.`)
  const requisitadaSemApontar = Math.round((antes.requisitada - antes.apontada) * 1e6) / 1e6
  if (requisitadaSemApontar < quantidade) {
    console.log(`NÃO FEITO: só há ${requisitadaSemApontar} requisitada(s) ainda sem apontar; para apontar ${quantidade} a requisição dessa quantidade precisa existir (mesmo Pendente).`)
    process.exit(2)
  }

  const componentes = await cliente.consultarDisponibilidade(op, quantidade)
  console.log('\nDisponibilidade por componente (o que a tela do Compels consulta antes de apontar):')
  for (const c of componentes) {
    const falta = !c.itemFantasma && c.saldoDisponivel < c.quantidadeUtilizada
    console.log(`  ${c.codigo}: precisa ${c.quantidadeUtilizada}, disponível ${c.saldoDisponivel}${falta ? '   <-- SEM SALDO' : ''}`)
  }

  if (!confirmou) {
    console.log('\nNADA FOI GRAVADO: falta --confirmo-gravar. Acima está o que o Compels diz de disponibilidade.')
    process.exit(0)
  }

  const agora = new Date()
  const corpo = corpoApontamento({
    opId: op.id,
    produtoId: op.produtoId,
    quantidade,
    dataInicio: antes.inicioApontamento ?? inicioDoDia(agora),
    dataFim: dataHoraLocal(agora),
    componentes,
    destino: destinoDoAmbiente(),
    observacao: 'ShopFloor teste: apontar sem saldo',
  })

  const trava = await cliente.adquirirTrava(op.id)
  if (!trava.ok) {
    console.log(`\nNÃO FEITO: não consegui a trava da OP. ${trava.mensagem}`)
    process.exit(2)
  }
  try {
    console.log(`\nGravando o apontamento de ${quantidade}...`)
    const r = await cliente.apontar(corpo)
    console.log(r.ok ? `\nRESULTADO: O COMPELS ACEITOU. ${r.mensagem}` : `\nRESULTADO: O COMPELS RECUSOU (${r.codigo}). ${r.mensagem}`)
  } finally {
    try { await cliente.liberarTrava(op.id) } catch { /* a trava expira sozinha */ }
  }
  const depois = estadoDaOp(await cliente.lerOp(op))
  console.log(`Depois: ${depois.empenhada} empenhadas, ${depois.requisitada} requisitadas, ${depois.apontada} apontadas.`)
} catch (e) {
  console.log(`FALHOU: ${e instanceof Error ? e.message : 'erro desconhecido'}`)
  process.exit(1)
}
