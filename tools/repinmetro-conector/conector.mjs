// Conector repinmetro → ShopFloor (Supabase).
// Roda na máquina da intranet (mesma do banco repinmetro), via cron.
// Lê o Postgres do repinmetro (usuário read-only) e faz UPSERT idempotente em repinmetro_logs.
// Watermark = MAX(origem_id) no Supabase (retoma sozinho; se um dia não rodar, o próximo recupera).
// Config por variáveis de ambiente (.env) — nunca comitar segredos. Ver README.md.

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const env = process.env
function obrigatorio(nome) {
  const v = env[nome]
  if (!v) {
    console.error(`Falta a variável de ambiente ${nome} (veja .env.example).`)
    process.exit(1)
  }
  return v
}

const SUPABASE_URL = obrigatorio('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE = obrigatorio('SUPABASE_SERVICE_ROLE')
const LOTE = Number(env.REPINMETRO_LOTE ?? '1000')

// Colunas dos 15 itens de teste (nomes de origem = chaves do jsonb `resultados`).
const RESULTADO_COLS = [
  'statustesterfid',
  'statustestedigital',
  'statustestebarras',
  'statustestetecladomatricial',
  'statustesteusbfiscal',
  'statustesteusbnaofiscal',
  'statustesteimpressaorim',
  'statustesteimpressaopapel',
  'statustesteinspecaovisual',
  'statusaudiorep',
  'statusbloqueiorep',
  'statusmrp',
  'statustestechavecriptografica',
  'statuscomunicacao',
  'statustesteproducao',
]

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } })
const pool = new pg.Pool({
  host: env.REPINMETRO_HOST ?? 'localhost',
  port: Number(env.REPINMETRO_PORT ?? '5432'),
  database: obrigatorio('REPINMETRO_DB'),
  user: obrigatorio('REPINMETRO_USER'),
  password: obrigatorio('REPINMETRO_PASSWORD'),
  max: 2,
})

const txt = (v) => (v === null || v === undefined ? null : String(v))

function mapear(row, espelhadoEm) {
  const resultados = {}
  for (const c of RESULTADO_COLS) resultados[c] = row[c] ?? null
  return {
    origem_id: row.id,
    numero_serie: String(row.numeroserierep ?? '').trim(),
    modelo: txt(row.serialmodelorep),
    data_inicio: row.datahorainicio ?? null,
    data_fim: row.datahorafim ?? null,
    status: txt(row.status),
    observacao: txt(row.observacao),
    remanufaturado: txt(row.remanufaturado),
    lacre: txt(row.lacre),
    op_codigo: txt(row.codigoop),
    op_ano: txt(row.anoop),
    placa_op: txt(row.numeroplacaop),
    resultados,
    espelhado_em: espelhadoEm,
  }
}

/** Maior origem_id já espelhado. Se vazio: REPINMETRO_SINCE (teste) ou MAX(teste.id) (sem backfill). */
async function watermark() {
  const { data, error } = await sb
    .from('repinmetro_logs')
    .select('origem_id')
    .order('origem_id', { ascending: false })
    .limit(1)
  if (error) throw error
  if (data && data.length > 0) return Number(data[0].origem_id)
  if (env.REPINMETRO_SINCE != null && env.REPINMETRO_SINCE !== '') return Number(env.REPINMETRO_SINCE)
  const r = await pool.query('SELECT COALESCE(MAX(id), 0) AS m FROM teste')
  return Number(r.rows[0].m)
}

async function main() {
  let since = await watermark()
  console.log(`Iniciando a partir do id ${since}.`)
  let total = 0
  for (;;) {
    const { rows } = await pool.query(
      'SELECT * FROM teste t LEFT JOIN testequalidade tq ON t.id = tq.id WHERE t.id > $1 ORDER BY t.id ASC LIMIT $2',
      [since, LOTE],
    )
    if (rows.length === 0) break
    const espelhadoEm = new Date().toISOString()
    const registros = rows.map((r) => mapear(r, espelhadoEm))
    const { error } = await sb.from('repinmetro_logs').upsert(registros, { onConflict: 'origem_id' })
    if (error) throw error
    total += registros.length
    since = rows[rows.length - 1].id
    console.log(`Espelhados ${total} (até id ${since}).`)
    if (rows.length < LOTE) break
  }
  console.log(`Concluído: ${total} registro(s) novo(s).`)
  await pool.end()
}

main().catch(async (e) => {
  console.error('Erro no conector:', e)
  try {
    await pool.end()
  } catch {}
  process.exit(1)
})
