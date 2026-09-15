// Conector repinmetro → ShopFloor (Supabase).
// Roda na máquina da intranet (mesma do banco repinmetro), via cron.
// Lê o Postgres do repinmetro (usuário read-only) e faz UPSERT idempotente em repinmetro_logs.
// Watermark = MAX(origem_id) no Supabase (retoma sozinho; se um dia não rodar, o próximo recupera).
// Config por variáveis de ambiente (.env) — nunca comitar segredos. Ver README.md.

import pg from 'pg'

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
// Teto de registros por rodada (teste). Vazio = sem limite (espelha tudo).
const MAX = env.REPINMETRO_MAX ? Number(env.REPINMETRO_MAX) : Infinity
// Só espelhar linhas COM número de série (descarta testes sem SN, que não casam com o ShopFloor).
// Liga com REPINMETRO_SO_COM_SN=1.
const SO_COM_SN = env.REPINMETRO_SO_COM_SN === '1' || env.REPINMETRO_SO_COM_SN === 'true'
const FILTRO_SN = SO_COM_SN ? "AND t.numeroserierep IS NOT NULL AND btrim(t.numeroserierep) <> ''" : ''

// Revenda de cada REP (tela REPs/Revendas do sistema de chaves). Liga com REPINMETRO_REVENDA=1 depois
// que o usuário do conector tiver leitura na view — antes disso, ligado, só essa parte falha.
const REVENDA = env.REPINMETRO_REVENDA === '1' || env.REPINMETRO_REVENDA === 'true'
// View criada no banco do repinmetro só com serial, datas e razão social (SEM a chave criptográfica).
const REVENDA_VIEW = env.REPINMETRO_REVENDA_VIEW || 'vw_shopfloor_rep_revenda'
if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(REVENDA_VIEW)) {
  console.error(`REPINMETRO_REVENDA_VIEW inválida: ${REVENDA_VIEW}`)
  process.exit(1)
}
// Serial completo do REP: prefixo fixo 00043 + modelo (5 dígitos) + nº de série (7 dígitos).
const PREFIXO_SERIAL = '00043'

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

// Colunas lidas da origem — SÓ as necessárias (NÃO lê `foto` nem outras não usadas).
// Sem qualificar t./tq. (os nomes são distintos entre as 2 tabelas; o Postgres resolve cada uma);
// só o `id` é ambíguo → `t.id AS origem_id`. Os 15 resultados (RESULTADO_COLS) ficam em testequalidade.
const COLS_TESTE =
  't.id AS origem_id, numeroserierep, serialmodelorep, datahorainicio, datahorafim, ' +
  'status, observacao, remanufaturado, lacre, codigoop, anoop, numeroplacaop'
const SELECT_COLS = `${COLS_TESTE}, ${RESULTADO_COLS.join(', ')}`

// Fala direto com a API REST (PostgREST) do Supabase via fetch nativo — sem a lib
// @supabase/supabase-js (que exige WebSocket/realtime e quebra no Node < 22).
const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/repinmetro_logs`
const REST_REVENDAS = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/repinmetro_revendas`
const HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
  'Content-Type': 'application/json',
}

const pool = new pg.Pool({
  host: env.REPINMETRO_HOST ?? 'localhost',
  port: Number(env.REPINMETRO_PORT ?? '5432'),
  database: obrigatorio('REPINMETRO_DB'),
  user: obrigatorio('REPINMETRO_USER'),
  password: obrigatorio('REPINMETRO_PASSWORD'),
  max: 2,
})

const txt = (v) => (v === null || v === undefined ? null : String(v))

// Mesma regra do app (domain/serie.ts normalizarSerie): sem separadores, sem zeros à esquerda, minúsculo.
// Assim a busca "13976" acha o SN espelhado "0013976".
const norm = (v) => String(v ?? '').replace(/[^A-Za-z0-9]/g, '').replace(/^0+/, '').trim().toLowerCase()

