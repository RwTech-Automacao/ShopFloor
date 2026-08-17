// Auxiliar: conta quantas linhas o repinmetro tem no total e quantas têm número de série.
// Ajuda a decidir o volume do backfill. Uso: node --env-file=.env contar.mjs
import pg from 'pg'
const env = process.env
const pool = new pg.Pool({
  host: env.REPINMETRO_HOST ?? 'localhost',
  port: Number(env.REPINMETRO_PORT ?? '5432'),
  database: env.REPINMETRO_DB,
  user: env.REPINMETRO_USER,
  password: env.REPINMETRO_PASSWORD,
  max: 1,
})

const { rows } = await pool.query(`
  SELECT
    count(*)                                                                      AS total,
    count(*) FILTER (WHERE numeroserierep IS NOT NULL AND btrim(numeroserierep) <> '') AS com_sn,
    min(id)                                                                       AS menor_id,
    max(id)                                                                       AS maior_id
  FROM teste
`)
const r = rows[0]
const total = Number(r.total)
const comSn = Number(r.com_sn)
console.log(`Total de linhas:      ${total}`)
console.log(`Com número de série:  ${comSn}  (${((comSn / total) * 100).toFixed(1)}%)`)
console.log(`Sem número de série:  ${total - comSn}`)
console.log(`Faixa de id:          ${r.menor_id} … ${r.maior_id}`)
await pool.end()
