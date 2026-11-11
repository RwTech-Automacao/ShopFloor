import { describe, it, expect } from 'vitest'
import { destinatariosDoTipo, type DestinatarioDisponivel } from '../regra'
import { TIPOS_REGRA } from '../tipos'

const pessoa = (usuarioId: string, administra?: boolean): DestinatarioDisponivel => ({
  usuarioId,
  nome: usuarioId,
  email: `${usuarioId}@x`,
  telegram: true,
  discord: false,
  emailOk: true,
  ...(administra === undefined ? {} : { administra }),
})

const LISTA = [pessoa('admin', true), pessoa('gilania', false), pessoa('antigo')]

describe('responsáveis oferecidos por tipo de regra (0182)', () => {
  it('na regra compels entra também quem só pode usar o Almoxarifado', () => {
    expect(destinatariosDoTipo(LISTA, 'compels').map((d) => d.usuarioId)).toEqual(['admin', 'gilania', 'antigo'])
  })

  it('nos outros tipos, só quem administra o módulo (ausente = administra)', () => {
    for (const tipo of TIPOS_REGRA.filter((t) => t !== 'compels')) {
      expect(destinatariosDoTipo(LISTA, tipo).map((d) => d.usuarioId)).toEqual(['admin', 'antigo'])
    }
  })
})
