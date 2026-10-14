import type * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrdemForm, type OrdemView } from '../ordem-form'

/**
 * O aviso de que REATIVAR uma OP finalizada é definitivo (adendo de 09/10/2026 da spec
 * `docs/superpowers/specs/2026-10-08-finalizar-op-automatico-design.md`).
 *
 * Reativar liga `sf_ordens.reaberta_manual` (migração 0148) e, a partir daí, a rotina dos 100%
 * NUNCA mais fecha aquela OP sozinha — e não há como desfazer pela aplicação. É o único ponto do
 * sistema onde um clique causa efeito permanente, e quem clica não é quem desenhou a regra.
 *
 * O que se observa aqui é o que o gestor vê na tela, não como a tela foi feita.
 */

vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/modules/shopfloor/application/ordens-actions', () => ({
  criarOrdemAction: vi.fn(),
  editarOrdemAction: vi.fn(),
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

const BASE: OrdemView = {
  id: 'id-1', pmo: 'PMOX01', op: '9001', cliente: 'Cliente', qtd: 10,
  descricao: 'Produto', acp: '', status: 'ATIVA', sn_ini: '1', sn_fim: '10',
  postos: ['Teste'], receitaPorPosto: {}, tempoBurninPorPosto: {},
} as OrdemView

function montar(ordem?: OrdemView) {
  return render(
    <OrdemForm
      postos={['Teste']}
      postosPerfil={{}}
      ordem={ordem}
      padroesExistentes={[]}
      pmosExistentes={['PMOX01']}
      clientesExistentes={['Cliente']}
      dadosPorPmo={{}}
    />,
  )
}

const AVISO = /tira ela do fechamento automático/i
const seletorStatus = () => screen.getByLabelText('status') as HTMLSelectElement

describe('aviso de reativação definitiva no cadastro de OP', () => {
  it('OP FINALIZADA: enquanto o status não muda, não avisa nada', () => {
    montar({ ...BASE, status: 'FINALIZADA' })
    expect(screen.queryByText(AVISO)).toBeNull()
  })

  it('OP FINALIZADA passando para ATIVA: avisa que é definitivo', () => {
    montar({ ...BASE, status: 'FINALIZADA' })
    fireEvent.change(seletorStatus(), { target: { value: 'ATIVA' } })
    expect(screen.getByText(AVISO)).toBeTruthy()
  })

  it('voltar o status para FINALIZADA tira o aviso (não houve reativação)', () => {
    montar({ ...BASE, status: 'FINALIZADA' })
    fireEvent.change(seletorStatus(), { target: { value: 'ATIVA' } })
    expect(screen.getByText(AVISO)).toBeTruthy()
    fireEvent.change(seletorStatus(), { target: { value: 'FINALIZADA' } })
    expect(screen.queryByText(AVISO)).toBeNull()
  })

  // O caso que protege o cadastro normal: editar uma OP ativa é a operação mais comum da tela, e
  // ela não pode ganhar um aviso sobre algo que não vai acontecer.
  it('OP ATIVA: mexer no status para FINALIZADA e voltar nunca avisa', () => {
    montar({ ...BASE, status: 'ATIVA' })
    expect(screen.queryByText(AVISO)).toBeNull()
    fireEvent.change(seletorStatus(), { target: { value: 'FINALIZADA' } })
    expect(screen.queryByText(AVISO)).toBeNull()
    fireEvent.change(seletorStatus(), { target: { value: 'ATIVA' } })
    expect(screen.queryByText(AVISO)).toBeNull()
  })

  // Criar OP não tem status anterior: não existe reativação possível.
  it('OP nova: nunca avisa', () => {
    montar(undefined)
    fireEvent.change(seletorStatus(), { target: { value: 'FINALIZADA' } })
    fireEvent.change(seletorStatus(), { target: { value: 'ATIVA' } })
    expect(screen.queryByText(AVISO)).toBeNull()
  })

  // Fechar sem salvar e reabrir tem que trazer o status do BANCO de volta. Sem isto, o gestor que
  // abre, mexe no status, desiste e reabre vê a tela dizendo ATIVA numa OP que está FINALIZADA --
  // e o aviso pendurado. É o mesmo "cache" que a tela já corrige para PMO, cliente e descrição.
  it('reabrir o diálogo traz o status do banco de volta e tira o aviso', () => {
    montar({ ...BASE, status: 'FINALIZADA' })
    fireEvent.change(seletorStatus(), { target: { value: 'ATIVA' } })
    expect(screen.getByText(AVISO)).toBeTruthy()

    // A tela tem mais de um diálogo (o da OP e o de padrões de fluxo); o da OP é o primeiro.
    fireEvent.click(screen.getAllByText('reabrir')[0]!)

    expect(seletorStatus().value).toBe('FINALIZADA')
    expect(screen.queryByText(AVISO)).toBeNull()
  })

  // O seletor continua mandando o valor escolhido no envio do formulário: se a mudança para
  // controlado quebrasse isso, salvar uma OP pararia de mudar o status e ninguém notaria.
  it('o seletor continua levando o status escolhido no formulário', () => {
    montar({ ...BASE, status: 'FINALIZADA' })
    const s = seletorStatus()
    expect(s.name).toBe('status')
    expect(s.value).toBe('FINALIZADA')
    fireEvent.change(s, { target: { value: 'ATIVA' } })
    expect(s.value).toBe('ATIVA')
  })
})
