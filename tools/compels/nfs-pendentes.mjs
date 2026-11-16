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
const base = { page: '1', start: '0', limit: '100' }
// Formato tirado do JS da tela (AceiteBaixaMercadoriaPanel): POST com `filter` = JSON; datas no formato do
// Ext.encode ("Y-m-dTH:i:s"); statusAceiteBaixa 'false' = Não Processada (pendente). GET não serve: a rota
// cai em /notaICMS/{id}.
const iso = (d) => {
  const [dd, mm, aa] = fmt(d).split('/')
  return `${aa}-${mm}-${dd}T00:00:00`
}
// Corpo IGUAL ao da tela (HAR de 16/11): form-urlencoded com `filter` em JSON; negociante = null (texto vazio
// filtra por nome '' e não acha nada — foi o motivo das rodadas vazias), tipo '1 - Saída', datas null = todas.
const filtro = (extra) => JSON.stringify({
  tipo: '1 - Saída', emissaoPropria: true, numero: '', dataInicial: null, dataFinal: null, status: null,
  statusAceiteBaixa: 'false', selecionarPor: 'emissao', nomeNegociante: null, cpfCnpjNegociante: null,
  codigoNegociante: null, item: '', coc: '', cfop: '', ...extra,
})
const tentativas = [
  { nome: 'pendentes de baixa (Não Processada), todas as datas', params: { ...base, filter: filtro({}) } },
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
  const r = await chamar(`${urlApi}/notaICMS/findFilterStockMoves`, {
    method: 'POST', headers: { ...cab, 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs,
  })
  const linhas = linhasDe(r.corpo)
  console.log(`- ${t.nome}: HTTP ${r.status}${linhas ? `, ${linhas.length} nota(s), total=${r.corpo?.totalCount ?? '?'}` : `, sem lista (${String(r.corpo?.msg ?? r.texto).slice(0, 300)})`}`)
  if (linhas && linhas.length && !notas) notas = linhas
}
// Observação (informações complementares) das notas RECENTES, baixadas ou não: tem número de série escrito?
{
  const qs = new URLSearchParams({ ...base, filter: filtro({ statusAceiteBaixa: null, dataInicial: iso(inicio), dataFinal: iso(hoje) }) })
  const r = await chamar(`${urlApi}/notaICMS/findFilterStockMoves`, {
    method: 'POST', headers: { ...cab, 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs,
  })
  const recentes = linhasDe(r.corpo) ?? []
  console.log(`\nObservação das notas de saída dos últimos ${dias} dias (HTTP ${r.status}, ${recentes.length} nota(s)):`)
  for (const n of recentes.slice(0, 15)) {
    const obs = String(n.informacoesComplementares ?? '').replace(/\s+/g, ' ').trim()
    console.log(`  NF ${n.numero} ${String(n.dataHoraEmissao ?? '').slice(0, 10)}: ${obs ? obs.slice(0, 220) : '(sem observação)'}`)
  }
}
if (!notas) { console.log('\nNenhuma nota pendente de baixa.\nFIM: só leitura.'); process.exit(0) }

console.log(`\nCampos de uma nota: ${Object.keys(notas[0]).sort().join(', ')}\n`)
console.log('Nº NF      série  emissão      tipo  baixada?')
for (const n of notas) {
  const emissao = n.dataEmissao ?? n.dataHoraEmissao ?? n.data ?? '?'
  console.log(`${String(n.numero ?? '?').padEnd(10)} ${String(n.serie ?? '').padEnd(6)} ${String(emissao).slice(0, 12).padEnd(12)} ${String(n.tipo ?? n.tipoNota ?? '?').padEnd(5)} ${n.aceiteBaixa ? 'SIM' : 'NÃO'}`)
}

// Itens da nota: POST form, como a tela. Sem `itemLote` = o Compels não achou lote com saldo para baixar.
for (const nota of notas.filter((n) => !n.aceiteBaixa).slice(0, 5)) {
  const it = await chamar(`${urlApi}/itemBaixaMercadoria/findAllEstoqueProprioByNotaICMSId`, {
    method: 'POST', headers: { ...cab, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ notaICMSId: String(nota.id), page: '1', start: '0', limit: '25' }),
  })
  const itens = linhasDe(it.corpo)
  console.log(`\nItens da NF ${nota.numero} (pendente): HTTP ${it.status}${itens ? `, ${itens.length} linha(s)` : ` (${String(it.corpo?.msg ?? it.texto).slice(0, 160)})`}`)
  for (const l of itens ?? []) {
    const g = (caminho) => caminho.split('.').reduce((o, k) => o?.[k], l)
    const lote = g('itemLote')
    console.log(`   campos da linha: ${Object.keys(l).sort().join(', ')} | item do lote: ${g('itemLote.item.codigo') ?? '-'} rastreável=${g('itemLote.item.rastreavel') ?? '-'}`)
    console.log(`   item=${g('itemNotaICMS.numeroItemPedidoVenda') ?? '?'}  qtd NF=${g('itemNotaICMS.quantidadeInterna')}  a baixar=${g('quantidade')}  ${lote ? `lote ${lote.numero} estoque=${g('itemLote.itemLoteEstoque.estoque.codigo')} saldo=${g('itemLote.itemLoteEstoque.saldo')}` : 'SEM LOTE COM SALDO'}`)
  }
}
console.log('\nFIM: só leitura.')
