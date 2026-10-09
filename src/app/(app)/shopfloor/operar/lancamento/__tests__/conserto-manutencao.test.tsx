import type * as React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import type { OrdemLancamentoLista } from '@/modules/shopfloor/infra/lancamento-repository'

// Ações de servidor: o que importa aqui é O QUE a tela pede e O QUE ela grava.
const mocks = vi.hoisted(() => ({
  lancar: vi.fn(),
  verificarConsertoManutencao: vi.fn(),
  verificarConserto: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/lancar-action', () => ({
  lancar: (...a: unknown[]) => mocks.lancar(...a),
  lancarLote: vi.fn(),
  buscarEntradaBurnin: vi.fn(),
  verificarConserto: (...a: unknown[]) => mocks.verificarConserto(...a),
  verificarConsertoManutencao: (...a: unknown[]) => mocks.verificarConsertoManutencao(...a),
  contarLancadosPosto: vi.fn().mockResolvedValue(0),
  carregarLotePendente: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/shared/lib/som-erro', () => ({ tocarErro: vi.fn() }))

// Select nativo no lugar do Base UI (portal/floating-ui não funcionam em jsdom).
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, disabled }: { value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode; disabled?: boolean }) => (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onValueChange?.(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
}))
// Modais de defeito/reprova: botões mínimos que entregam um defeito.
vi.mock('../defeito-modal', () => ({
  DefeitoModal: ({ aberto, onEscolher }: { aberto: boolean; onEscolher: (c: string) => void }) =>
    aberto ? <button onClick={() => onEscolher('D1')}>escolher-D1</button> : null,
}))
vi.mock('../reprovar-modal', () => ({
  ReprovarModal: ({ aberto, onConfirmar }: { aberto: boolean; onConfirmar: (d: { defeitos: { codigo: string; posicao: string }[]; sn: string }) => void }) =>
    aberto ? <button onClick={() => onConfirmar({ defeitos: [{ codigo: 'D1', posicao: 'R1' }], sn: 'SN100' })}>reprovar-ok</button> : null,
}))

import { LancamentoForm } from '../lancamento-form'

const ORDEM: OrdemLancamentoLista = {
  cliente: 'ACME', pmo: 'PMO1', op: 'OP1', descricao: 'Placa', qtd: 10, sn_ini: 'SN100', sn_fim: 'SN199',
  embalagem_individual: false, status: 'ATIVA', postos: ['Inspeção PTH', 'Montagem'], receitaPorPosto: {}, tempoBurninPorPosto: {},
}
const PERFIL_SCANNER: PerfilPosto = { chave: 'inspecao', nome: 'Inspeção', temStatus: true, reprova: 'defeitos', gate: 'registrado', exigeManutencao: false, recurso: 'nenhum' }
// Perfil com Status manual (sem scanner de defeito) → cai no caminho do FORMULÁRIO (onEnviar).
const PERFIL_FORM: PerfilPosto = { chave: 'manual', nome: 'Manual', temStatus: true, reprova: 'nenhum', gate: 'registrado', exigeManutencao: true, recurso: 'nenhum' }
// exigeManutencao=true também desliga o modal de conserto IRMÃO (perfilPedeConfirmacaoConserto),
// pra que só o modal da Manutenção possa aparecer nestes testes.
const PERFIL_SCANNER_SEM_IRMAO: PerfilPosto = { ...PERFIL_SCANNER, exigeManutencao: true }

// Perfis que satisfazem os DOIS diálogos (destino de rota + perfilPedeConfirmacaoConserto).
// Formulário: reprova por posições (SPI) não é scanner e não exige Manutenção. Leitor: PERFIL_SCANNER.
const PERFIL_FORM_COM_IRMAO: PerfilPosto = { ...PERFIL_FORM, reprova: 'posicoes', exigeManutencao: false }
const DEFEITOS_IRMAO = [{ codigo: 'D9', posicao: 'R9', tipo: 'PTH' }]

const CONSERTOS = [{ conserto: 'Ressolda', posicao: 'R12' }]

function montar(perfil: PerfilPosto, destinos: string[]) {
  render(
    <LancamentoForm
      ordens={[ORDEM]}
      defeitos={[{ codigo: 'D1', tipo: 1 }]}
      postosPerfil={{ 'Inspeção PTH': perfil, Montagem: perfil }}
      postosColetivo={{}}
      postosRotaDestino={destinos}
    />,
  )
}

