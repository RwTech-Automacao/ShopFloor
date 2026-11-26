/**
 * CONFERÊNCIA (SÓ LEITURA) das leituras do Compels que a manutenção do SAT usa (plano 2026-11-26, Tarefa 7):
 *   1. composicaoProduto/findByCodigoItem → id da composição do PRODUTO;
 *   2. findComposicaoByIdEntireTree → a árvore; imprime as chaves do 1º nó cru e a camada 3 (peças trocáveis);
 *   3. --pais: findParentsByItemId dos 5 primeiros trocáveis que têm item.id, e os PMOE* entre os pais;
 *   4. --busca TERMO: itemMovimento/findFilter com o termo (confere se a busca é PARCIAL: "fonte" acha "FONTE 12V").
 * Nunca grava nada, nunca imprime senha nem token.
 *
 * Uso: node tools/compels/sat-estrutura.mjs PRODUTO [--pais] [--busca TERMO]      (ex.: PMOC31 --pais --busca fonte)
 * Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (opcionais: COMPELS_EZPOINT_EMPRESA, COMPELS_EZPOINT_URL,
 * COMPELS_API_URL) — as mesmas do .env.production.
 *
 * O `.mjs` ao lado é GERADO. Para gerar de novo:
 *   npx rolldown tools/compels/sat-estrutura.ts --file tools/compels/sat-estrutura.mjs --format esm --platform node
 */
import { ClienteCompels } from '../../src/modules/compels/infra/cliente'
import { configDoAmbiente } from '../../src/modules/compels/infra/config'
import {
  arvoreDaResposta, filtroBuscaItem, idDaComposicao, itensDaBusca, paisDaResposta, pecasTrocaveis,
} from '../../src/modules/sat/domain/estrutura'

const args = process.argv.slice(2)
const produto = (args.find((a) => !a.startsWith('--')) ?? '').trim().toUpperCase()
const comPais = args.includes('--pais')
const iBusca = args.indexOf('--busca')
const termo = iBusca >= 0 ? (args[iBusca + 1] ?? '').trim() : ''

if (!produto) {
  console.log('uso: node tools/compels/sat-estrutura.mjs PRODUTO [--pais] [--busca TERMO]')
  process.exit(1)
}

const cliente = new ClienteCompels(configDoAmbiente())

const cru = await cliente.composicaoDoItem(produto)
console.log(`findByCodigoItem(${produto}): chaves do topo = ${Object.keys((cru ?? {}) as object).join(', ')}`)
const id = idDaComposicao(cru)
if (id === null) {
  console.log('  → sem id de composição (o produto não tem estrutura OU o formato é outro). Resposta crua (1.000 caracteres):')
  console.log(JSON.stringify(cru).slice(0, 1000))
  process.exit(2)
}
console.log(`  → id da composição: ${id}`)

const arvoreCrua = await cliente.arvoreDaComposicao(id)
const filhos = (arvoreCrua as { children?: unknown[] } | null)?.children ?? []
console.log(`findComposicaoByIdEntireTree(${id}): ${filhos.length} nó(s) na raiz; chaves do 1º nó = ${Object.keys((filhos[0] ?? {}) as object).join(', ')}`)
console.log(`  chaves do item do 1º nó = ${Object.keys(((filhos[0] as { item?: object } | undefined)?.item ?? {}) as object).join(', ')}`)
const arvore = arvoreDaResposta(arvoreCrua, produto)
const trocaveis = pecasTrocaveis(arvore)
console.log(`Camada 3 (peças trocáveis): ${trocaveis.length}`)
for (const n of trocaveis) console.log(`  ${n.codigo.padEnd(12)} ${n.descricao}  (item.id ${n.itemId ?? '—'}, ${n.filhos.length} filho(s))`)
console.log('1º nível inteiro (para conferir a regra):')
for (const n of arvore) console.log(`  ${n.codigo.padEnd(12)} ${n.descricao}  (${n.filhos.length} filho(s))`)

if (comPais) {
  for (const n of trocaveis.filter((t) => t.itemId !== null).slice(0, 5)) {
    const pais = paisDaResposta(await cliente.paisDoItem(n.itemId!))
    const kits = pais.filter((p) => p.codigo.startsWith('PMOE'))
    console.log(`pais de ${n.codigo}: ${pais.length} (PMOE*: ${kits.map((k) => k.codigo).join(', ') || 'nenhum'})`)
  }
}

if (termo) {
  const hoje = new Date().toISOString().slice(0, 10) + 'T00:00:00'
  const itens = itensDaBusca(await cliente.buscarItens(filtroBuscaItem(termo, hoje)), 10)
  console.log(`busca "${termo}": ${itens.length} item(ns)`)
  for (const i of itens) console.log(`  ${i.codigo.padEnd(12)} ${i.descricao}`)
}