function mapear(row, espelhadoEm) {
  const resultados = {}
  for (const c of RESULTADO_COLS) resultados[c] = row[c] ?? null
  return {
    origem_id: row.origem_id,
    numero_serie: String(row.numeroserierep ?? '').trim(),
    numero_serie_norm: norm(row.numeroserierep),
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
  const res = await fetch(`${REST}?select=origem_id&order=origem_id.desc&limit=1`, { headers: HEADERS })
  if (!res.ok) throw new Error(`Supabase GET ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (Array.isArray(data) && data.length > 0) return Number(data[0].origem_id)
  if (env.REPINMETRO_SINCE != null && env.REPINMETRO_SINCE !== '') return Number(env.REPINMETRO_SINCE)
  const r = await pool.query('SELECT COALESCE(MAX(id), 0) AS m FROM teste')
  return Number(r.rows[0].m)
}

async function upsert(registros) {
  const res = await fetch(`${REST}?on_conflict=origem_id`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(registros),
  })
  if (!res.ok) throw new Error(`Supabase upsert ${res.status}: ${await res.text()}`)
}

/** Separa o serial completo (00043 + modelo + nº de série). Fora do padrão = sem modelo/SN (não casa). */
function separarSerial(serial) {
  const s = String(serial ?? '').trim()
  if (!new RegExp(`^${PREFIXO_SERIAL}\\d{12}$`).test(s)) return { modelo: '', numeroSerie: '' }
  return { modelo: s.slice(5, 10), numeroSerie: s.slice(10) }
}

/**
 * Recarrega a revenda de todos os REPs. A origem não tem data de alteração e a revenda é associada
 * (ou trocada) depois do teste, então a cada rodada tudo é regravado com o mesmo `espelhado_em` e o
 * que não veio nesta rodada (excluído na origem) é apagado no fim.
 */
async function sincronizarRevendas() {
  const { rows } = await pool.query(
    `SELECT numeroserierep, datahora, datahorasaidaexpedicao, razaosocial FROM ${REVENDA_VIEW}`,
  )
  if (rows.length === 0) {
    // Nunca apaga tudo por causa de uma leitura vazia: melhor manter a última foto.
    console.log('Revendas: a origem não devolveu nenhuma linha; nada foi alterado.')
    return
  }
  const espelhadoEm = new Date().toISOString()
  // Um registro por serial (a PK do destino); se repetir, fica a gravação mais recente.
  const porSerial = new Map()
  let foraDoPadrao = 0
  for (const r of rows) {
    const serial = String(r.numeroserierep ?? '').trim()
    if (!serial) continue
    const { modelo, numeroSerie } = separarSerial(serial)
    if (!modelo) foraDoPadrao++
    const registro = {
      numero_serie_completo: serial,
      modelo,
      numero_serie: numeroSerie,
      numero_serie_norm: norm(numeroSerie),
      revenda: txt(r.razaosocial),
      gravada_em: r.datahora ?? null,
      saida_em: r.datahorasaidaexpedicao ?? null,
      espelhado_em: espelhadoEm,
    }
    const atual = porSerial.get(serial)
    if (!atual || new Date(registro.gravada_em ?? 0) >= new Date(atual.gravada_em ?? 0)) porSerial.set(serial, registro)
  }
  const registros = [...porSerial.values()]
  for (let i = 0; i < registros.length; i += LOTE) {
    const res = await fetch(`${REST_REVENDAS}?on_conflict=numero_serie_completo`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(registros.slice(i, i + LOTE)),
    })
    if (!res.ok) throw new Error(`Supabase upsert revendas ${res.status}: ${await res.text()}`)
  }
  const del = await fetch(`${REST_REVENDAS}?espelhado_em=lt.${encodeURIComponent(espelhadoEm)}`, {
    method: 'DELETE',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
  })
  if (!del.ok) throw new Error(`Supabase delete revendas ${del.status}: ${await del.text()}`)
  console.log(
    `Revendas: ${registros.length} REP(s) espelhado(s)` +
      (foraDoPadrao ? ` (${foraDoPadrao} com serial fora do padrão 00043+modelo+SN).` : '.'),
  )
}

async function main() {
  await sincronizarTestes()
  if (REVENDA) await sincronizarRevendas()
  await pool.end()
}

async function sincronizarTestes() {
  // Modo teste: espelha só os N registros MAIS RECENTES (id desc). Ignora watermark.
  const ULTIMOS = env.REPINMETRO_ULTIMOS ? Number(env.REPINMETRO_ULTIMOS) : 0
  if (ULTIMOS > 0) {
    const { rows } = await pool.query(
      `SELECT ${SELECT_COLS} FROM teste t INNER JOIN testequalidade tq ON t.id = tq.id WHERE 1=1 ${FILTRO_SN} ORDER BY t.id DESC LIMIT $1`,
      [ULTIMOS],
    )
    const espelhadoEm = new Date().toISOString()
    await upsert(rows.map((r) => mapear(r, espelhadoEm)))
    console.log(`Espelhados os ${rows.length} registro(s) mais recentes.`)
    return
  }

  let since = await watermark()
  console.log(`Iniciando a partir do id ${since}.`)
  let total = 0
  for (;;) {
    const limite = Math.min(LOTE, MAX - total) // respeita o teto REPINMETRO_MAX
    if (limite <= 0) break
    const { rows } = await pool.query(
      // INNER JOIN: só espelha teste que TEM resultado em testequalidade (igual à busca do legado;
      // 66% das linhas de teste não têm par e apareciam vazias). Lê só as colunas necessárias (SELECT_COLS).
      `SELECT ${SELECT_COLS} FROM teste t INNER JOIN testequalidade tq ON t.id = tq.id WHERE t.id > $1 ${FILTRO_SN} ORDER BY t.id ASC LIMIT $2`,
      [since, limite],
    )
    if (rows.length === 0) break
    const espelhadoEm = new Date().toISOString()
    const registros = rows.map((r) => mapear(r, espelhadoEm))
    await upsert(registros)
    total += registros.length
    since = rows[rows.length - 1].origem_id
    console.log(`Espelhados ${total} (até id ${since}).`)
    if (rows.length < limite) break
  }
  console.log(`Concluído: ${total} registro(s) novo(s).`)
}

main().catch(async (e) => {
  console.error('Erro no conector:', e)
  try {
    await pool.end()
  } catch {}
  process.exit(1)
})
