import { createServerSupabase } from '@/shared/lib/supabase/server'
import { armazenamentoAtual } from './armazenamento'

export interface AnexoProcesso {
  id: string
  processoId: string
  path: string
  nomeOriginal: string
  mime: string
  tamanho: number
  criadoEm: string
}

export interface AnexoComUrl extends AnexoProcesso {
  url: string
}

interface AnexoRow {
  id: string
  processo_id: string
  path: string
  nome_original: string
  mime: string
  tamanho: number
  created_at: string
}

const SELECT = 'id, processo_id, path, nome_original, mime, tamanho, created_at'

function mapRow(row: AnexoRow): AnexoProcesso {
  return {
    id: row.id,
    processoId: row.processo_id,
    path: row.path,
    nomeOriginal: row.nome_original,
    mime: row.mime,
    tamanho: row.tamanho,
    criadoEm: row.created_at,
  }
}

/** Lista os anexos (metadados) de um processo, mais antigo → mais novo. */
export async function listarAnexos(processoId: string): Promise<AnexoProcesso[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('anexos_processo')
    .select(SELECT)
    .eq('processo_id', processoId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as AnexoRow[]).map(mapRow)
}

/** Um anexo pelo id (para checar processo/terminal antes de remover). */
export async function buscarAnexo(id: string): Promise<AnexoProcesso | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('anexos_processo')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? mapRow(data as AnexoRow) : null
}

/** Conta os anexos de um processo (para o limite de 3). */
export async function contarAnexos(processoId: string): Promise<number> {
  const supabase = await createServerSupabase()
  const { count, error } = await supabase
    .from('anexos_processo')
    .select('id', { count: 'exact', head: true })
    .eq('processo_id', processoId)
  if (error) throw error
  return count ?? 0
}

/** Signed URL (1 h) para exibir/baixar um objeto do storage ativo. */
export async function gerarUrlAnexo(path: string): Promise<string> {
  return armazenamentoAtual().urlAssinada(path, 3600)
}

/** Lista os anexos de um processo já com signed URL para exibição. */
export async function listarAnexosComUrl(processoId: string): Promise<AnexoComUrl[]> {
  const anexos = await listarAnexos(processoId)
  const comUrl = await Promise.all(
    anexos.map(async (a): Promise<AnexoComUrl | null> => {
      try {
        return { ...a, url: await gerarUrlAnexo(a.path) }
      } catch {
        // Falha ao assinar a URL (ex.: objeto órfão) não pode derrubar a página
        // inteira do processo — apenas omite essa foto da listagem.
        return null
      }
    }),
  )
  return comUrl.filter((a): a is AnexoComUrl => a !== null)
}

/** Sobe um objeto para o storage ativo. A chave é um UUID fresco por upload
 *  (no adapter Supabase, upload duplicado falha; no R2, sobrescreveria). */
export async function subirObjeto(path: string, dados: ArrayBuffer, mime: string): Promise<void> {
  await armazenamentoAtual().subir(path, dados, mime)
}

/** Remove um objeto do storage ativo. */
export async function removerObjeto(path: string): Promise<void> {
  await armazenamentoAtual().remover(path)
}

/** Insere a linha de metadados de um anexo (verifica que 1 linha foi criada). */
export async function inserirAnexoMeta(dados: {
  processoId: string
  path: string
  nomeOriginal: string
  mime: string
  tamanho: number
  criadoPor: string
}): Promise<void> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('anexos_processo')
    .insert({
      processo_id: dados.processoId,
      path: dados.path,
      nome_original: dados.nomeOriginal,
      mime: dados.mime,
      tamanho: dados.tamanho,
      criado_por: dados.criadoPor,
    })
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Não foi possível registrar o anexo (sem permissão).')
  }
}

/** Remove a linha de metadados de um anexo (verifica que 1 linha foi apagada). */
export async function removerAnexoMeta(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('anexos_processo')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Não foi possível remover o anexo (sem permissão ou inexistente).')
  }
}
