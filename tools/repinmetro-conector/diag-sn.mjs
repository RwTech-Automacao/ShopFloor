// Diagnóstico: entende por que um SN traz N linhas e onde ficam os resultados.
// Uso: node --env-file=.env diag-sn.mjs 16176
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
const q = async (sql, p = []) => (await pool.query(sql, p)).rows
const sn = (process.argv[2] ?? '16176').replace(/^0+/, '')

console.log('== Colunas status* — em qual tabela ficam? ==')
console.table(await q(`
  select table_name, column_name
  from information_schema.columns
  where table_name in ('teste','testequalidade') and column_name like 'status%'
  order by table_name, column_name`))

console.log(`\n== Linhas do SN ${sn} (tem par em testequalidade?) ==`)
console.table(await q(`
  select t.id, t.datahorainicio, t.status,
         (tq.id is not null) as tem_testequalidade
  from teste t
  left join testequalidade tq on t.id = tq.id
  where regexp_replace(btrim(coalesce(t.numeroserierep,'')),'^0+','') = $1
  order by t.datahorainicio`, [sn]))

console.log('\n== No geral: quantas linhas de teste TÊM x NÃO TÊM par em testequalidade ==')
console.table(await q(`
  select (tq.id is not null) as tem_testequalidade, count(*)
  from teste t left join testequalidade tq on t.id = tq.id
  group by 1 order by 1`))

await pool.end()
