import { describe, expect, it } from 'vitest'
import { resolverModoStorage } from '../armazenamento-fotos'

describe('resolverModoStorage', () => {
  it("'r2' → r2", () => expect(resolverModoStorage('r2')).toBe('r2'))
  it("'supabase' → supabase", () => expect(resolverModoStorage('supabase')).toBe('supabase'))
  // Default = supabase: é o único backend cujas credenciais sempre existem (o
  // histórico). Um deploy sem FOTOS_STORAGE não pode cair num storage sem credencial.
  it('undefined → supabase (default seguro)', () =>
    expect(resolverModoStorage(undefined)).toBe('supabase'))
  it('vazio → supabase', () => expect(resolverModoStorage('')).toBe('supabase'))
  it('desconhecido → supabase', () => expect(resolverModoStorage('unknown')).toBe('supabase'))
  it('trim + case-insensitive', () => expect(resolverModoStorage('  SUPABASE ')).toBe('supabase'))
  it('trim + case-insensitive r2', () => expect(resolverModoStorage('  R2 ')).toBe('r2'))
  it("'drive' → drive", () => expect(resolverModoStorage('drive')).toBe('drive'))
  it('trim + case-insensitive drive', () => expect(resolverModoStorage('  DRIVE ')).toBe('drive'))
})
