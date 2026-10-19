import { describe, it, expect, vi, beforeEach } from 'vitest'

// Ordem em que as operações chegam ao banco, para provar que NUNCA se apaga antes de gravar.
const ordem: string[] = []
let erroUpsert: { message: string } | null = null
let atuais: { modulo: string; permissao: string }[] = []
const deletes: { modulo: string; permissoes: string[] }[] = []

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    from: (tabela: string) => {
      expect(tabela).toBe('perfil_permissao')
      return {
        upsert: (linhas: unknown, opcoes: unknown) => {
          ordem.push('upsert')
          expect(opcoes).toEqual({ onConflict: 'perfil_id,modulo,permissao', ignoreDuplicates: true })
          expect(Array.isArray(linhas)).toBe(true)
          return Promise.resolve({ error: erroUpsert })
        },
        select: () => ({
          eq: () => {
            ordem.push('select')
            return Promise.resolve({ data: atuais, error: null })
          },
        }),
        delete: () => {
          ordem.push('delete')
          const alvo = { modulo: '', permissoes: [] as string[] }
          const cadeia = {
            eq: (coluna: string, valor: string) => {
              if (coluna === 'modulo') alvo.modulo = valor
              return cadeia
            },
            in: (_c: string, valores: string[]) => {
              alvo.permissoes = valores
              deletes.push(alvo)
              return Promise.resolve({ error: null })
            },
          }
          return cadeia
        },
      }
    },
  }),
}))

beforeEach(() => {
  ordem.length = 0
  deletes.length = 0
  erroUpsert = null
  atuais = []
})

describe('sincronizarGrants: nunca apaga antes de gravar', () => {
  it('grava primeiro e só depois remove o que foi desmarcado', async () => {
    atuais = [
      { modulo: 'recebimento', permissao: 'visualizar' },
      { modulo: 'recebimento', permissao: 'excluir' },
    ]
    const { sincronizarGrants } = await import('../perfil-repository')
    await sincronizarGrants('p1', [
      { modulo: 'recebimento', permissao: 'visualizar' },
      { modulo: 'recebimento', permissao: 'lancar' },
    ])
    expect(ordem).toEqual(['upsert', 'select', 'delete'])
    expect(deletes).toEqual([{ modulo: 'recebimento', permissoes: ['excluir'] }])
  })

  it('só acrescentar uma permissão não apaga nada (o caso do Lançar no próprio perfil)', async () => {
    atuais = [
      { modulo: 'sistema', permissao: 'administrar' },
      { modulo: 'recebimento', permissao: 'lancar' },
    ]
    const { sincronizarGrants } = await import('../perfil-repository')
    await sincronizarGrants('p1', [
      { modulo: 'sistema', permissao: 'administrar' },
      { modulo: 'recebimento', permissao: 'lancar' },
    ])
    expect(ordem).not.toContain('delete')
  })

  it('se a gravação falhar, nada é apagado e o erro sobe', async () => {
    erroUpsert = { message: 'new row violates row-level security policy' }
    atuais = [{ modulo: 'sistema', permissao: 'administrar' }]
    const { sincronizarGrants } = await import('../perfil-repository')
    await expect(
      sincronizarGrants('p1', [{ modulo: 'recebimento', permissao: 'lancar' }]),
    ).rejects.toEqual(erroUpsert)
    expect(ordem).toEqual(['upsert'])
  })

  it('desmarcar tudo não grava e remove tudo', async () => {
    atuais = [{ modulo: 'setup', permissao: 'visualizar' }]
    const { sincronizarGrants } = await import('../perfil-repository')
    await sincronizarGrants('p1', [])
    expect(ordem).toEqual(['select', 'delete'])
    expect(deletes).toEqual([{ modulo: 'setup', permissoes: ['visualizar'] }])
  })
})
