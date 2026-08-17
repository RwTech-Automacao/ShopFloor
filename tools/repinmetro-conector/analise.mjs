// Estudo dos dados do repinmetro (leitura pura no source). Uso: node --env-file=.env analise.mjs
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
const q = async (sql) => (await pool.query(sql)).rows
const SN = "btrim(coalesce(numeroserierep,''))" // SN sem espaços

console.log('== TOTAIS ==')
console.table(await q(`
  select count(*) total,
         count(*) filter (where ${SN} <> '') com_sn,
         count(*) filter (where ${SN} = '') sem_sn,
         count(distinct nullif(${SN},'')) sns_distintos
  from teste`))

console.log('\n== SN distintos: BRUTO vs NORMALIZADO (detecta variação de zero à esquerda) ==')
console.table(await q(`
  select count(distinct ${SN}) bruto,
         count(distinct regexp_replace(regexp_replace(lower(${SN}),'[^a-z0-9]','','g'),'^0+','')) normalizado
  from teste where ${SN} <> ''`))

console.log('\n== DISTRIBUIÇÃO: quantos SNs aparecem N vezes ==')
console.table(await q(`
  select vezes, count(*) qtd_sns
  from (select ${SN} sn, count(*) vezes from teste where ${SN} <> '' group by 1) t
  group by vezes order by vezes`))

console.log('\n== TOP 15 SNs mais repetidos ==')
console.table(await q(`
  select ${SN} sn, count(*) vezes from teste where ${SN} <> '' group by 1 order by vezes desc limit 15`))

console.log('\n== STATUS — todas as linhas ==')
console.table(await q(`select coalesce(nullif(btrim(status),''),'(vazio)') status, count(*) from teste group by 1 order by 2 desc`))

console.log('\n== STATUS — linhas SEM SN ==')
console.table(await q(`select coalesce(nullif(btrim(status),''),'(vazio)') status, count(*) from teste where ${SN} = '' group by 1 order by 2 desc`))

console.log('\n== STATUS — linhas COM SN ==')
console.table(await q(`select coalesce(nullif(btrim(status),''),'(vazio)') status, count(*) from teste where ${SN} <> '' group by 1 order by 2 desc`))

await pool.end()
