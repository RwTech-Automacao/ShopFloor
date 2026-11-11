// Saldo de itens POR ESTOQUE no Compels — SÓ LEITURA. Confere a consulta que o card Finalizadas passou a usar
// (`GET /estoque/consultaSaldoItemEstoque`, com descrição vazia) e mostra quanto entra como disponível (PA + EINTER).
// Não imprime token nem senha.
//
// Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (obrigatórias);
//   COMPELS_EZPOINT_EMPRESA, COMPELS_EZPOINT_URL, COMPELS_API_URL (opcionais)
// Uso: node tools/compels/saldo-por-estoque.mjs PMOC31 PMOF52

const usuario = process.env.COMPELS_EZPOINT_USUARIO
const senha = process.env.COMPELS_EZPOINT_SENHA
const empresa = process.env.COMPELS_EZPOINT_EMPRESA || 'enterplak'
const urlEzpoint = (process.env.COMPELS_EZPOINT_URL || 'https://admin.ezpointweb.com.br/admin-ws').replace(/\/$/, '')
const urlApi = (process.env.COMPELS_API_URL || 'https://api.erpeasy.compels.net').replace(/\/$/, '')
const codigos = process.argv.slice(2)
const ACEITOS = ['PA', 'EINTER']

function falha(msg) { console.log(`FALHOU: ${msg}`); process.exit(1) }
if (!usuario || !senha) falha('faltam COMPELS_EZPOINT_USUARIO e/ou COMPELS_EZPOINT_SENHA no ambiente.')
if (codigos.length === 0) falha('uso: node saldo-por-estoque.mjs PMO1 PMO2 ...')

async function chamar(url, opcoes) {
  try {
    const r = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(30000) })
    let corpo = null
    try { corpo = await r.json() } catch { /* não é JSON */ }
    return { status: r.status, corpo }
  } catch { return { status: 0, corpo: null } }
}

const login = await chamar(`${urlEzpoint}/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, senha }),
})
if (login.status !== 200 || typeof login.corpo?.token !== 'string') falha(`login do ezpointweb (HTTP ${login.status}).`)
const tk = await chamar(`${urlEzpoint}/getCompelsToken?empresa=${encodeURIComponent(empresa)}`, {
  headers: { Authorization: `Bearer ${login.corpo.token}` },
})
if (tk.status !== 200 || typeof tk.corpo?.token !== 'string') falha(`token do Compels (HTTP ${tk.status}).`)

const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date())
for (const codigo of codigos) {
  const params = new URLSearchParams({
    codigoItem: codigo, descricaoItem: '', data, exibeItensComSaldoZerado: 'false', estoque: '', offset: '0', limit: '50',
  })
  const r = await chamar(`${urlApi}/estoque/consultaSaldoItemEstoque?${params}`, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${tk.corpo.token}` },
  })
  const linhas = Array.isArray(r.corpo?.results) ? r.corpo.results : null
  console.log(`\n## ${codigo}: HTTP ${r.status}${linhas ? `, ${linhas.length} linha(s)` : ', resposta sem results'}`)
  if (!linhas) continue
  let disponivel = 0
  for (const l of linhas) {
    const exato = String(l?.item?.codigo ?? '').toUpperCase() === codigo.toUpperCase()
    const est = String(l?.estoque?.codigo ?? '?')
    const conta = exato && ACEITOS.includes(est.toUpperCase())
    if (conta) disponivel += Number(l.saldo) || 0
    console.log(`   ${String(l?.item?.codigo).padEnd(10)} ${est.padEnd(8)} ${String(l?.saldo).padStart(8)}  ${conta ? 'CONTA' : ''}${exato ? '' : '(outro item)'}`)
  }
  console.log(`   disponível (PA + EINTER): ${disponivel}`)
}
console.log('\nFIM: só leitura.')
