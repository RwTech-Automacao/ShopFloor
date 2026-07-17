export type ModoStorage = 'r2' | 'supabase' | 'drive'

/**
 * Contrato de armazenamento de fotos. O app depende só desta porta; o backend
 * concreto (R2 ativo, Supabase dormente, futuramente S3/Drive) fica atrás dela.
 * A `chave` é o caminho do objeto (hoje `${processoId}/${uuid}.${ext}`).
 */
export interface ArmazenamentoFotos {
  /** Sobe a foto e devolve a CHAVE a persistir no banco.
   *  R2/Supabase: a própria `chave` recebida. Drive: o file ID gerado. */
  subir(chave: string, dados: ArrayBuffer, mime: string): Promise<string>
  /** URL assinada de curta duração para exibir/baixar (padrão 1 h). */
  urlAssinada(chave: string, segundos?: number): Promise<string>
  remover(chave: string): Promise<void>
}

/**
 * Resolve o modo a partir do valor de env (trim/lowercase). 'r2' e 'drive' exigem
 * opt-in EXPLÍCITO, porque dependem de credenciais próprias.
 *
 * Default = 'supabase': é o storage histórico e o único cujas credenciais sempre
 * existem em qualquer ambiente. Um deploy sem `FOTOS_STORAGE` cairia num backend
 * sem credencial e quebraria as fotos — então o default tem que ser o que funciona
 * sem configuração extra.
 */
export function resolverModoStorage(valor: string | undefined): ModoStorage {
  const v = valor?.trim().toLowerCase()
  if (v === 'r2') return 'r2'
  if (v === 'drive') return 'drive'
  return 'supabase'
}
