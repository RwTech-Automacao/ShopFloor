import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Toaster } from 'sonner'
import { LIMITE_LINHAS_LEGADO, type RoloEtiquetado } from '@/modules/etiquetas/domain/partnumber-legado'

/**
 * A tela da etiquetagem junto ao inventário rotativo (spec de 30/09/2026).
 *
 * O que estes testes seguram é o GESTO da recontagem: o almoxarife está com o rolo na mão, digita,
 * aperta Enter e pega o rolo seguinte — do mesmo pedido, quase sempre. Se o campo Pedido limpasse,
 * ele redigitaria o mesmo número dezenas de vezes por coluna de prateleira; se o campo Código não
 * limpasse, ele etiquetaria o rolo seguinte com o código do anterior.
 *
 * O `Toaster` de verdade entra no render porque o resultado de cada ação é um toast (UX travada do
 * projeto: bipe usa painel fixo, digitação usa toast) — sem ele, o teste não veria a recusa.
 */

const etiquetarRoloAction = vi.fn()
const listarPendentesAction = vi.fn()
const removerPendenteAction = vi.fn()
const gerarCsvPendentesAction = vi.fn()
const listarImpressasAction = vi.fn()
const baixarDeNovoAction = vi.fn()

vi.mock('@/modules/etiquetas/application/etiquetar-rolo', () => ({
  etiquetarRoloAction: (...a: unknown[]) => etiquetarRoloAction(...a),
  listarPendentesAction: (...a: unknown[]) => listarPendentesAction(...a),
  removerPendenteAction: (...a: unknown[]) => removerPendenteAction(...a),
  gerarCsvPendentesAction: (...a: unknown[]) => gerarCsvPendentesAction(...a),
  listarImpressasAction: (...a: unknown[]) => listarImpressasAction(...a),
  baixarDeNovoAction: (...a: unknown[]) => baixarDeNovoAction(...a),
}))

import { EtiquetarRoloCliente } from '../etiquetar-rolo-cliente'

function rolo(over: Partial<RoloEtiquetado> = {}): RoloEtiquetado {
  return {
    id: 'r1',
    item: 'CAPA78',
    pedido: '123425',
    sequencial: 4,
    codigo: 'CAPA78-123425L0004',
    usuarioNome: 'Ana Almoxarife',
    criadoEm: '2026-09-30T12:00:00.000Z',
    impressaEm: null,
    ...over,
  }
}

function abrir() {
  return render(
    <>
      <EtiquetarRoloCliente />
      <Toaster />
    </>,
  )
}

/** O `input type=date` do tablet manda `YYYY-MM-DD`; aqui o período é digitado como lá. */
function campos() {
  return {
    codigo: screen.getByLabelText('Código do componente') as HTMLInputElement,
    pedido: screen.getByLabelText('Pedido (se o rolo tem)') as HTMLInputElement,
  }
}

async function digitarEAdicionar(codigo: string, pedido: string) {
  const c = campos()
  fireEvent.change(c.codigo, { target: { value: codigo } })
  fireEvent.change(c.pedido, { target: { value: pedido } })
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
  await waitFor(() => expect(etiquetarRoloAction).toHaveBeenCalled())
}

beforeEach(() => {
  vi.clearAllMocks()
  listarPendentesAction.mockResolvedValue({ ok: true, linhas: [], cortada: false })
  listarImpressasAction.mockResolvedValue({ ok: true, linhas: [] })
  // O jsdom não tem `createObjectURL`: sem isto, o download derrubaria o teste antes do aviso.
  URL.createObjectURL = vi.fn(() => 'blob:etiquetas')
  URL.revokeObjectURL = vi.fn()
})

