export type ModoStorage = 'r2' | 'supabase'

/**
 * Contrato de armazenamento de fotos. O app depende só desta porta; o backend
 * concreto (R2 ativo, Supabase dormente, futuramente S3/Drive) fica atrás dela.
 * A `chave` é o caminho do objeto (hoje `${processoId}/${uuid}.${ext}`).
 */
export interface ArmazenamentoFotos {
  subir(chave: string, dados: ArrayBuffer, mime: string): Promise<void>
  /** URL assinada de curta duração para exibir/baixar (padrão 1 h). */
  urlAssinada(chave: string, segundos?: number): Promise<string>
  remover(chave: string): Promise<void>
}

/** Resolve o modo a partir do valor de env. Default 'r2'; só 'supabase' (após
 *  trim/lowercase) escolhe o plano B; qualquer outra coisa cai em 'r2'. */
export function resolverModoStorage(valor: string | undefined): ModoStorage {
  return valor?.trim().toLowerCase() === 'supabase' ? 'supabase' : 'r2'
}
