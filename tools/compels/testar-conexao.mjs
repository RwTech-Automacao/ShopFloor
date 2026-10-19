// Teste de conexão com o Compels. SÓ LEITURA: faz login, pede o token do Compels e consulta o saldo
// de UM item. Nunca imprime senha, token nem corpo de resposta: só códigos HTTP, a validade do token
// e o saldo do item pedido.
//
// Variáveis (no ambiente; nunca no código):
//   COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA   login do ezpointweb
//   COMPELS_EZPOINT_EMPRESA                          padrão: enterplak
//   COMPELS_EZPOINT_URL                              padrão: https://admin.ezpointweb.com.br/admin-ws
//   COMPELS_API_URL                                  padrão: https://api.erpeasy.compels.net
// Uso: node tools/compels/testar-conexao.mjs [CODIGO_DO_ITEM]   (padrão: PRT446)

const usuario = process.env.COMPELS_EZPOINT_USUARIO
const senha = process.env.COMPELS_EZPOINT_SENHA
const empresa = process.env.COMPELS_EZPOINT_EMPRESA || 'enterplak'
const urlEzpoint = (process.env.COMPELS_EZPOINT_URL || 'https://admin.ezpointweb.com.br/admin-ws').replace(/\/$/, '')
const urlApi = (process.env.COMPELS_API_URL || 'https://api.erpeasy.compels.net').replace(/\/$/, '')
const codigo = (process.argv[2] || 'PRT446').trim()

function falha(msg) {
  console.log(`FALHOU: ${msg}`)
  process.exit(1)
}

if (!usuario || !senha) falha('faltam COMPELS_EZPOINT_USUARIO e/ou COMPELS_EZPOINT_SENHA no ambiente.')

async function chamar(rotulo, url, opcoes) {
  let r
  try {
    r = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(30000) })
  } catch (e) {
    falha(`${rotulo}: sem conexão (${e instanceof Error ? e.name : 'erro'}).`)
  }
  console.log(`${rotulo}: HTTP ${r.status}`)
  let corpo = null
  try { corpo = await r.json() } catch { /* corpo não é JSON */ }
  return { status: r.status, corpo }
}

function minutosDeValidade(jwt) {
  try {
    const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))
    return typeof p.exp === 'number' ? Math.round((p.exp * 1000 - Date.now()) / 60000) : null
  } catch { return null }
}

// 1) login no ezpointweb
const login = await chamar('1. login ezpointweb', `${urlEzpoint}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ usuario, senha }),
})
const tokenEzpoint = login.corpo?.token
if (login.status !== 200 || typeof tokenEzpoint !== 'string') falha('login do ezpointweb não devolveu token.')

// 2) token do Compels
const tk = await chamar('2. token do Compels', `${urlEzpoint}/getCompelsToken?empresa=${encodeURIComponent(empresa)}`, {
  headers: { Authorization: `Bearer ${tokenEzpoint}` },
})
const tokenCompels = tk.corpo?.token
if (tk.status !== 200 || typeof tokenCompels !== 'string') falha('não veio token do Compels.')
const min = minutosDeValidade(tokenCompels)
console.log(min === null ? '   validade do token: não consegui ler' : `   validade do token: ~${min} min`)

const auth = { Authorization: `Bearer ${tokenCompels}` }

// 3) API pública (/v1): leitura mínima
await chamar('3. API pública /v1 (leitura)', `${urlApi}/v1/negociante?page=0&size=1`, { headers: auth })

// 4) API interna da tela: saldo de um item (é a que a integração vai usar)
const filtro = JSON.stringify({ codigo, descricao: '', data: new Date().toISOString().slice(0, 10) + 'T00:00:00', exibeItensComSaldoZerado: true })
const saldo = await chamar('4. API interna: saldo do item', `${urlApi}/itemMovimento/findFilter`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ filter: filtro, page: '1', start: '0', limit: '50' }),
})
if (saldo.status === 200) {
  const lista = Array.isArray(saldo.corpo?.data) ? saldo.corpo.data : []
  const linha = lista.find((l) => String(l?.item?.codigo ?? '').trim().toUpperCase() === codigo.toUpperCase())
  console.log(linha
    ? `   ${codigo}: saldo em estoque próprio = ${linha.saldoItemEstoqueProprio}`
    : `   ${codigo}: item não veio na resposta`)
}
console.log(saldo.status === 200 ? 'RESULTADO: o token funciona na API interna (leitura).' : 'RESULTADO: o token NÃO funcionou na API interna; ver os códigos acima.')
