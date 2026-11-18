import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { SituacaoNf } from '@/modules/sat/domain/entrada'
import type { MotivoNf } from '@/modules/sat/infra/repository'
import { SituacaoNfCampos } from '../situacao-nf'

const OPCOES: MotivoNf[] = [
  { id: 'sem', texto: 'Sem nota fiscal (só declaração dos Correios)', ativo: true, ordem: 1, exigeTexto: false },
  { id: 'cfop', texto: 'CFOP errado', ativo: true, ordem: 2, exigeTexto: false },
  { id: 'velho', texto: 'Motivo desativado', ativo: false, ordem: null, exigeTexto: false },
  { id: 'outro', texto: 'Outro', ativo: true, ordem: 6, exigeTexto: true },
]

function Campos({ opcoes = OPCOES }: { opcoes?: MotivoNf[] }) {
  const [situacao, setSituacao] = useState<SituacaoNf>('reprovada')
  const [motivos, setMotivos] = useState<string[]>([])
  const [outro, setOutro] = useState('')
  return (
    <>
      <SituacaoNfCampos
        nome="t" situacao={situacao} motivos={motivos} outro={outro} opcoes={opcoes}
        onSituacao={setSituacao} onMotivos={setMotivos} onOutro={setOutro}
      />
      <output data-testid="estado">{JSON.stringify({ motivos, outro })}</output>
    </>
  )
}

describe('SituacaoNfCampos', () => {
  it('lista os motivos ativos na ordem recebida', () => {
    render(<Campos />)
    expect(screen.getAllByRole('checkbox').map((c) => c.closest('label')?.textContent))
      .toEqual(['Sem nota fiscal (só declaração dos Correios)', 'CFOP errado', 'Outro'])
  })

  it('"Qual?" só aparece com o "Outro" marcado, e é obrigatório', () => {
    render(<Campos />)
    expect(screen.queryByLabelText(/Qual\?/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'CFOP errado' }))
    expect(screen.queryByLabelText(/Qual\?/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Outro' }))
    const qual = screen.getByLabelText(/Qual\?/)
    expect(qual).toBeRequired()
    expect(qual).toHaveAttribute('maxlength', '200')
    fireEvent.change(qual, { target: { value: 'nota rasurada' } })
    expect(screen.getByTestId('estado')).toHaveTextContent('{"motivos":["cfop","outro"],"outro":"nota rasurada"}')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Outro' }))
    expect(screen.queryByLabelText(/Qual\?/)).not.toBeInTheDocument()
  })

  it('sem motivo ativo: avisa que não há motivo cadastrado', () => {
    render(<Campos opcoes={[]} />)
    expect(screen.getByText('Nenhum motivo de reprovação cadastrado ainda.')).toBeInTheDocument()
  })
})
