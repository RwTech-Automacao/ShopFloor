/**
 * Migração do HISTÓRICO do ShopFloor WebApp.xlsx → Postgres.
 * - 18 abas de cliente → sf_registros (todas as linhas; cliente = nome da aba)
 * - OPs FINALIZADAS → sf_ordens + sf_ordem_postos (p/ Grade/Pesquisa histórica)
 * - INTEGRACAO_HDR → sf_integracoes (+ itens derivados das linhas posto=Integração)
 * Guarda de idempotência: aborta se já houver registros com data < 2026-07-01.
 * NÃO apaga nada. Rodar da raiz do projeto: node scripts/migrar-historico.mjs
 */
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'

function env(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}
const e = env('.env.local')
const URL = e.NEXT_PUBLIC_SUPABASE_URL
const KEY = e.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function post(table, rows, prefer = 'return=minimal') {
  const criadas = []
  for (let i = 0; i < rows.length; i += 500) {
    const lote = rows.slice(i, i + 500)
    const res = await fetch(`${URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...H, Prefer: prefer },
      body: JSON.stringify(lote),
    })
    if (!res.ok) throw new Error(`POST ${table}: ${res.status} ${await res.text()}`)
    if (prefer.includes('representation')) criadas.push(...(await res.json()))
  }
  return criadas
}

async function getPaginado(pathBase) {
  const out = []
  for (let de = 0; ; de += 1000) {
    const res = await fetch(`${URL}/rest/v1/${pathBase}`, {
      headers: { ...H, Range: `${de}-${de + 999}` },
    })
    if (!res.ok) throw new Error(`GET ${pathBase}: ${res.status} ${await res.text()}`)
    const rows = await res.json()
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

const s = (v) => (v ?? '').toString().trim()
const normSN = (sn) => s(sn).replace(/[^A-Za-z0-9]/g, '').replace(/^0+/, '').trim().toLowerCase()
const yes = (v) => ['sim', 's', 'yes', 'y', '1', 'true', 'x'].includes(s(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())

/** dd/MM/yyyy HH:mm:ss (ou Date do xlsx) → ISO com fuso -03:00 (São Paulo). */
function parseDataHora(v) {
  if (v === '' || v == null) return null
  const p = (n) => String(n).padStart(2, '0')
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}T${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}-03:00`
  }
  const m = s(v).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}T${p(m[4] ?? 0)}:${m[5] ?? '00'}:${m[6] ?? '00'}-03:00`
}

function sanitizeSheetName(name) {
  let x = s(name).replace(/[\[\]:?/\\*]/g, ' ').trim()
  if (x.length > 99) x = x.slice(0, 99)
  return x || 'Cliente'
}

// ===== guarda de idempotência =====
const jaTem = await (await fetch(`${URL}/rest/v1/sf_registros?data_hora=lt.2026-07-01&select=id&limit=1`, { headers: H })).json()
if (Array.isArray(jaTem) && jaTem.length > 0) {
  console.error('ABORTADO: já existem registros históricos (data < 2026-07-01). Histórico já migrado?')
  process.exit(1)
}

const wb = XLSX.read(readFileSync('ShopFloor WebApp.xlsx'), { type: 'buffer', cellDates: true })
const pmoRows = XLSX.utils.sheet_to_json(wb.Sheets['PMO_OPS'], { header: 1, defval: '' }).slice(1)

// ===== 1) OPs FINALIZADAS que ainda não existem =====
const existentes = new Set((await getPaginado('sf_ordens?select=pmo,op')).map((o) => `${o.pmo}||${o.op}`))
const CATALOGO_ORDEM = {
  Inicial: 1, 'Inspeção SPI': 2, 'Inspeção SMD': 3, 'Montagem PTH': 4, 'Inspeção PTH': 5,
  Teste: 6, 'Burn-in': 7, 'Integração': 8, 'Teste Final': 9, 'Inspeção Final': 10,
  Embalagem: 11, 'Inspeção NQA': 12, 'Extra máquina': 13, 'Manutenção': 14,
}
const APLIC = {
  'Inspeção SMD': 9, 'Inspeção PTH': 10, Teste: 11, 'Teste Final': 12, 'Inspeção Final': 13,
  Embalagem: 14, 'Inspeção NQA': 15, 'Integração': 16, Inicial: 17, 'Inspeção SPI': 18, 'Montagem PTH': 19,
}
const novasOrdens = []
const aplicPorChave = new Map()
const vistas = new Set()
for (const r of pmoRows) {
  const pmo = s(r[0]); const op = s(r[1])
  if (!pmo || !op) continue
  const chave = `${pmo}||${op}`
  if (existentes.has(chave) || vistas.has(chave)) continue
  vistas.add(chave)
  novasOrdens.push({
    pmo, op, cliente: s(r[5]), qtd: parseInt(s(r[2]), 10) || null,
    descricao: s(r[3]), acp: s(r[4]), status: s(r[6]) || 'FINALIZADA',
    sn_ini: s(r[7]), sn_fim: s(r[8]),
  })
  aplicPorChave.set(chave, Object.entries(APLIC).filter(([, i]) => yes(r[i])).map(([p]) => p))
}
const criadas = await post('sf_ordens', novasOrdens, 'return=representation')
const ordemPostos = []
for (const o of criadas) {
  for (const posto of aplicPorChave.get(`${o.pmo}||${o.op}`) ?? []) {
    ordemPostos.push({ ordem_id: o.id, posto, ordem: CATALOGO_ORDEM[posto] ?? 99 })
  }
}
await post('sf_ordem_postos', ordemPostos)
console.log(`OPs novas (finalizadas/faltantes): ${criadas.length} · aplicabilidades: ${ordemPostos.length}`)

// ===== 2) abas de cliente → sf_registros =====
const NAO_CLIENTE = new Set(['PMO_OPS', 'Defeitos', 'INTEGRACAO_HDR', 'Manutencao', 'Registros', 'Status OP', 'Resumo'])
const clientesPlanilha = new Set(pmoRows.map((r) => sanitizeSheetName(s(r[5]))).filter(Boolean))
const abasCliente = wb.SheetNames.filter((n) => !NAO_CLIENTE.has(n) && clientesPlanilha.has(n))
console.log(`Abas de cliente detectadas (${abasCliente.length}): ${abasCliente.join(', ')}`)

const registros = []
const integracaoRowsPorId = new Map() // id -> [{pmo, op, sn, snNorm}]
let ignoradas = 0
for (const aba of abasCliente) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: '' }).slice(1)
  let doCliente = 0
  for (const r of rows) {
    const posto = s(r[2])
    const sn = s(r[8])
    if (!posto && !sn) continue // linha vazia
    const dataHora = parseDataHora(r[0])
    if (!dataHora) { ignoradas++; continue }
    // Inspeção NQA no legado não gravava status na coluna 7 — o veredito ficava em
    // nqa_visual/nqa_funcional (cols 12/13). Deriva aqui p/ manter paridade com o Lançamento novo.
    let status = s(r[7])
    if (posto === 'Inspeção NQA' && status === '') {
      const visual = s(r[12]).toLowerCase()
      const funcional = s(r[13]).toLowerCase()
      status =
        visual === 'aprovado' && ['aprovado', 'não aplicável', 'nao aplicavel'].includes(funcional)
          ? 'Aprovado'
          : 'Reprovado'
    }
    const reg = {
      data_hora: dataHora,
      colaborador: s(r[1]),
      posto,
      pmo: s(r[3]),
      op: s(r[4]),
      cliente: aba,
      numero_caixa: s(r[5]),
      qtd_por_caixa: parseInt(s(r[6]), 10) || null,
      status,
      numero_serie: sn,
      numero_serie_norm: normSN(sn),
      codigo_defeito: s(r[9]),
      posicao: s(r[10]),
      tipo_defeito: s(r[11]),
      nqa_visual: s(r[12]),
      nqa_funcional: s(r[13]),
      id_integracao: s(r[14]),
      reparo_conserto: s(r[15]),
      reparo_posicao: s(r[16]),
      posto_origem: s(r[17]),
      data_hora_origem: parseDataHora(r[18]),
    }
    registros.push(reg)
    doCliente++
    if (reg.id_integracao && posto.toLowerCase().startsWith('integra')) {
      const arr = integracaoRowsPorId.get(reg.id_integracao) ?? []
      arr.push({ pmo: reg.pmo, op: reg.op, sn, snNorm: reg.numero_serie_norm })
      integracaoRowsPorId.set(reg.id_integracao, arr)
    }
  }
  console.log(`  ${aba}: ${doCliente} registros`)
}
await post('sf_registros', registros)
console.log(`sf_registros inseridos: ${registros.length} (linhas sem data válida ignoradas: ${ignoradas})`)

// ===== 3) INTEGRACAO_HDR → sf_integracoes + itens =====
const hdrSheet = wb.Sheets['INTEGRACAO_HDR']
let totalHdr = 0
let totalItens = 0
if (hdrSheet) {
  const hdrRows = XLSX.utils.sheet_to_json(hdrSheet, { header: 1, defval: '' }).slice(1)
  const hdrs = []
  for (const r of hdrRows) {
    const codigo = s(r[0])
    if (!codigo) continue
    hdrs.push({
      codigo,
      data_hora: parseDataHora(r[1]) ?? '2020-01-01T00:00:00-03:00',
      colaborador: s(r[2]),
      cliente: s(r[3]),
      pmo: s(r[4]),
      op: s(r[5]),
      produto_sn: s(r[6]),
      produto_sn_norm: s(r[7]) ? s(r[7]).toLowerCase() : normSN(r[6]),
      qtd_placas: parseInt(s(r[8]), 10) || 0,
      status: s(r[9]).toUpperCase() === 'ATIVO' ? 'ATIVA' : 'CANCELADA',
    })
  }
  const hdrCriados = await post('sf_integracoes', hdrs, 'return=representation')
  totalHdr = hdrCriados.length
  const itens = []
  for (const h of hdrCriados) {
    for (const it of integracaoRowsPorId.get(h.codigo) ?? []) {
      if (it.snNorm === h.produto_sn_norm) continue // linha do produto
      itens.push({ integracao_id: h.id, placa_pmo: it.pmo, placa_op: it.op, placa_sn: it.sn, placa_sn_norm: it.snNorm })
    }
  }
  await post('sf_integracao_itens', itens)
  totalItens = itens.length
}
console.log(`sf_integracoes: ${totalHdr} · itens (placas): ${totalItens}`)
console.log('\n✅ Migração do histórico concluída.')
