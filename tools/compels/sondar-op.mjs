// Sonda de LEITURA das consultas que a tela do Compels faz antes de Requisitar e Apontar.
// Não grava nada e não pega a trava. Imprime só a ESTRUTURA das respostas (campos e tipos), nunca
// token, senha nem dados; números só nos campos de quantidade/saldo. Para um campo de custo, só diz
// se existe.
//
// Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (obrigatórias);
//   COMPELS_EZPOINT_EMPRESA, COMPELS_EZPOINT_URL, COMPELS_API_URL (opcionais; ver testar-conexao.mjs)
// Uso: node tools/compels/sondar-op.mjs NUMERO_DA_OP [QUANTIDADE]   (quantidade padrão: 1)

const usuario = process.env.COMPELS_EZPOINT_USUARIO
const senha = process.env.COMPELS_EZPOINT_SENHA
const empresa = process.env.COMPELS_EZPOINT_EMPRESA || 'enterplak'
const urlEzpoint = (process.env.COMPELS_EZPOINT_URL || 'https://admin.ezpointweb.com.br/admin-ws').replace(/\/$/, '')
const urlApi = (process.env.COMPELS_API_URL || 'https://api.erpeasy.compels.net').replace(/\/$/, '')
const numeroOp = Number(process.argv[2])
const quantidade = Number(process.argv[3] || 1)

function falha(msg) { console.log(`FALHOU: ${msg}`); process.exit(1) }
if (!usuario || !senha) falha('faltam COMPELS_EZPOINT_USUARIO e/ou COMPELS_EZPOINT_SENHA no ambiente.')
if (!Number.isInteger(numeroOp) || numeroOp <= 0) falha('uso: node tools/compels/sondar-op.mjs NUMERO_DA_OP [QUANTIDADE]')
if (!(quantidade > 0)) falha('quantidade inválida.')

async function chamar(url, opcoes) {
  try {
    const r = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(30000) })
    let corpo = null
    try { corpo = await r.json() } catch { /* não é JSON */ }
    return { status: r.status, corpo }
  } catch { falha('sem conexão.') }
}

const SO_NUMERO = /^(quantidade|saldo)/i // campos cujo valor numérico pode aparecer
const CUSTO = /custo|preco|pre[cç]o/i

function estrutura(valor, profundidade = 0, nome = '') {
  const recuo = '   ' + '  '.repeat(profundidade)
  if (Array.isArray(valor)) {
    console.log(`${recuo}${nome}: lista de ${valor.length}`)
    if (valor[0] !== undefined && profundidade < 4) estrutura(valor[0], profundidade + 1, '(1º item)')
    return
  }
  if (valor && typeof valor === 'object') {
    if (nome) console.log(`${recuo}${nome}: objeto`)
    if (profundidade >= 4) return
    for (const [k, v] of Object.entries(valor)) {
      if (v && typeof v === 'object') estrutura(v, profundidade + 1, k)
      else if (CUSTO.test(k)) console.log(`${recuo}  ${k}: ${typeof v} (${v === null ? 'nulo' : 'presente'})`)
      else if (typeof v === 'number' && (SO_NUMERO.test(k) || k === 'data')) console.log(`${recuo}  ${k}: ${v}`)
      else console.log(`${recuo}  ${k}: ${v === null ? 'nulo' : typeof v}`)
    }
    return
  }
  console.log(`${recuo}${nome}: ${typeof valor}${typeof valor === 'number' ? ` = ${valor}` : ''}`)
}

function mostrar(titulo, r) {
  console.log(`\n## ${titulo}: HTTP ${r.status}`)
  if (r.corpo !== null) estrutura(r.corpo, 0, '')
}

const form = (campos) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(campos),
})

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
const api = (caminho, init = {}) => chamar(`${urlApi}${caminho}`, { ...init, headers: { ...(init.headers || {}), ...auth } })

// OP: número → id interno
const hoje = new Date()
const iso = (d) => d.toISOString().slice(0, 10) + 'T00:00:00'
const filtro = {
  numero: String(numeroOp), codigoNegociante: null, nomeNegociante: null, cpfCnpjNegociante: null, clientePedido: '',
  item: '', linha: '', tipoPropriedade: null, statusList: null, selecionarPor: 'Data Documento',
  dataInicial: iso(new Date(hoje.getTime() - 3 * 365 * 864e5)), dataFinal: iso(hoje), numeroPedido: '', centroCusto: '',
  listarPendentes: false, prototipo: false, etapa: '', selecionarOPPor: 'op', observacao: '', nivel: '',
  responsavelCriacao: '', responsavelAlteracao: '', situacaoId: null, semVinculoComSolicitacaoInternaCompra: false,
}
const busca = await api('/ordemProducaoSimples/findAllFilter', form({ sortFilter: 'null', filtro: JSON.stringify(filtro), page: '1', start: '0', limit: '25' }))
const lista = Array.isArray(busca.corpo?.data) ? busca.corpo.data : []
const achada = lista.find((o) => o?.numero === numeroOp)
if (!achada) falha(`OP ${numeroOp} não encontrada (HTTP ${busca.status}).`)
const detalhe = await api('/ordemProducaoSimples/findById', form({ id: String(achada.id), page: '1', start: '0', limit: '25' }))
const d = detalhe.corpo?.data ?? detalhe.corpo ?? {}
const itemId = d.composicaoProduto?.item?.id
const negId = d.negociante?.id
console.log(`OP ${numeroOp}: status ${d.status}, tipoPropriedade ${d.tipoPropriedade}, quantidade ${d.quantidade}, unidade ${d.composicaoProduto?.item?.unidade?.codigo}`)
if (typeof itemId !== 'number') falha('não achei o item (produto) da OP.')

const id = String(achada.id)
mostrar('getQuantidadeRequisitar', await api('/requisicaoOrdemProducao/getQuantidadeRequisitar', form({ idOrdemProducao: id })))
mostrar(`verificaQuantidadeRequisitada (quantidade ${quantidade})`, await api('/requisicaoOrdemProducao/verificaQuantidadeRequisitada', form({
  jsonData: JSON.stringify({ ordemProducaoSimples: { tipoPropriedade: d.tipoPropriedade ?? 0, operacaoMista: false, composicaoProduto: { item: { id: itemId } }, negociante: { id: String(negId) }, id }, quantidade }),
  page: '1', start: '0', limit: '50',
})))
mostrar('getQuantidadeApontar', await api('/apontamentoOrdemProducao/getQuantidadeApontar', form({ idOrdemProducao: id })))
mostrar(`verificaDisponibilidade (apontar ${quantidade})`, await api('/apontamentoOrdemProducao/verificaDisponibilidade', form({
  idOrdemProducao: id, quantidadeApontar: String(quantidade), itemPaiId: String(itemId), page: '1', start: '0', limit: '50',
})))
console.log('\nFIM: só leitura, nada foi gravado.')
