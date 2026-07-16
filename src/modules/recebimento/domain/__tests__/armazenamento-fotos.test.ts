import { describe, expect, it } from 'vitest'
import { resolverModoStorage } from '../armazenamento-fotos'

describe('resolverModoStorage', () => {
  it("'r2' → r2", () => expect(resolverModoStorage('r2')).toBe('r2'))
  it("'supabase' → supabase", () => expect(resolverModoStorage('supabase')).toBe('supabase'))
  it('undefined → r2 (default)', () => expect(resolverModoStorage(undefined)).toBe('r2'))
  it('vazio → r2', () => expect(resolverModoStorage('')).toBe('r2'))
  it('desconhecido → r2', () => expect(resolverModoStorage('unknown')).toBe('r2'))
  it('trim + case-insensitive', () => expect(resolverModoStorage('  SUPABASE ')).toBe('supabase'))
  it("'drive' → drive", () => expect(resolverModoStorage('drive')).toBe('drive'))
  it('trim + case-insensitive drive', () => expect(resolverModoStorage('  DRIVE ')).toBe('drive'))
})
