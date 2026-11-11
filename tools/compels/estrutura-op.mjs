// Estrutura de OPs no Compels — SÓ LEITURA. Não grava nada e não pega a trava.
// Para cada OP informada mostra: o cadastro (produto, status, quantidade, campos de hierarquia mãe/filha/nível),
// a composição (insumos por 1 unidade, pela consulta que a tela faz antes de apontar), e a linha do tempo de
// empenhos, requisições e apontamentos (número, data, quantidade, responsável). Nunca imprime token, senha,
// custo/preço nem documentos (CPF/CNPJ/e-mail).
//
// Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (obrigatórias);
//   COMPELS_EZPOINT_EMPRESA, COMPELS_EZPOINT_URL, COMPELS_API_URL (opcionais; ver testar-conexao.mjs)
// Uso: node tools/compels/estrutura-op.mjs 8682 8683 8684

const usuario = process.env.COMPELS_EZPOINT_USUARIO
const senha = process.env.COMPELS_EZPOINT_SENHA
const empresa = process.env.COMPELS_EZPOINT_EMPRESA || 'enterplak'
const urlEzpoint = (process.env.COMPELS_EZPOINT_URL || 'https://admin.ezpointweb.com.br/admin-ws').replace(/\/$/, '')
const urlApi = (process.env.COMPELS_API_URL || 'https://api.erpeasy.compels.net').replace(/\/$/, '')
const numeros = process.argv.slice(2).map(Number)

function falha(msg) { console.log(`FALHOU: ${msg}`); process.exit(1) }
if (!usuario || !senha) falha('faltam COMPELS_EZPOINT_USUARIO e/ou COMPELS_EZPOINT_SENHA no ambiente.')
if (numeros.length === 0 || numeros.some((n) => !Number.isInteger(n) || n <= 0)) falha('uso: node estrutura-op.mjs OP1 OP2 ...')

async function chamar(url, opcoes) {
  try {
    const r = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(30000) })
    let corpo = null
    try { corpo = await r.json() } catch { /* não é JSON */ }
    return { status: r.status, corpo }
  } catch { return { status: 0, corpo: null } }
}

const form = (campos) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(campos),
})

// Campos que nunca aparecem na saída.
const PROIBIDO = /custo|preco|pre[cç]o|cpf|cnpj|email|e-mail|senha|password|token|telefone|fone|endereco|logradouro/i
// Campos escalares que interessam numa linha de empenho/requisição/apontamento.
const INTERESSA = /^(numero|data|status|situacao|nivel|quantidade|respons|usuario|tipo|observ)/i

function escalar(v) { return v === null || ['string', 'number', 'boolean'].includes(typeof v) }

/** Campos escalares permitidos de um objeto; `todos` = não filtra por INTERESSA. Objetos aninhados: só numero/codigo. */
function campos(obj, todos = false) {
  const out = []
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (PROIBIDO.test(k)) continue
    if (escalar(v)) {
      if (v === null || v === '') continue
      if (todos || INTERESSA.test(k)) out.push(`${k}=${v}`)
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const ref = [v.numero !== undefined ? `numero=${v.numero}` : '', typeof v.codigo === 'string' ? `codigo=${v.codigo}` : '']
        .filter(Boolean).join(' ')
      if (ref && (todos || /ordem|op|mae|pai|base|filh|origem|item|produto/i.test(k))) out.push(`${k}{${ref}}`)
    }
  }
  return out.join(' | ')
}

const lista = (corpo) => (Array.isArray(corpo) ? corpo : Array.isArray(corpo?.data) ? corpo.data : [])

// token
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

const hoje = new Date()
const iso = (d) => d.toISOString().slice(0, 10) + 'T00:00:00'

