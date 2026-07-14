import { createServiceSupabase } from '@/shared/lib/supabase/service'
import { extensaoDoMime } from '../domain/anexo'

const BUCKET = 'anexos-processos'

export interface MesAnexos {
  chave: string
  total: number
}

export interface FotoExport {
  signedUrl: string
  pedido: string
  item: string
  numero: number
  indice: number
  ext: string
}

interface MesRow {
  chave: string
  total: number
}

interface FotoRow {
  id: string
  path: string
  mime: string
  numero: number
  numero_pedido: string | null
  codigo_material: string | null
}

/** Meses (por data de chegada) que têm fotos, com a contagem. */
export async function listarMesesAnexos(): Promise<MesAnexos[]> {
  const supabase = createServiceSupabase()
  const { data, error } = await supabase.rpc('anexos_meses')
  if (error) throw error
  return ((data ?? []) as MesRow[]).map((r) => ({ chave: r.chave, total: Number(r.total) }))
}

/** Deriva a extensão do arquivo a partir do mime (preferido) ou do path. */
function derivarExt(mime: string, path: string): string {
  return extensaoDoMime(mime) ?? path.split('.').pop() ?? 'jpg'
}

/**
 * Fotos de um mês, cada uma com signed URL (1 h) e os dados do rename. O
 * `indice` é a posição da foto dentro do processo (1..N), estável pela ordem
 * da RPC (numero, created_at). Fotos cuja signed URL falhar são omitidas.
 */
export async function listarFotosDoMes(mes: string): Promise<FotoExport[]> {
  const supabase = createServiceSupabase()
  const { data, error } = await supabase.rpc('anexos_do_mes', { p_mes: mes })
  if (error) throw error
  const rows = (data ?? []) as FotoRow[]

  const indicePorProcesso = new Map<number, number>()
  const fotos: FotoExport[] = []
  for (const row of rows) {
    const indice = (indicePorProcesso.get(row.numero) ?? 0) + 1
    indicePorProcesso.set(row.numero, indice)

    const { data: urlData, error: urlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.path, 3600)
    if (urlError || !urlData) continue // resiliente: omite a foto sem URL

    fotos.push({
      signedUrl: urlData.signedUrl,
      pedido: row.numero_pedido ?? '',
      item: row.codigo_material ?? '',
      numero: row.numero,
      indice,
      ext: derivarExt(row.mime, row.path),
    })
  }
  return fotos
}

/** Apaga do Storage e da tabela todas as fotos de um mês. Retorna a quantidade removida. */
export async function limparFotosDoMes(mes: string): Promise<number> {
  const supabase = createServiceSupabase()
  const { data, error } = await supabase.rpc('anexos_do_mes', { p_mes: mes })
  if (error) throw error
  const rows = (data ?? []) as FotoRow[]
  if (rows.length === 0) return 0

  const paths = rows.map((r) => r.path)
  const ids = rows.map((r) => r.id)

  const { error: remErr } = await supabase.storage.from(BUCKET).remove(paths)
  if (remErr) throw remErr
  const { error: delErr } = await supabase.from('anexos_processo').delete().in('id', ids)
  if (delErr) throw delErr
  return ids.length
}
