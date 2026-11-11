// Mapa ShopFloor × Compels — SÓ LEITURA. Não grava nada e não pega trava.
// Lê as OPs exportadas do ShopFloor (docs/operacao/estudo-op-mae-filhas/ops-shopfloor.sql → /tmp/ops-shopfloor.csv),
// acha cada uma no Compels, sobe até a OP principal (nível 1) e desce pelas OPs seguintes da mesma família
// (no Compels as filhas são numeradas em sequência: 8681 → 8682 → 8683 → 8684). Para cada OP do Compels mostra
// produto, nível, quantidade, produzida, e COMO foi apontada (quantos apontamentos, quando, por quem, em que
// estoque); e embaixo, qual OP do ShopFloor corresponde e como ela andou.
// Nunca imprime token, senha, custo nem documentos.
//
// Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (obrigatórias);
//   COMPELS_EZPOINT_EMPRESA, COMPELS_EZPOINT_URL, COMPELS_API_URL (opcionais)
// Uso: node mapa-ops.mjs [/tmp/ops-shopfloor.csv] [--limite N]    → escreve também /tmp/mapa-ops.txt

import { readFileSync, writeFileSync } from 'node:fs'

const usuario = process.env.COMPELS_EZPOINT_USUARIO
const senha = process.env.COMPELS_EZPOINT_SENHA
const empresa = process.env.COMPELS_EZPOINT_EMPRESA || 'enterplak'
const urlEzpoint = (process.env.COMPELS_EZPOINT_URL || 'https://admin.ezpointweb.com.br/admin-ws').replace(/\/$/, '')
const urlApi = (process.env.COMPELS_API_URL || 'https://api.erpeasy.compels.net').replace(/\/$/, '')
const args = process.argv.slice(2)
const iLim = args.indexOf('--limite')
const limite = iLim >= 0 ? Number(args[iLim + 1]) : Infinity
const arquivo = args.find((a, i) => !a.startsWith('--') && (iLim < 0 || i !== iLim + 1)) || '/tmp/ops-shopfloor.csv'
const SAIDA = '/tmp/mapa-ops.txt'
const MAX_FAMILIA = 20 // OPs seguidas da mesma principal
const MAX_DETALHE = 10 // apontamentos lidos em detalhe por OP (os primeiros e os últimos)

function falha(msg) { console.log(`FALHOU: ${msg}`); process.exit(1) }
if (!usuario || !senha) falha('faltam COMPELS_EZPOINT_USUARIO e/ou COMPELS_EZPOINT_SENHA no ambiente.')

// ---------- CSV do psql (aspas duplas, vírgula) ----------
function lerCsv(texto) {
  const linhas = []
  let campo = '', linha = [], aspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++ } else if (c === '"') aspas = false
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === ',') { linha.push(campo); campo = '' }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = '' }
    else if (c !== '\r') campo += c
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha) }
  const [cab, ...resto] = linhas
  return resto.filter((l) => l.length === cab.length).map((l) => Object.fromEntries(cab.map((k, i) => [k, l[i]])))
}
let opsSf
try { opsSf = lerCsv(readFileSync(arquivo, 'utf8')) } catch { falha(`não consegui ler ${arquivo}.`) }

