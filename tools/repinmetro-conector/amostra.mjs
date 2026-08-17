// Auxiliar de teste: lista alguns registros já espelhados em repinmetro_logs,
// pra você pegar um número de série e testar a busca na tela do ShopFloor.
// Uso: node --env-file=.env amostra.mjs
const env = process.env
const URL = env.SUPABASE_URL.replace(/\/$/, '')
const SR = env.SUPABASE_SERVICE_ROLE
const H = { apikey: SR, Authorization: `Bearer ${SR}` }

const res = await fetch(
  `${URL}/rest/v1/repinmetro_logs?select=origem_id,numero_serie,modelo,status,data_inicio&order=origem_id.desc&limit=20`,
  { headers: H },
)
if (!res.ok) {
  console.error(`Erro ${res.status}: ${await res.text()}`)
  process.exit(1)
}
const linhas = await res.json()
console.log(`Total lido: ${linhas.length}\n`)
for (const l of linhas) {
  const sn = l.numero_serie && l.numero_serie.trim() !== '' ? l.numero_serie : '(vazio)'
  console.log(`id ${l.origem_id} | NS: ${sn} | modelo: ${l.modelo ?? '-'} | status: ${l.status ?? '-'}`)
}
