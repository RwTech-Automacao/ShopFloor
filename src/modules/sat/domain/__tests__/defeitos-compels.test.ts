import { describe, expect, it } from 'vitest'
import { defeitosDaResposta, sqlDaCargaDeDefeitos } from '../defeitos-compels'

describe('defeitosDaResposta', () => {
  it('usa codigo (ou id) e descricao (ou nome); limpa espaços e quebras; sem repetir código', () => {
    expect(defeitosDaResposta([
      { id: 7, codigo: ' 01 ', descricao: ' NÃO\nLIGA ' },
      { id: 8, nome: 'Display apagado' },
      { id: 9, codigo: '01', descricao: 'repetido' },
    ])).toEqual([
      { codigo: '01', descricao: 'NÃO LIGA' },
      { codigo: '8', descricao: 'Display apagado' },
    ])
  })
  it('linha sem código ou sem descrição: resposta inesperada (com os campos que vieram)', () => {
    expect(() => defeitosDaResposta([{ ativo: true }])).toThrow(/defeito do SAT.*ativo/)
  })
  it('lista vazia: resposta inesperada (o Compels tem 88)', () => {
    expect(() => defeitosDaResposta([])).toThrow(/nenhum defeito/)
  })
})

describe('sqlDaCargaDeDefeitos', () => {
  it('um insert idempotente, com aspas escapadas e o cabeçalho', () => {
    const sql = sqlDaCargaDeDefeitos([{ codigo: '01', descricao: "Cabo d'água" }, { codigo: '02', descricao: 'Tela' }],
      new Date('2026-11-26T15:00:00Z'))
    expect(sql).toContain('-- 2 defeitos lidos do Compels em 2026-11-26T15:00:00.000Z')
    expect(sql).toContain("insert into public.sat_defeitos as d (codigo_compels, descricao) values\n  ('01', 'Cabo d''água'),\n  ('02', 'Tela')\n")
    expect(sql).toContain('on conflict (codigo_compels) do update set descricao = excluded.descricao, atualizado_em = now()')
    expect(sql).toContain('where d.descricao is distinct from excluded.descricao;')
    expect(sql).not.toContain('$$')
  })
})
