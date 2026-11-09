import type * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PERFIL_PADRAO, type PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import { OrdemForm, type OrdemView, type PadraoFluxo } from '../ordem-form'

vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/modules/shopfloor/application/ordens-actions', () => ({
  criarOrdemAction: vi.fn(),
  editarOrdemAction: vi.fn(),
  opTemRegistrosAction: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/padroes-fluxo-actions', () => ({
  salvarPadraoAction: vi.fn(),
  excluirPadraoAction: vi.fn(),
}))
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirmacao: () => vi.fn() }))

// Select nativo no lugar do Base UI (portal/floating-ui não funcionam em jsdom).
vi.mock('@/components/ui/select', () => ({
  Select: ({ name, value, defaultValue, onValueChange, children }: { name?: string; value?: string; defaultValue?: string; onValueChange?: (v: string) => void; children?: React.ReactNode }) => (
    <select aria-label={name} name={name} value={value} defaultValue={value === undefined ? defaultValue : undefined} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
}))
// O diálogo abre inline: em jsdom o portal do Base UI não renderiza. O botão extra existe para
// disparar `onOpenChange(true)` — é lá que a tela faz o reset dos campos ao reabrir.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, onOpenChange }: { children?: React.ReactNode; onOpenChange?: (v: boolean) => void }) => (
    <>
      <button type="button" onClick={() => onOpenChange?.(true)}>reabrir</button>
      {children}
    </>
  ),
  DialogTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DialogFooter: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}))

/**
 * Posto Almoxarifado pré-marcado no fim da rota da OP NOVA (09/11/2026): vem marcado, a pessoa pode
 * tirar; puxar um Padrão também o põe no fim; a EDIÇÃO nunca o acrescenta.
 */

const ALMOX: PerfilPosto = { ...PERFIL_PADRAO, chave: 'almoxarifado', nome: 'Almoxarifado', recurso: 'almoxarifado' }
const PERFIS: Record<string, PerfilPosto> = { Almoxarifado: ALMOX }

const BASE: OrdemView = {
  id: 'id-1', pmo: 'PMOX01', op: '9001', cliente: 'Cliente', qtd: 10,
  descricao: 'Produto', acp: '', status: 'ATIVA', sn_ini: '1', sn_fim: '10',
  postos: ['Teste', 'Embalagem'], receitaPorPosto: {}, tempoBurninPorPosto: {}, placas_por_painel: 1,
} as OrdemView

const PADRAO: PadraoFluxo = { id: 'p1', pmo: 'PMOX01', nome: 'Linha A', descricao: '', postos: ['Teste', 'Embalagem'], componentes: {} }

function montar(props: { ordem?: OrdemView; perfis?: Record<string, PerfilPosto>; padroes?: PadraoFluxo[] } = {}) {
  return render(
    <OrdemForm
      postos={['Teste', 'Embalagem', 'Almoxarifado']}
      postosPerfil={props.perfis ?? PERFIS}
      ordem={props.ordem}
      padroesExistentes={props.padroes ?? []}
      pmosExistentes={['PMOX01']}
      clientesExistentes={['Cliente']}
      dadosPorPmo={{}}
    />,
  )
}
const fluxoEnviado = (c: HTMLElement) => JSON.parse((c.querySelector('input[name="fluxo"]') as HTMLInputElement).value) as string[]
const selectCom = (valor: string) =>
  screen.getAllByRole('combobox').find((s) => Array.from((s as HTMLSelectElement).options).some((o) => o.value === valor))!
const adicionar = (posto: string) => fireEvent.change(selectCom(posto), { target: { value: posto } })

describe('Almoxarifado pré-marcado no fim da rota da OP nova', () => {
  it('OP nova nasce com o Almoxarifado na rota', () => {
    const { container } = montar()
    expect(fluxoEnviado(container)).toEqual(['Almoxarifado'])
  })

  it('postos acrescentados entram antes do Almoxarifado, que segue no fim', () => {
    const { container } = montar()
    adicionar('Teste')
    adicionar('Embalagem')
    expect(fluxoEnviado(container)).toEqual(['Teste', 'Embalagem', 'Almoxarifado'])
  })

  it('a pessoa pode tirar o Almoxarifado', () => {
    const { container } = montar()
    adicionar('Teste')
    fireEvent.click(screen.getAllByLabelText('Remover')[1]!)
    expect(fluxoEnviado(container)).toEqual(['Teste'])
  })

  it('reabrir o "Nova OP" volta a trazer o Almoxarifado pré-marcado', () => {
    const { container } = montar()
    fireEvent.click(screen.getAllByLabelText('Remover')[0]!)
    expect(fluxoEnviado(container)).toEqual([])
    fireEvent.click(screen.getAllByText('reabrir')[0]!)
    expect(fluxoEnviado(container)).toEqual(['Almoxarifado'])
  })

  it('puxar um Padrão sem Almoxarifado o põe no fim', () => {
    const { container } = montar({ padroes: [PADRAO] })
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOX01' } })
    fireEvent.change(selectCom('p1'), { target: { value: 'p1' } })
    expect(fluxoEnviado(container)).toEqual(['Teste', 'Embalagem', 'Almoxarifado'])
  })

  it('puxar um Padrão que já tem o Almoxarifado não duplica', () => {
    const { container } = montar({ padroes: [{ ...PADRAO, postos: ['Teste', 'Almoxarifado', 'Embalagem'] }] })
    fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: 'PMOX01' } })
    fireEvent.change(selectCom('p1'), { target: { value: 'p1' } })
    expect(fluxoEnviado(container)).toEqual(['Teste', 'Embalagem', 'Almoxarifado'])
  })

  it('sem posto de perfil almoxarifado, a OP nova nasce com a rota vazia (como antes)', () => {
    const { container } = montar({ perfis: {} })
    expect(fluxoEnviado(container)).toEqual([])
  })

  it('EDIÇÃO: a rota vem do banco como está, sem o Almoxarifado', () => {
    const { container } = montar({ ordem: BASE })
    expect(fluxoEnviado(container)).toEqual(['Teste', 'Embalagem'])
    fireEvent.click(screen.getAllByText('reabrir')[0]!)
    expect(fluxoEnviado(container)).toEqual(['Teste', 'Embalagem'])
  })

  it('EDIÇÃO: puxar um Padrão não acrescenta o Almoxarifado', () => {
    const { container } = montar({ ordem: BASE, padroes: [{ ...PADRAO, postos: ['Embalagem'] }] })
    fireEvent.change(selectCom('p1'), { target: { value: 'p1' } })
    expect(fluxoEnviado(container)).toEqual(['Embalagem'])
  })
})
