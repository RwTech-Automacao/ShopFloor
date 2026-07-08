import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { TipoCampo } from '../domain/regras-campo'

export type GrupoCampo = 'comercial' | 'material' | 'recebimento' | 'qualidade'

export interface CampoRow {
  id: string
  campo: string
  rotulo: string
  grupo: GrupoCampo
  tipo: TipoCampo
  lista_chave: string | null
  origem: string
  obrigatorio_importacao: boolean
  obrigatorio_finalizacao: boolean
  ordem: number
  ativo: boolean
}

// Campos editáveis pela tela de administração. `campo` e `origem` nunca são
// alterados — identificam a coluna do processo de recebimento à qual a
// configuração se refere.
export interface DadosCampo {
  rotulo: string
  tipo: TipoCampo
  lista_chave: string | null
  obrigatorio_importacao: boolean
  obrigatorio_finalizacao: boolean
  ordem: number
  ativo: boolean
}

export async function listarCampos(): Promise<CampoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('configuracao_campos')
    .select('*')
    .order('grupo', { ascending: true })
    .order('ordem', { ascending: true })
  if (error) throw error
  return data as CampoRow[]
}

export async function buscarCampo(id: string): Promise<CampoRow | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('configuracao_campos')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as CampoRow | null) ?? null
}

export async function atualizarCampo(id: string, dados: DadosCampo): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('configuracao_campos').update(dados).eq('id', id)
  if (error) throw error
}
