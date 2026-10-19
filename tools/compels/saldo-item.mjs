// Saldo de estoque de UM item (a PMO) no Compels. SÓ LEITURA: login, token e uma consulta de Movimento de Item.
// Nunca imprime senha nem token. Com --json imprime uma linha JSON no fim (para colar de volta ou alimentar uma tela).
//
// Variáveis (no ambiente; nunca no código): COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA;
//   opcionais: COMPELS_EZPOINT_EMPRESA (padrão enterplak), COMPELS_EZPOINT_URL, COMPELS_API_URL.
// Uso: node tools/compels/saldo-item.mjs CODIGO_DO_ITEM [--json]      (ex.: PRT446)
//
// O saldo "próprio" é o de TODOS os estoques do item (a quebra por estoque/locação ainda não foi mapeada).

const usuario = process.env.COMPELS_EZPOINT_USUARIO
const senha = process.env.COMPELS_EZPOINT_SENHA
const empresa = process.env.COMPELS_EZPOINT_EMPRESA || 'enterplak'
const urlEzpoint = (process.env.COMPELS_EZPOINT_URL || 'https://admin.ezpointweb.com.br/admin-ws').replace(/\/$/, '')
const urlApi = (process.env.COMPELS_API_URL || 'https://api.erpeasy.compels.net').replace(/\/$/, '')
const args = process.argv.slice(2)
const comJson = args.includes('--json')
const codigo = (args.find((a) => !a.startsWith('--')) || '').trim()

function falha(msg) { console.log(`FALHOU: ${msg}`); process.exit(1) }
if (!usuario || !senha) falha('faltam COMPELS_EZPOINT_USUARIO e/ou COMPELS_EZPOINT_SENHA no ambiente.')
if (!codigo) falha('uso: node tools/compels/saldo-item.mjs CODIGO_DO_ITEM [--json]')

async function chamar(rotulo, url, opcoes) {
  let r
  try { r = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(30000) }) } catch { falha(`${rotulo}: sem conexão.`) }
  let corpo = null
  try { corpo = await r.json() } catch { /* não é JSON */ }
  return { status: r.status, corpo }
}

const login = await chamar('login ezpointweb', `${urlEzpoint}/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, senha }),
})
if (login.status !== 200 || typeof login.corpo?.token !== 'string') falha(`login do ezpointweb (HTTP ${login.status}).`)
const tk = await chamar('token do Compels', `${urlEzpoint}/getCompelsToken?empresa=${encodeURIComponent(empresa)}`, {
  headers: { Authorization: `Bearer ${login.corpo.token}` },
})
if (tk.status !== 200 || typeof tk.corpo?.token !== 'string') falha(`token do Compels (HTTP ${tk.status}).`)

const filtro = JSON.stringify({ codigo, descricao: '', data: new Date().toISOString().slice(0, 10) + 'T00:00:00', exibeItensComSaldoZerado: true })
const r = await chamar('saldo do item', `${urlApi}/itemMovimento/findFilter`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tk.corpo.token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ filter: filtro, page: '1', start: '0', limit: '50' }),
})
if (r.status !== 200) falha(`consulta de saldo (HTTP ${r.status}).`)

const lista = Array.isArray(r.corpo?.data) ? r.corpo.data : []
const linha = lista.find((l) => String(l?.item?.codigo ?? '').trim().toUpperCase() === codigo.toUpperCase())
if (!linha) {
  console.log(`ITEM ${codigo}: não encontrado no Compels (código exato).`)
  if (comJson) console.log(JSON.stringify({ codigo, encontrado: false }))
  process.exit(2)
}
const saldo = {
  codigo: String(linha.item.codigo).trim(),
  descricao: String(linha.item.descricao ?? '').trim(),
  unidade: String(linha.item.unidade?.codigo ?? ''),
  proprio: linha.saldoItemEstoqueProprio,
  pendencia: linha.saldoItemPendencia,
  emTerceiros: linha.saldoItemEstoqueEmTerceiros,
  deTerceiros: linha.saldoItemEstoqueDeTerceiros,
  consultadoEm: new Date().toISOString(),
}
console.log(`ITEM ${saldo.codigo} — ${saldo.descricao} (${saldo.unidade})`)
console.log(`  estoque próprio (todos os estoques): ${saldo.proprio}`)
console.log(`  em pendência: ${saldo.pendencia} · em terceiros: ${saldo.emTerceiros} · de terceiros: ${saldo.deTerceiros}`)
if (comJson) console.log(JSON.stringify({ ...saldo, encontrado: true }))