describe('etiquetar um rolo', () => {
  it('depois de adicionar, o Código limpa e o Pedido continua', async () => {
    etiquetarRoloAction.mockResolvedValue({ ok: true, linha: rolo() })
    abrir()

    await digitarEAdicionar('CAPA78', '1234/25')

    await waitFor(() => expect(campos().codigo).toHaveValue(''))
    expect(campos().pedido).toHaveValue('1234/25')
  })

  it('a lista mostra o código final por extenso', async () => {
    etiquetarRoloAction.mockResolvedValue({ ok: true, linha: rolo() })
    abrir()

    await digitarEAdicionar('CAPA78', '1234/25')

    expect(await screen.findByText('CAPA78-123425L0004')).toBeInTheDocument()
  })

  it('recusa mostra o motivo e não limpa o que foi digitado', async () => {
    etiquetarRoloAction.mockResolvedValue({
      ok: false,
      erro: 'Não consegui ler o pedido "abc". Digite só o número (ex.: 1234/25), ou deixe em branco se o rolo não tem pedido.',
    })
    abrir()

    await digitarEAdicionar('CAPA78', 'abc')

    expect(await screen.findByText(/Não consegui ler o pedido/)).toBeInTheDocument()
    expect(campos().codigo).toHaveValue('CAPA78')
    expect(campos().pedido).toHaveValue('abc')
  })

  it('um Enter só: dois disparos seguidos não emitem duas etiquetas para o mesmo rolo', async () => {
    let solta: (v: unknown) => void = () => {}
    etiquetarRoloAction.mockImplementation(() => new Promise((r) => (solta = r)))
    abrir()

    const c = campos()
    fireEvent.change(c.codigo, { target: { value: 'CAPA78' } })
    fireEvent.keyDown(c.pedido, { key: 'Enter' })
    fireEvent.keyDown(c.pedido, { key: 'Enter' })

    expect(etiquetarRoloAction).toHaveBeenCalledTimes(1)
    solta({ ok: true, linha: rolo() })
    await waitFor(() => expect(campos().codigo).toHaveValue(''))
  })

  it('a linha que voltou sem id não oferece remover (removê-la mandaria id vazio)', async () => {
    etiquetarRoloAction.mockResolvedValue({ ok: true, linha: rolo({ id: '' }) })
    abrir()

    await digitarEAdicionar('CAPA78', '1234/25')

    expect(await screen.findByText('CAPA78-123425L0004')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remover/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Atualize a lista para poder remover/)).toBeInTheDocument()
  })
})

describe('o arquivo do turno', () => {
  it('sem pendentes, o botão de gerar o CSV fica desabilitado', async () => {
    abrir()
    expect(await screen.findByRole('button', { name: /Baixar arquivo de etiquetas/ })).toBeDisabled()
  })

  it('com pendentes, o botão libera', async () => {
    listarPendentesAction.mockResolvedValue({ ok: true, linhas: [rolo()], cortada: false })
    abrir()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Baixar arquivo de etiquetas/ })).toBeEnabled(),
    )
  })

  it('mostra o aviso INTEIRO — as duas frases têm instrução de ação', async () => {
    const aviso =
      'Atenção: o arquivo saiu com 2 etiqueta(s), e 1 dela(s) já tinha(m) sido baixada(s) ou removida(s) por outra pessoa enquanto esta tela estava aberta. ' +
      'Ainda sobrou: este arquivo levou as 2 etiqueta(s) mais novas, e o resto continua esperando impressão. Baixe o arquivo de novo para pegar a próxima leva.'
    listarPendentesAction.mockResolvedValue({ ok: true, linhas: [rolo()], cortada: true })
    gerarCsvPendentesAction.mockResolvedValue({
      ok: true,
      csv: '"CAPA78-123425L0004","CAPA78","01-01"',
      fileName: 'Etiquetas_inventario_20260930_120000.csv',
      quantidade: 2,
      cortada: true,
      aviso,
    })
    abrir()

    fireEvent.click(await screen.findByRole('button', { name: /Baixar arquivo de etiquetas/ }))

    const mostrado = await screen.findByText(/já tinha\(m\) sido baixada/)
    expect(mostrado).toHaveTextContent(/Baixe o arquivo de novo para pegar a próxima leva/)
  })
})

describe('2ª via das já impressas', () => {
  it('não deixa marcar mais de 1.000 e diz por que antes de apertar', async () => {
    const muitas = Array.from({ length: LIMITE_LINHAS_LEGADO + 1 }, (_, i) =>
      rolo({
        id: `r${i}`,
        sequencial: i + 1,
        codigo: `CAPA78-123425L${String(i + 1).padStart(4, '0')}`,
        impressaEm: '2026-09-30T18:00:00.000Z',
      }),
    )
    listarImpressasAction.mockResolvedValue({ ok: true, linhas: muitas })
    baixarDeNovoAction.mockResolvedValue({ ok: true, csv: 'x', fileName: '2avia.csv' })
    abrir()

    fireEvent.click(screen.getByRole('button', { name: 'Já impressas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(listarImpressasAction).toHaveBeenCalled())

    fireEvent.click(await screen.findByRole('button', { name: 'Marcar todas' }))
    expect(
      await screen.findByText(new RegExp(`${LIMITE_LINHAS_LEGADO} de ${LIMITE_LINHAS_LEGADO}`)),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Baixar 2ª via/ }))
    await waitFor(() => expect(baixarDeNovoAction).toHaveBeenCalled())
    expect(baixarDeNovoAction.mock.calls[0]?.[0]).toHaveLength(LIMITE_LINHAS_LEGADO)
  })
})
