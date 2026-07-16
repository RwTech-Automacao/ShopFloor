import type { ArmazenamentoFotos, ModoStorage } from '../../domain/armazenamento-fotos'
import { resolverModoStorage } from '../../domain/armazenamento-fotos'
import { criarArmazenamentoDrive } from './drive'
import { criarArmazenamentoR2 } from './r2'
import { criarArmazenamentoSupabase } from './supabase'

/** Modo de storage ativo (lido da env FOTOS_STORAGE; default 'r2'). */
export function modoStorageFotos(): ModoStorage {
  return resolverModoStorage(process.env.FOTOS_STORAGE)
}

let cache: { modo: ModoStorage; impl: ArmazenamentoFotos } | null = null

/** Adapter de armazenamento ativo. Memoizado por modo. */
export function armazenamentoAtual(): ArmazenamentoFotos {
  const modo = modoStorageFotos()
  if (cache && cache.modo === modo) return cache.impl
  const impl =
    modo === 'supabase'
      ? criarArmazenamentoSupabase()
      : modo === 'drive'
        ? criarArmazenamentoDrive()
        : criarArmazenamentoR2()
  cache = { modo, impl }
  return impl
}