for (const numeroOp of numeros) {
  console.log(`\n==================== OP ${numeroOp} ====================`)
  const filtro = {
    numero: String(numeroOp), codigoNegociante: null, nomeNegociante: null, cpfCnpjNegociante: null, clientePedido: '',
    item: '', linha: '', tipoPropriedade: null, statusList: null, selecionarPor: 'Data Documento',
    dataInicial: iso(new Date(hoje.getTime() - 3 * 365 * 864e5)), dataFinal: iso(hoje), numeroPedido: '', centroCusto: '',
    listarPendentes: false, prototipo: false, etapa: '', selecionarOPPor: 'op', observacao: '', nivel: '',
    responsavelCriacao: '', responsavelAlteracao: '', situacaoId: null, semVinculoComSolicitacaoInternaCompra: false,
  }
  const busca = await api('/ordemProducaoSimples/findAllFilter', form({ sortFilter: 'null', filtro: JSON.stringify(filtro), page: '1', start: '0', limit: '25' }))
  const achada = lista(busca.corpo).find((o) => o?.numero === numeroOp)
  if (!achada) { console.log(`não encontrada (HTTP ${busca.status}).`); continue }

  console.log('## Cadastro (linha da lista de OPs, todos os campos permitidos)')
  console.log('   ' + campos(achada, true))

  const det = await api('/ordemProducaoSimples/findById', form({ id: String(achada.id), page: '1', start: '0', limit: '25' }))
  const d = det.corpo?.data ?? det.corpo ?? {}
  const item = d.composicaoProduto?.item ?? {}
  console.log(`## Produto: ${item.codigo ?? '?'} — ${item.descricao ?? ''} (unidade ${item.unidade?.codigo ?? '?'})`)
  console.log('   detalhe: ' + campos(d))

  const id = String(achada.id)
  if (typeof item.id === 'number') {
    const disp = await api('/apontamentoOrdemProducao/verificaDisponibilidade', form({
      idOrdemProducao: id, quantidadeApontar: '1', itemPaiId: String(item.id), page: '1', start: '0', limit: '50',
    }))
    const comps = lista(disp.corpo)
    console.log(`## Composição (consumo para apontar 1 un.): ${comps.length} insumo(s) (HTTP ${disp.status})`)
    for (const c of comps) {
      const it = c.item ?? {}
      console.log(`   ${String(it.codigo ?? '?').padEnd(12)} por un. ${c.quantidadeComposicao ?? c.quantidadeUtilizada ?? '?'}` +
        `${c.itemFantasma ? ' (fantasma)' : ''} | saldo requisitado disponível ${c.saldoDisponivel ?? '?'} | ${String(it.descricao ?? '').slice(0, 50)}`)
    }
  }

  const [emp, req, apo] = await Promise.all([
    api(`/empenho/findByOrdemProducaoId?idOrdemProducao=${id}&page=1&start=0&limit=50`),
    api('/requisicaoOrdemProducao/findByOrdemProducaoId', form({ id, page: '1', start: '0', limit: '50' })),
    api('/apontamentoOrdemProducao/findByOrdemProducaoId', form({ id, page: '1', start: '0', limit: '50' })),
  ])
  for (const [titulo, r] of [['Empenhos', emp], ['Requisições', req]]) {
    const linhas = lista(r.corpo)
    console.log(`## ${titulo}: ${linhas.length} (HTTP ${r.status}) — contadores das listas podem vir zerados`)
    for (const l of linhas) console.log('   ' + campos(l))
  }
  const apontamentos = lista(apo.corpo)
  let total = 0
  console.log(`## Apontamentos: ${apontamentos.length} (HTTP ${apo.status})`)
  for (const a of apontamentos.slice(0, 30)) {
    // O detalhe traz o responsável e o lote; a lista às vezes não.
    const dA = await api('/apontamentoOrdemProducao/findById', form({ id: String(a.id), page: '1', start: '0', limit: '25' }))
    const x = dA.corpo?.data ?? dA.corpo ?? {}
    const qtd = typeof x.quantidadeProduzida === 'number' ? x.quantidadeProduzida : a.quantidadeProduzida
    if (typeof qtd === 'number') total += qtd
    const lote = x.itemLote?.numero ? ` | lote ${x.itemLote.numero}` : ''
    console.log(`   nº ${x.numero ?? a.numero} | ${x.data ?? a.data} | produzida ${qtd} | ${campos(x).split(' | ').filter((c) => /respons|usuario/i.test(c)).join(' ')}${lote}`)
  }
  if (apontamentos.length > 30) console.log(`   ... e mais ${apontamentos.length - 30} (só os 30 primeiros detalhados)`)
  console.log(`   total apontado (detalhados): ${total}`)
}
console.log('\nFIM: só leitura, nada foi gravado.')
