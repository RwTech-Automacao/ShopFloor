import type * as React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import type { PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import type { OrdemLancamentoLista } from '@/modules/shopfloor/infra/lancamento-repository'

/**
 * O bipe do cabeçalho em OP finalizada (adendo de 09/10/2026 da spec
 * `docs/superpowers/specs/2026-10-08-finalizar-op-automatico-design.md`).
 *
 * O que se observa aqui é o que o operador vê: ou o cabeçalho CARREGA (aparece o Colaborador e a
 * descrição da OP), ou ele NÃO carrega e sobra o campo de bipe com uma mensagem de erro.
 */

vi.mock('@/modules/shopfloor/application/lancar-action', () => ({
  lancar: vi.fn(),
  lancarLote: vi.fn(),
  buscarEntradaBurnin: vi.fn(),
  verificarConserto: vi.fn().mockResolvedValue(null),
  verificarConsertoManutencao: vi.fn().mockResolvedValue([]),
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

import { LancamentoForm } from '../lancamento-form'

const PERFIL: PerfilPosto = { chave: 'inspecao', nome: 'Inspeção', temStatus: true, reprova: 'defeitos', gate: 'registrado', exigeManutencao: false, recurso: 'nenhum' }

function ordem(pmo: string, op: string, status: string, snIni: string, snFim: string, descricao: string): OrdemLancamentoLista {
  return {
    cliente: 'ACME', pmo, op, descricao, qtd: 10, sn_ini: snIni, sn_fim: snFim,
    embalagem_individual: false, status, postos: ['Montagem'], receitaPorPosto: {}, tempoBurninPorPosto: {},
  }
}

const ATIVA = ordem('PMOA', '8801', 'ATIVA', 'A100', 'A199', 'Placa da OP ativa')
const FINALIZADA = ordem('PMOF', '8802', 'FINALIZADA', 'F100', 'F199', 'Placa da OP finalizada')

function montar(ordens: OrdemLancamentoLista[]) {
  render(
    <LancamentoForm
      ordens={ordens}
      defeitos={[{ codigo: 'D1', tipo: 1 }]}
      postosPerfil={{ Montagem: PERFIL }}
      postosColetivo={{}}
      postosRotaDestino={[]}
    />,
  )
}

const campoBipe = () => screen.queryByLabelText(/Bipe o Nº de Série para carregar a OP/)
function biparCabecalho(sn: string) {
  const campo = campoBipe()!
  fireEvent.change(campo, { target: { value: sn } })
  fireEvent.keyDown(campo, { key: 'Enter' })
}

beforeEach(() => {
  vi.mocked(toast.error).mockReset()
  try { localStorage.clear() } catch { /* sem storage */ }
})

describe('bipe do cabeçalho em OP finalizada', () => {
  it('SN de OP ATIVA carrega o cabeçalho, como sempre', async () => {
    montar([ATIVA, FINALIZADA])

    biparCabecalho('A150')

    await waitFor(() => expect(screen.getByLabelText('Colaborador')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Placa da OP ativa')).toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('SN só de OP FINALIZADA: avisa qual OP reativar e NÃO carrega o cabeçalho', async () => {
    montar([ATIVA, FINALIZADA])

    biparCabecalho('F150')

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const msg = String(vi.mocked(toast.error).mock.calls[0]?.[0] ?? '')
    expect(msg).toContain('PMOF')
    expect(msg).toContain('8802')
    expect(msg.toLowerCase()).toContain('finalizada')
    expect(msg.toLowerCase()).toContain('reativ')
    // Não carregou: o campo de bipe do cabeçalho continua na tela e não há Colaborador.
    expect(campoBipe()).toBeInTheDocument()
    expect(screen.queryByLabelText('Colaborador')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Placa da OP finalizada')).not.toBeInTheDocument()
  })

  it('SN que cai numa FINALIZADA E numa ATIVA carrega a ATIVA, sem avisar nada', async () => {
    // Caso 3 do adendo: é o que prova que a etapa 1 protege o caminho normal.
    const finalizadaSobreposta = ordem('PMOF', '8802', 'FINALIZADA', 'A100', 'A199', 'Placa da OP finalizada')
    montar([finalizadaSobreposta, ATIVA])

    biparCabecalho('A150')

    await waitFor(() => expect(screen.getByLabelText('Colaborador')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Placa da OP ativa')).toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('SN que cai em DUAS ATIVAS continua dando ambiguidade', async () => {
    montar([ATIVA, ordem('PMOA', '8809', 'ATIVA', 'A100', 'A199', 'Outra placa ativa')])

    biparCabecalho('A150')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('SN cai em mais de uma OP.'))
    expect(campoBipe()).toBeInTheDocument()
  })

  it('SN fora de qualquer faixa continua "não encontrado"', async () => {
    montar([ATIVA, FINALIZADA])

    biparCabecalho('Z999')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('SN não encontrado em nenhuma OP.'))
    expect(campoBipe()).toBeInTheDocument()
  })
})