/** O Select é nativo aqui; acha-se pelo conteúdo (a ordem no DOM não é a da tela). */
const selectComOpcao = (texto: string) =>
  screen.getAllByRole('combobox').find((el) => within(el).queryByText(texto)) as HTMLSelectElement

/** Carrega a OP pelo SN, preenche Colaborador e escolhe o posto. */
async function entrarNoPosto(posto: string) {
  fireEvent.change(screen.getByLabelText(/Bipe o Nº de Série para carregar a OP/), { target: { value: 'SN100' } })
  fireEvent.keyDown(screen.getByLabelText(/Bipe o Nº de Série para carregar a OP/), { key: 'Enter' })
  await waitFor(() => expect(screen.getByLabelText('Colaborador')).toBeInTheDocument())
  fireEvent.change(screen.getByLabelText('Colaborador'), { target: { value: 'Joao' } })
  fireEvent.change(selectComOpcao('Montagem'), { target: { value: posto } })
  await waitFor(() => expect(screen.getByLabelText(/Nº de Série/)).toBeInTheDocument())
}
const campoSn = () => screen.getByLabelText(/Nº de Série/) as HTMLInputElement

/** Caminho do LEITOR: bipa o SN, bipa de novo no AprovarModal. */
async function aprovarPeloLeitor() {
  fireEvent.change(campoSn(), { target: { value: 'SN100' } })
  fireEvent.keyDown(campoSn(), { key: 'Enter' })
  const confirma = await screen.findByLabelText(/Bipe o SN de novo/)
  fireEvent.change(confirma, { target: { value: 'SN100' } })
  fireEvent.keyDown(confirma, { key: 'Enter' })
}
/** Caminho do FORMULÁRIO: SN + Status Aprovado + Enviar. */
async function aprovarPeloFormulario() {
  fireEvent.change(campoSn(), { target: { value: 'SN100' } })
  fireEvent.change(selectComOpcao('Aprovado'), { target: { value: 'Aprovado' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
}
const clicarNoDialogo = (nome: RegExp) => fireEvent.click(screen.getByRole('button', { name: nome }))

beforeEach(() => {
  mocks.lancar.mockReset().mockResolvedValue({ ok: true })
  mocks.verificarConsertoManutencao.mockReset().mockResolvedValue(CONSERTOS)
  mocks.verificarConserto.mockReset().mockResolvedValue(null)
  try { localStorage.clear() } catch { /* sem storage */ }
})

describe('confirmação dos consertos da Manutenção', () => {
  it('caminho do FORMULÁRIO: aprovar no posto da rota abre o modal com os consertos', async () => {
    montar(PERFIL_FORM, ['Inspeção PTH'])
    await entrarNoPosto('Inspeção PTH')
    await aprovarPeloFormulario()
    expect(await screen.findByText(/Ressolda/)).toBeInTheDocument()
    expect(await screen.findByText(/R12/)).toBeInTheDocument()
    expect(mocks.verificarConsertoManutencao).toHaveBeenCalledWith('PMO1', 'OP1', 'SN100', 'Inspeção PTH')
    expect(mocks.lancar).not.toHaveBeenCalled() // só grava depois do "sim"
  })

  it('caminho do LEITOR: aprovar no posto da rota abre o modal com os consertos', async () => {
    montar(PERFIL_SCANNER_SEM_IRMAO, ['Inspeção PTH'])
    await entrarNoPosto('Inspeção PTH')
    await aprovarPeloLeitor()
    expect(await screen.findByText(/Ressolda/)).toBeInTheDocument()
    expect(await screen.findByText(/R12/)).toBeInTheDocument()
    expect(mocks.verificarConsertoManutencao).toHaveBeenCalledWith('PMO1', 'OP1', 'SN100', 'Inspeção PTH')
    expect(mocks.lancar).not.toHaveBeenCalled()
  })

  it('FORMULÁRIO: confirmar grava a trilha com os consertos', async () => {
    montar(PERFIL_FORM, ['Inspeção PTH'])
    await entrarNoPosto('Inspeção PTH')
    await aprovarPeloFormulario()
    await screen.findByText(/Ressolda/)
    clicarNoDialogo(/Sim, confirmo/)
    await waitFor(() => expect(mocks.lancar).toHaveBeenCalledTimes(1))
    expect(mocks.lancar).toHaveBeenCalledWith(
      expect.objectContaining({ posto: 'Inspeção PTH', numeroSerie: 'SN100', status: 'Aprovado', consertoManutencaoConfirmado: CONSERTOS }),
    )
  })

  it('LEITOR: confirmar grava a trilha com os consertos', async () => {
    montar(PERFIL_SCANNER_SEM_IRMAO, ['Inspeção PTH'])
    await entrarNoPosto('Inspeção PTH')
    await aprovarPeloLeitor()
    await screen.findByText(/Ressolda/)
    clicarNoDialogo(/Sim, confirmo/)
    await waitFor(() => expect(mocks.lancar).toHaveBeenCalledTimes(1))
    expect(mocks.lancar).toHaveBeenCalledWith(
      expect.objectContaining({ posto: 'Inspeção PTH', numeroSerie: 'SN100', status: 'Aprovado', consertoManutencaoConfirmado: CONSERTOS }),
    )
  })

  it('FORMULÁRIO: cancelar NÃO grava, limpa a peça e destrava o campo', async () => {
    montar(PERFIL_FORM, ['Inspeção PTH'])
    await entrarNoPosto('Inspeção PTH')
    await aprovarPeloFormulario()
    await screen.findByText(/Ressolda/)
    clicarNoDialogo(/Cancelar/)
    await waitFor(() => expect(campoSn()).toHaveValue(''))
    expect(campoSn()).toBeEnabled()
    expect(mocks.lancar).not.toHaveBeenCalled()
  })

  it('LEITOR: cancelar NÃO grava, limpa a peça e destrava o campo', async () => {
    montar(PERFIL_SCANNER_SEM_IRMAO, ['Inspeção PTH'])
    await entrarNoPosto('Inspeção PTH')
    await aprovarPeloLeitor()
    await screen.findByText(/Ressolda/)
    clicarNoDialogo(/Cancelar/)
    await waitFor(() => expect(campoSn()).toHaveValue(''))
    expect(campoSn()).toBeEnabled()
    expect(mocks.lancar).not.toHaveBeenCalled()
  })

  it('posto que NÃO é destino de rota não chama a ação (nos dois caminhos)', async () => {
    montar(PERFIL_FORM, ['Outro posto'])
    await entrarNoPosto('Inspeção PTH')
    await aprovarPeloFormulario()
    await waitFor(() => expect(mocks.lancar).toHaveBeenCalledTimes(1))
    expect(mocks.verificarConsertoManutencao).not.toHaveBeenCalled()
    expect(mocks.lancar.mock.calls[0]![0]).not.toHaveProperty('consertoManutencaoConfirmado', expect.anything())
  })

  it('LEITOR: posto que NÃO é destino de rota não chama a ação', async () => {
    montar(PERFIL_SCANNER_SEM_IRMAO, [])
    await entrarNoPosto('Inspeção PTH')
    await aprovarPeloLeitor()
    await waitFor(() => expect(mocks.lancar).toHaveBeenCalledTimes(1))
    expect(mocks.verificarConsertoManutencao).not.toHaveBeenCalled()
  })

  it('FORMULÁRIO: REPROVAR no posto da rota não abre o modal', async () => {
    montar(PERFIL_FORM, ['Inspeção PTH'])
    await entrarNoPosto('Inspeção PTH')
    fireEvent.change(campoSn(), { target: { value: 'SN100' } })
    fireEvent.change(selectComOpcao('Aprovado'), { target: { value: 'Reprovado' } })
    fireEvent.click(await screen.findByRole('button', { name: /Escolher defeito/ }))
    fireEvent.click(await screen.findByText('escolher-D1'))
    fireEvent.change(screen.getByPlaceholderText('Posição'), { target: { value: 'R1' } })
    fireEvent.change(selectComOpcao('Funcional'), { target: { value: 'PTH' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(mocks.lancar).toHaveBeenCalledTimes(1))
    expect(mocks.lancar).toHaveBeenCalledWith(expect.objectContaining({ status: 'Reprovado' }))
    expect(mocks.verificarConsertoManutencao).not.toHaveBeenCalled()
  })

  it('LEITOR: REPROVAR no posto da rota não abre o modal', async () => {
    montar(PERFIL_SCANNER_SEM_IRMAO, ['Inspeção PTH'])
    await entrarNoPosto('Inspeção PTH')
    fireEvent.click(screen.getByRole('button', { name: /Reprovar/ }))
    fireEvent.click(await screen.findByText('escolher-D1'))
    fireEvent.click(await screen.findByText('reprovar-ok'))
    await waitFor(() => expect(mocks.lancar).toHaveBeenCalledTimes(1))
    expect(mocks.lancar).toHaveBeenCalledWith(expect.objectContaining({ status: 'Reprovado' }))
    expect(mocks.verificarConsertoManutencao).not.toHaveBeenCalled()
  })

  it('a peça não veio da Manutenção (ação devolve null) → aprova direto, sem modal — nos dois caminhos', async () => {
    mocks.verificarConsertoManutencao.mockResolvedValue(null)
    montar(PERFIL_FORM, ['Inspeção PTH'])
    await entrarNoPosto('Inspeção PTH')
    await aprovarPeloFormulario()
    await waitFor(() => expect(mocks.lancar).toHaveBeenCalledTimes(1))
    expect(mocks.verificarConsertoManutencao).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Confirmar os consertos/)).not.toBeInTheDocument()
  })

  it('LEITOR: a peça não veio da Manutenção (null) → aprova direto, sem modal', async () => {
    mocks.verificarConsertoManutencao.mockResolvedValue(null)
    montar(PERFIL_SCANNER_SEM_IRMAO, ['Inspeção PTH'])
    await entrarNoPosto('Inspeção PTH')
    await aprovarPeloLeitor()
    await waitFor(() => expect(mocks.lancar).toHaveBeenCalledTimes(1))
    expect(mocks.verificarConsertoManutencao).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Confirmar os consertos/)).not.toBeInTheDocument()
  })

  describe('o diálogo do irmão CALA quando o da Manutenção vai falar', () => {
    const casos = [
      { nome: 'FORMULÁRIO', perfil: PERFIL_FORM_COM_IRMAO, aprovar: aprovarPeloFormulario },
      { nome: 'LEITOR', perfil: PERFIL_SCANNER, aprovar: aprovarPeloLeitor },
    ]
    for (const c of casos) {
      it(`${c.nome}: peça vinda da Manutenção → só o diálogo novo; verificarConserto nem é chamada; trilha só da Manutenção`, async () => {
        mocks.verificarConserto.mockResolvedValue(DEFEITOS_IRMAO)
        montar(c.perfil, ['Inspeção PTH'])
        await entrarNoPosto('Inspeção PTH')
        await c.aprovar()
        expect(await screen.findByText(/Confirmar os consertos da Manutenção/)).toBeInTheDocument()
        expect(screen.queryByText(/Confirmar conserto do defeito/)).not.toBeInTheDocument()
        expect(mocks.verificarConserto).not.toHaveBeenCalled()
        clicarNoDialogo(/Sim, confirmo/)
        await waitFor(() => expect(mocks.lancar).toHaveBeenCalledTimes(1))
        // ainda sem diálogo do irmão depois do "sim", e a consulta dele nunca aconteceu
        expect(screen.queryByText(/Confirmar conserto do defeito/)).not.toBeInTheDocument()
        expect(mocks.verificarConserto).not.toHaveBeenCalled()
        expect(mocks.verificarConsertoManutencao).toHaveBeenCalledTimes(1)
        expect(mocks.verificarConsertoManutencao).toHaveBeenCalledWith('PMO1', 'OP1', 'SN100', 'Inspeção PTH')
        const enviado = mocks.lancar.mock.calls[0]![0]
        expect(enviado.consertoManutencaoConfirmado).toEqual(CONSERTOS)
        expect(enviado.conservoConfirmado).toBeUndefined()
      })

      it(`${c.nome}: peça que não veio da Manutenção (null) → só o diálogo do irmão, como hoje`, async () => {
        mocks.verificarConsertoManutencao.mockResolvedValue(null)
        mocks.verificarConserto.mockResolvedValue(DEFEITOS_IRMAO)
        montar(c.perfil, ['Inspeção PTH'])
        await entrarNoPosto('Inspeção PTH')
        await c.aprovar()
        expect(await screen.findByText(/Confirmar conserto do defeito/)).toBeInTheDocument()
        expect(screen.queryByText(/Confirmar os consertos da Manutenção/)).not.toBeInTheDocument()
        expect(mocks.verificarConserto).toHaveBeenCalledTimes(1)
        expect(mocks.verificarConserto).toHaveBeenCalledWith('PMO1', 'OP1', 'SN100', 'Inspeção PTH')
        clicarNoDialogo(/Sim, foi consertado/)
        await waitFor(() => expect(mocks.lancar).toHaveBeenCalledTimes(1))
        const enviado = mocks.lancar.mock.calls[0]![0]
        expect(enviado.conservoConfirmado).toEqual(DEFEITOS_IRMAO)
        expect(enviado.consertoManutencaoConfirmado).toBeUndefined()
      })
    }
  })
})
