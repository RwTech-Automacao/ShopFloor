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

async function post(table, rows, prefer = 'return=minimal') {
  if (!rows.length) return
  for (let i = 0; i < rows.length; i += 500) {
    const lote = rows.slice(i, i + 500)
    const res = await fetch(`${URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: prefer },
      body: JSON.stringify(lote),
    })
    if (!res.ok) throw new Error(`POST ${table}: ${res.status} ${await res.text()}`)
  }
}

const wb = XLSX.read(readFileSync('ShopFloor WebApp.xlsx'), { type: 'buffer' })
const s = (v) => (v ?? '').toString().trim()
const yes = (v) => ['sim', 's', 'yes', 'y', '1', 'true', 'x'].includes(s(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())

// ---- Defeitos ----
const defRows = XLSX.utils.sheet_to_json(wb.Sheets['Defeitos'], { header: 1, defval: '' }).slice(1)
const defeitos = []
const vistos = new Set()
for (const r of defRows) {
  const codigo = s(r[0]); const tipo = parseInt(s(r[1]), 10)
  if (!codigo || vistos.has(codigo) || (tipo !== 1 && tipo !== 2)) continue
  vistos.add(codigo); defeitos.push({ codigo, tipo })
}
await post('sf_defeitos', defeitos)
console.log(`defeitos: ${defeitos.length}`)

// ---- Ordens ativas + aplicabilidade ----
// Índices de aplicabilidade (Código.gs, NÃO os rótulos do header):
const APLIC = {
  'Inspeção SMD': 9, 'Inspeção PTH': 10, 'Teste': 11, 'Teste Final': 12, 'Inspeção Final': 13,
  'Embalagem': 14, 'Inspeção NQA': 15, 'Integração': 16, 'Inicial': 17, 'Inspeção SPI': 18, 'Montagem PTH': 19,
}
const pmoRows = XLSX.utils.sheet_to_json(wb.Sheets['PMO_OPS'], { header: 1, defval: '' }).slice(1)
const ordens = []
const aplicPorChave = new Map() // 'pmo||op' -> [postos]
const chaveVista = new Set()
for (const r of pmoRows) {
  const pmo = s(r[0]); const op = s(r[1])
  if (!pmo || !op) continue
  if (s(r[6]).toUpperCase() === 'FINALIZADA') continue // só ativas
  const chave = `${pmo}||${op}`
  if (chaveVista.has(chave)) continue
  chaveVista.add(chave)
  ordens.push({
    pmo, op, cliente: s(r[5]), qtd: parseInt(s(r[2]), 10) || null,
    descricao: s(r[3]), acp: s(r[4]), status: s(r[6]),
    sn_ini: s(r[7]), sn_fim: s(r[8]),
  })
  const postos = Object.entries(APLIC).filter(([, idx]) => yes(r[idx])).map(([p]) => p)
  aplicPorChave.set(chave, postos)
}
// insere ordens devolvendo id, e depois a aplicabilidade
const res = await fetch(`${URL}/rest/v1/sf_ordens`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify(ordens),
})
if (!res.ok) throw new Error(`POST sf_ordens: ${res.status} ${await res.text()}`)
const criadas = await res.json()
console.log(`ordens ativas: ${criadas.length}`)

const ordemPostos = []
for (const o of criadas) {
  const postos = aplicPorChave.get(`${o.pmo}||${o.op}`) || []
  for (const posto of postos) ordemPostos.push({ ordem_id: o.id, posto })
}
await post('sf_ordem_postos', ordemPostos)
console.log(`ordem_postos: ${ordemPostos.length}`)