// ---------- Compels ----------
async function chamar(url, opcoes) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const r = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(30000) })
      let corpo = null
      try { corpo = await r.json() } catch { /* não é JSON */ }
      if (r.status >= 500 && tentativa < 2) { await new Promise((ok) => setTimeout(ok, 1000)); continue }
      return { status: r.status, corpo }
    } catch { if (tentativa === 2) return { status: 0, corpo: null } }
  }
  return { status: 0, corpo: null }
}
const login = await chamar(`${urlEzpoint}/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, senha }),
})
if (login.status !== 200 || typeof login.corpo?.token !== 'string') falha(`login do ezpointweb (HTTP ${login.status}).`)
const tk = await chamar(`${urlEzpoint}/getCompelsToken?empresa=${encodeURIComponent(empresa)}`, {
  headers: { Authorization: `Bearer ${login.corpo.token}` },
})
if (tk.status !== 200 || typeof tk.corpo?.token !== 'string') falha(`token do Compels (HTTP ${tk.status}).`)
const auth = { Authorization: `Bearer ${tk.corpo.token}` }
const api = (caminho, init = {}) => chamar(`${urlApi}${caminho}`, {
  ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}), ...auth },
})
const form = (campos) => ({
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(campos),
})
const lista = (c) => (Array.isArray(c) ? c : Array.isArray(c?.data) ? c.data : [])
const hoje = new Date()
const iso = (d) => d.toISOString().slice(0, 10) + 'T00:00:00'

const cacheOp = new Map()
/** OP do Compels pelo número: cadastro + produto. `null` = não existe. */
async function opCompels(numero) {
  if (cacheOp.has(numero)) return cacheOp.get(numero)
  const filtro = {
    numero: String(numero), codigoNegociante: null, nomeNegociante: null, cpfCnpjNegociante: null, clientePedido: '',
    item: '', linha: '', tipoPropriedade: null, statusList: null, selecionarPor: 'Data Documento',
    dataInicial: iso(new Date(hoje.getTime() - 3 * 365 * 864e5)), dataFinal: iso(hoje), numeroPedido: '', centroCusto: '',
    listarPendentes: false, prototipo: false, etapa: '', selecionarOPPor: 'op', observacao: '', nivel: '',
    responsavelCriacao: '', responsavelAlteracao: '', situacaoId: null, semVinculoComSolicitacaoInternaCompra: false,
  }
  const b = await api('/ordemProducaoSimples/findAllFilter', form({ sortFilter: 'null', filtro: JSON.stringify(filtro), page: '1', start: '0', limit: '25' }))
  const l = lista(b.corpo).find((o) => o?.numero === numero)
  let op = null
  if (l) {
    const det = await api('/ordemProducaoSimples/findById', form({ id: String(l.id), page: '1', start: '0', limit: '25' }))
    const d = det.corpo?.data ?? det.corpo ?? {}
    const item = d.composicaoProduto?.item ?? {}
    op = {
      numero, id: l.id, status: l.status, nivel: l.nivel ?? d.nivel, qtd: l.quantidade, produzida: l.quantidadeProduzida,
      mae: l.ordemProducaoMaeNumero ?? d.numeroOrdemProducaoMae ?? null,
      principal: l.ordemProducaoPrincipalNumero ?? d.numeroOrdemProducaoPrincipal ?? null,
      data: l.dataDocumento, codigo: String(item.codigo ?? '?'), descricao: String(item.descricao ?? '').slice(0, 45),
      unidade: item.unidade?.codigo ?? '?',
    }
  }
  cacheOp.set(numero, op)
  return op
}

const dia = (s) => (typeof s === 'string' ? s.slice(0, 16).replace('T', ' ') : '?')
/** Como a OP foi apontada: detalhe dos primeiros e últimos apontamentos (responsável, estoque, data). */
async function apontamentos(op) {
  const r = await api('/apontamentoOrdemProducao/findByOrdemProducaoId', form({ id: String(op.id), page: '1', start: '0', limit: '100' }))
  const linhas = lista(r.corpo)
  const escolhidos = linhas.length <= MAX_DETALHE
    ? linhas
    : [...linhas.slice(0, MAX_DETALHE / 2), ...linhas.slice(-MAX_DETALHE / 2)]
  const quem = new Map(), estoques = new Map(), datas = []
  let detalhados = 0
  for (const a of escolhidos) {
    const dA = await api('/apontamentoOrdemProducao/findById', form({ id: String(a.id), page: '1', start: '0', limit: '25' }))
    const x = dA.corpo?.data ?? dA.corpo ?? {}
    detalhados++
    const resp = String(x.responsavel ?? a.responsavel ?? '?')
    quem.set(resp, (quem.get(resp) ?? 0) + 1)
    const e = x.itemLoteEstoque?.estoque
    const est = e ? (e.codigo ? String(e.codigo) : `id ${e.id}`) : '?'
    estoques.set(est, (estoques.get(est) ?? 0) + 1)
    if (x.data ?? a.data) datas.push(String(x.data ?? a.data))
  }
  datas.sort()
  const fmt = (m) => [...m].map(([k, n]) => `${k} ${n}`).join(', ')
  return {
    n: linhas.length,
    texto: linhas.length === 0
      ? 'sem apontamento'
      : `${linhas.length} apont. ${dia(datas[0])} → ${dia(datas[datas.length - 1])}` +
        `${detalhados < linhas.length ? ` (detalhe de ${detalhados})` : ''} | por: ${fmt(quem)} | estoque: ${fmt(estoques)}`,
    integracao: [...quem.keys()].some((k) => /integra/i.test(k)),
  }
}

// ---------- montar famílias ----------
const digitos = (op) => { const m = String(op).match(/^(\d+)/); return m ? Number(m[1]) : null }
const semSufixo = (pmo) => String(pmo).replace(/_[A-Za-z]*$/, '').toUpperCase()
const sfPorNumero = new Map()
const naoNumericas = []
for (const o of opsSf) {
  const n = digitos(o.op)
  if (n === null) { naoNumericas.push(o); continue }
  if (!sfPorNumero.has(n)) sfPorNumero.set(n, [])
  sfPorNumero.get(n).push(o)
}

const out = []
const log = (s = '') => { out.push(s); console.log(s) }
const vistos = new Set()
const familias = []
const naoAchadas = []
let feitas = 0
for (const n of [...sfPorNumero.keys()].sort((a, b) => a - b)) {
  if (vistos.has(n)) continue
  if (feitas >= limite) break
  const op = await opCompels(n)
  if (!op) { naoAchadas.push(n); vistos.add(n); continue }
  const principal = op.principal ?? op.numero
  const raiz = (await opCompels(principal)) ?? op
  const membros = [raiz]
  for (let k = raiz.numero + 1, i = 0; i < MAX_FAMILIA; k++, i++) {
    const f = await opCompels(k)
    if (!f || (f.principal ?? f.numero) !== raiz.numero) break
    membros.push(f)
  }
  if (!membros.some((m) => m.numero === op.numero)) membros.push(op) // fora da sequência: ainda assim mostra
  membros.forEach((m) => vistos.add(m.numero))
  familias.push(membros)
  feitas++
}

const resumo = { familias: familias.length, opsCompels: 0, comIntegracao: 0, semShopfloor: 0, codigoDiferente: [] }
for (const membros of familias) {
  log(`\n### Família ${membros[0].numero} (${membros.length} OP${membros.length > 1 ? 's' : ''} no Compels)`)
  for (const m of membros) {
    resumo.opsCompels++
    const ap = await apontamentos(m)
    if (ap.integracao) resumo.comIntegracao++
    const recuo = '  '.repeat(Math.max(0, (m.nivel ?? 1) - 1))
    log(`${recuo}N${m.nivel ?? '?'} ${m.numero} ${m.codigo} ${m.descricao} | ${m.status} | qtd ${m.qtd} produzida ${m.produzida} ${m.unidade}` +
      `${m.mae ? ` | mãe ${m.mae}` : ''} | doc ${m.data ?? '?'}`)
    log(`${recuo}   Compels: ${ap.texto}`)
    const sf = sfPorNumero.get(m.numero) ?? []
    if (sf.length === 0) { log(`${recuo}   ShopFloor: — (não existe OP ${m.numero})`); resumo.semShopfloor++ }
    for (const s of sf) {
      const casa = semSufixo(s.pmo) === m.codigo.toUpperCase()
      // Número diferente, mesmo código em outra OP da família (ex.: ShopFloor 8683/PRT705 = Compels 8684/PRT705).
      const outra = casa ? null : membros.find((x) => x.codigo.toUpperCase() === semSufixo(s.pmo))
      const marca = casa ? '✓código' : `✗código (Compels ${m.codigo}${outra ? `; o código casa com a OP ${outra.numero}` : ''})`
      if (!casa) resumo.codigoDiferente.push(`${s.op}/${s.pmo} × Compels ${m.numero}/${m.codigo}${outra ? ` (casa com ${outra.numero})` : ''}`)
      log(`${recuo}   ShopFloor ${s.op}/${s.pmo} ${marca} ${s.status} qtd ${s.qtd} | ` +
        `rota ${s.rota || '-'} | último posto ${s.ultimo_posto || '-'}: ${s.pecas_ultimo_posto} peças | bipes ${s.primeiro_bipe} → ${s.ultimo_bipe}` +
        `${Number(s.almox_enviadas) ? ` | almox→Compels ${s.almox_enviadas}` : ''}${s.integrar_compels === 't' ? ' | integrar_compels' : ''}`)
    }
  }
}

