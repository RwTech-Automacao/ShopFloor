import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import * as acoes from '@/modules/sat/application/ordens-actions'
import { Manutencao, type ManutencaoProps } from '../manutencao'

vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
const ok = vi.hoisted(() => ({ ok: true, valor: null }))
vi.mock('@/modules/sat/application/ordens-actions', () => ({
  iniciarManutencaoAction: vi.fn(async () => ok), adicionarDefeitoAction: vi.fn(async () => ok),
  removerDefeitoAction: vi.fn(async () => ok), adicionarPecaAction: vi.fn(async () => ok),
  removerPecaAction: vi.fn(async () => ok), salvarLaudoAction: vi.fn(async () => ok),
  trocarNsAction: vi.fn(async () => ok), enviarQualidadeAction: vi.fn(async () => ok),
}))
vi.mock('../seletor-pecas', () => ({
  SeletorPecas: ({ onEscolher }: { onEscolher: (p: { codigo: string; descricao: string }) => void }) =>
    <button onClick={() => onEscolher({ codigo: 'PMOE74', descricao: 'Kit Camabio' })}>escolher kit</button>,
}))

const OS = '00000000-0000-0000-0000-0000000000a1'
const D1 = '00000000-0000-0000-0000-0000000000d1'
const base: ManutencaoProps = {
  ordemId: OS, etapa: 'em_manutencao', tipo: 'em_garantia', podeManutencao: true, laudo: '',
  defeitos: [{ id: 'x1', defeitoId: D1, descricao: 'Não liga', origem: 'manutencao', solucao: 'Trocada a fonte', usuarioNome: 'Rita', em: '' }],
  pecas: [{ id: 'p1', codigo: 'FT100', descricao: 'FONTE', quantidade: 1, situacao: 'trocada', usuarioNome: 'Rita', em: '' }],
  defeitosAtivos: [{ id: D1, descricao: 'Não liga', codigoCompels: '1' }],
}
beforeEach(() => vi.clearAllMocks())

describe('Manutencao', () => {
  it('disponível + sat.manutencao: só o botão de abrir a manutenção', async () => {
    render(<Manutencao {...base} etapa="disponivel" defeitos={[]} pecas={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar manutenção' }))
    await waitFor(() => expect(acoes.iniciarManutencaoAction).toHaveBeenCalledWith(OS))
    expect(screen.queryByRole('button', { name: 'Enviar para a qualidade' })).toBeNull()
  })
  it('sem sat.manutencao: só leitura', () => {
    render(<Manutencao {...base} podeManutencao={false} laudo="Fonte queimada" />)
    expect(screen.getByText('Não liga')).toBeInTheDocument()
    expect(screen.getByText('Fonte queimada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lançar defeito' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remover' })).toBeNull()
  })
  it('lança defeito com a solução', async () => {
    render(<Manutencao {...base} />)
    fireEvent.change(screen.getByLabelText('Defeito'), { target: { value: D1 } })
    fireEvent.change(screen.getByLabelText('Solução'), { target: { value: 'Trocado o cabo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lançar defeito' }))
    await waitFor(() => expect(acoes.adicionarDefeitoAction).toHaveBeenCalledWith(OS, D1, 'Trocado o cabo'))
  })
  it('escolhe a peça na lista e lança com a quantidade', async () => {
    render(<Manutencao {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'escolher kit' }))
    expect(screen.getByLabelText('Código do item')).toHaveValue('PMOE74')
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lançar peça' }))
    await waitFor(() => expect(acoes.adicionarPecaAction).toHaveBeenCalledWith(OS, { codigo: 'PMOE74', descricao: 'Kit Camabio', quantidade: '2' }))
  })
  // um render por ação: enquanto a ação roda, os botões ficam desabilitados (useTransition)
  it('remove a peça (o 2º "Remover": o 1º é do defeito)', async () => {
    render(<Manutencao {...base} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remover' })[1]!)
    await waitFor(() => expect(acoes.removerPecaAction).toHaveBeenCalledWith(OS, 'p1'))
  })
  it('salva o laudo', async () => {
    render(<Manutencao {...base} />)
    fireEvent.change(screen.getByLabelText('Laudo'), { target: { value: 'Fonte queimada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar laudo' }))
    await waitFor(() => expect(acoes.salvarLaudoAction).toHaveBeenCalledWith(OS, 'Fonte queimada'))
  })
  it('troca o NS', async () => {
    render(<Manutencao {...base} />)
    fireEvent.change(screen.getByLabelText('Número de série novo'), { target: { value: '562-99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Trocar NS' }))
    await waitFor(() => expect(acoes.trocarNsAction).toHaveBeenCalledWith(OS, '562-99'))
  })
  it('envia para a qualidade', async () => {
    render(<Manutencao {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para a qualidade' }))
    await waitFor(() => expect(acoes.enviarQualidadeAction).toHaveBeenCalledWith(OS))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Enviada para a qualidade.'))
  })
  it('fora da garantia: envia para a qualidade como em garantia, sem aviso de bloqueio', async () => {
    render(<Manutencao {...base} tipo="fora_garantia" />)
    expect(screen.queryByText(/Fora da garantia:/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para a qualidade' }))
    await waitFor(() => expect(acoes.enviarQualidadeAction).toHaveBeenCalledWith(OS))
  })
})
