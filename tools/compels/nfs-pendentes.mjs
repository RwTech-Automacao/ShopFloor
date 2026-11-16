// Notas de SAÍDA pendentes de baixa no Compels — SÓ LEITURA (sonda para a automação de baixa).
// Chama só as consultas da tela "Baixa de Mercadoria": a lista (notaICMS/findFilterStockMoves) e os itens de
// UMA nota pendente (itemBaixaMercadoria/findAllEstoqueProprioByNotaICMSId). NUNCA chama baixaMercadoria/baixar
// nem desfazerBaixa. Não imprime token nem senha.
//
// Os nomes dos filtros da lista vieram do JS público da tela (sem HAR ainda); por isso a sonda tenta algumas
// formas e diz qual respondeu. Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (obrigatórias);
//   COMPELS_EZPOINT_EMPRESA, COMPELS_EZPOINT_URL, COMPELS_API_URL (opcionais)
// Uso: node nfs-pendentes.mjs [dias=30]

const usuario = process.env.COMPELS_EZPOINT_USUARIO
const senha = process.env.COMPELS_EZPOINT_SENHA
const empresa = process.env.COMPELS_EZPOINT_EMPRESA || 'enterplak'
const urlEzpoint = (process.env.COMPELS_EZPOINT_URL || 'https://admin.ezpointweb.com.br/admin-ws').replace(/\/$/, '')
const urlApi = (process.env.COMPELS_API_URL || 'https://api.erpeasy.compels.net').replace(/\/$/, '')
const dias = Number(process.argv[2] || 30)

const PROIBIDO = /baixar|desfazer|save|estornar|pagar/i
function falha(msg) { console.log(`FALHOU: ${msg}`); process.exit(1) }
if (!usuario || !senha) falha('faltam COMPELS_EZPOINT_USUARIO e/ou COMPELS_EZPOINT_SENHA no ambiente.')

async function chamar(url, opcoes = {}) {
  if (PROIBIDO.test(new URL(url).pathname)) falha(`trava de segurança: ${new URL(url).pathname} não é consulta.`)
  try {
    const r = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(30000) })
    const texto = await r.text()
    let corpo = null
    try { corpo = JSON.parse(texto) } catch { /* não é JSON */ }
    return { status: r.status, corpo, texto }
  } catch { return { status: 0, corpo: null, texto: '' } }
}

const login = await chamar(`${urlEzpoint}/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, senha }),
})
if (login.status !== 200 || typeof login.corpo?.token !== 'string') falha(`login do ezpointweb (HTTP ${login.status}).`)
const tk = await chamar(`${urlEzpoint}/getCompelsToken?empresa=${encodeURIComponent(empresa)}`, {
  headers: { Authorization: `Bearer ${login.corpo.token}` },
})
if (tk.status !== 200 || typeof tk.corpo?.token !== 'string') falha(`token do Compels (HTTP ${tk.status}).`)
const cab = { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${tk.corpo.token}` }

const fmt = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d)
const hoje = new Date()
const inicio = new Date(hoje.getTime() - dias * 86400000)
const base = { page: '1', start: '0', limit: '50' }
const datas = { dataInicial: fmt(inicio), dataFinal: fmt(hoje) }
const filtroExt = JSON.stringify([
  { property: 'dataInicial', value: fmt(inicio) }, { property: 'dataFinal', value: fmt(hoje) },
])
// Tipo de nota de saída = '1' (ConstantsNotaICMS.codigoTipoNotaSaida no JS da tela).
const tentativas = [
  { nome: 'GET datas + tipo=1', metodo: 'GET', params: { ...base, ...datas, tipo: '1' } },
  { nome: 'GET filter(Ext) + tipo=1', metodo: 'GET', params: { ...base, tipo: '1', filter: filtroExt } },
  { nome: 'POST form datas + tipo=1', metodo: 'POST', params: { ...base, ...datas, tipo: '1' } },
  { nome: 'GET só paginação', metodo: 'GET', params: base },
]

function linhasDe(corpo) {
  if (Array.isArray(corpo?.data)) return corpo.data
  if (Array.isArray(corpo?.results)) return corpo.results
  if (Array.isArray(corpo)) return corpo
  return null
}

let notas = null
for (const t of tentativas) {
  const qs = new URLSearchParams(t.params)
  const r = t.metodo === 'GET'
    ? await chamar(`${urlApi}/notaICMS/findFilterStockMoves?${qs}`, { headers: cab })
    : await chamar(`${urlApi}/notaICMS/findFilterStockMoves`, {
      method: 'POST', headers: { ...cab, 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs,
    })
  const linhas = linhasDe(r.corpo)
  console.log(`- ${t.nome}: HTTP ${r.status}${linhas ? `, ${linhas.length} nota(s), total=${r.corpo?.totalCount ?? '?'}` : `, sem lista (${String(r.corpo?.msg ?? r.texto).slice(0, 120)})`}`)
  if (linhas && linhas.length && !notas) notas = linhas
}
if (!notas) falha('nenhuma forma devolveu notas — aí precisamos do HAR para ver os filtros exatos.')

console.log(`\nCampos de uma nota: ${Object.keys(notas[0]).sort().join(', ')}\n`)
console.log('Nº NF      série  emissão      tipo  baixada?')
for (const n of notas) {
  const emissao = n.dataEmissao ?? n.dataHoraEmissao ?? n.data ?? '?'
  console.log(`${String(n.numero ?? '?').padEnd(10)} ${String(n.serie ?? '').padEnd(6)} ${String(emissao).slice(0, 12).padEnd(12)} ${String(n.tipo ?? n.tipoNota ?? '?').padEnd(5)} ${n.aceiteBaixa ? 'SIM' : 'NÃO'}`)
}

const pendente = notas.find((n) => !n.aceiteBaixa)
if (!pendente) { console.log('\nNenhuma pendente nesta janela.\nFIM: só leitura.'); process.exit(0) }
const it = await chamar(`${urlApi}/itemBaixaMercadoria/findAllEstoqueProprioByNotaICMSId?${new URLSearchParams({ notaICMSId: String(pendente.id), page: '1', start: '0', limit: '50' })}`, { headers: cab })
const itens = linhasDe(it.corpo)
console.log(`\nItens da NF ${pendente.numero} (pendente): HTTP ${it.status}${itens ? `, ${itens.length} linha(s)` : ` (${String(it.corpo?.msg ?? it.texto).slice(0, 160)})`}`)
for (const l of itens ?? []) {
  const g = (caminho) => caminho.split('.').reduce((o, k) => o?.[k], l) ?? l[caminho]
  console.log(`   ${String(g('itemLote.item.codigo')).padEnd(10)} qtd NF=${String(g('itemNotaICMS.quantidadeInterna')).padStart(6)}  qtd=${String(g('quantidade')).padStart(6)}  estoque=${g('itemLote.itemLoteEstoque.estoque.codigo')}  locação=${g('itemLote.itemLoteEstoque.itemLoteEstoqueLocacao.locacao.codigo') ?? g('itemLote.itemLoteEstoque.itemLoteEstoqueLocacao.id')}  rastreável=${g('itemLote.item.rastreavel')}`)
}
if (itens?.[0]) console.log(`\nCampos de um item: ${Object.keys(itens[0]).sort().join(', ')}`)
console.log('\nFIM: só leitura.')