log('\n### ShopFloor sem OP correspondente no Compels')
log(naoAchadas.length ? naoAchadas.map((n) => (sfPorNumero.get(n) ?? []).map((s) => `${s.op}/${s.pmo}`).join(' ')).join(' · ') : '(nenhuma)')
log('\n### ShopFloor com OP não numérica (não consultadas)')
log(naoNumericas.length ? naoNumericas.map((s) => `${s.op}/${s.pmo}`).join(' · ') : '(nenhuma)')
log('\n### Resumo')
log(`OPs do ShopFloor lidas: ${opsSf.length} | famílias no Compels: ${resumo.familias} | OPs do Compels nelas: ${resumo.opsCompels}`)
log(`OPs do Compels com algum apontamento da integração: ${resumo.comIntegracao} | sem OP no ShopFloor: ${resumo.semShopfloor}`)
log(`Código do produto diferente entre ShopFloor e Compels (mesmo número): ${resumo.codigoDiferente.length}`)
for (const c of resumo.codigoDiferente) log(`   ${c}`)
if (Number.isFinite(limite)) log(`(parado em ${limite} família(s) por --limite)`)
writeFileSync(SAIDA, out.join('\n') + '\n')
console.log(`\nFIM: só leitura, nada foi gravado. Saída também em ${SAIDA}`)
