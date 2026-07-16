import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { ArmazenamentoFotos } from '../../domain/armazenamento-fotos'

const BUCKET = 'anexos-processos'

/** Adapter Supabase Storage — o plano B. Mantém o comportamento atual. */
export function criarArmazenamentoSupabase(): ArmazenamentoFotos {
  return {
    async subir(chave, dados, mime) {
      const supabase = await createServerSupabase()
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(chave, dados, { contentType: mime, upsert: false })
      if (error) throw error
      return chave
    },
    async urlAssinada(chave, segundos = 3600) {
      const supabase = await createServerSupabase()
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(chave, segundos)
      if (error || !data) throw error ?? new Error('Falha ao gerar URL do anexo.')
      return data.signedUrl
    },
    async remover(chave) {
      const supabase = await createServerSupabase()
      const { error } = await supabase.storage.from(BUCKET).remove([chave])
      if (error) throw error
    },
  }
}
