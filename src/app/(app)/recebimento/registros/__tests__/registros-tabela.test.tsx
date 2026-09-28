import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { RegistroRecebimento } from '@/modules/recebimento/infra/registros-repository'
import { RegistrosTabela } from '../registros-tabela'

const ROTULOS = {
  quantidade_recebida: 'Quantidade Recebida',
  volumes: 'Volumes',
  divergencia: 'Divergência',
}

function registro(parcial: Partial<RegistroRecebimento> = {}): RegistroRecebimento {
  return {
    id: 'l1',
    dataHora: '2026-09-24T12:30:00Z', // 09:30 em Brasília
    colaborador: 'João',
    processoId: 'p1',
    numero: 123,
    emb: 'EMB390',
    item: 'CAPJ91',
    descricao: 'CAPACITOR 100uF',
    fornecedor: 'Panasonic',
    fabricante: 'PANA',
    partNumber: 'ECA1HM101',
    passagem: { tipo: 'avanco', de: 'recebimento', para: 'qualidade', resultado: null },
    alteracoes: [
      { campo: 'quantidade_recebida', de: null, para: 490 },
      { campo: 'volumes', de: null, para: 2 },
      { campo: 'divergencia', de: null, para: '-10' },
    ],
    ...parcial,
  }
}

describe('RegistrosTabela', () => {
  it('lista uma linha por movimento, com a hora em Brasília', () => {
    render(<RegistrosTabela linhas={[registro()]} rotulos={ROTULOS} />)
    expect(screen.getByText('24/09/2026, 09:30')).toBeInTheDocument()
    expect(screen.getByText('João')).toBeInTheDocument()
    expect(screen.getByText('CAPACITOR 100uF')).toBeInTheDocument()
    expect(screen.getByText('Panasonic')).toBeInTheDocument()
    expect(screen.getByText('ECA1HM101')).toBeInTheDocument()
    expect(screen.getByText('Recebimento → Qualidade')).toBeInTheDocument()
    // O número do processo desempata o MESMO item duas vezes na mesma EMB.
    expect(screen.getByText('#123')).toBeInTheDocument()
  })

  it('a finalização mostra o resultado entre parênteses', () => {
    render(
      <RegistrosTabela
        linhas={[registro({
          passagem: { tipo: 'avanco', de: 'qualidade', para: 'almoxarifado', resultado: 'Aprovado' },
        })]}
        rotulos={ROTULOS}
      />,
    )
    expect(screen.getByText('Qualidade → Almoxarifado (Aprovado)')).toBeInTheDocument()
  })

  it('clicar na linha abre o que mudou, campo a campo, com o rótulo do campo', () => {
    render(<RegistrosTabela linhas={[registro()]} rotulos={ROTULOS} />)
    fireEvent.click(screen.getByText('CAPACITOR 100uF'))
    expect(screen.getByText('O que mudou')).toBeInTheDocument()
    expect(screen.getByText('Quantidade Recebida')).toBeInTheDocument()
    expect(screen.getByText('490')).toBeInTheDocument()
    expect(screen.getByText('Divergência')).toBeInTheDocument()
    expect(screen.getByText('-10')).toBeInTheDocument()
    // Valor que era vazio sai como travessão, não como "null".
    expect(screen.queryByText('null')).not.toBeInTheDocument()
  })

  it('registro que não alterou campo nenhum diz isso em vez de abrir lista vazia', () => {
    render(<RegistrosTabela linhas={[registro({ alteracoes: [] })]} rotulos={ROTULOS} />)
    fireEvent.click(screen.getByText('CAPACITOR 100uF'))
    expect(screen.getByText('Este registro não alterou campo nenhum.')).toBeInTheDocument()
  })

  it('sem linhas, diz que não há registro em vez de mostrar tabela vazia', () => {
    render(<RegistrosTabela linhas={[]} rotulos={ROTULOS} />)
    expect(screen.getByText('Nenhum registro com esses filtros.')).toBeInTheDocument()
  })
})
