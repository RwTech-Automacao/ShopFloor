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
  it('depois de adicionar, os DOIS campos limpam', async () => {
    etiquetarRoloAction.mockResolvedValue({ ok: true, linha: rolo() })
    abrir()

    await digitarEAdicionar('CAPA78', '1234/25')

    await waitFor(() => expect(campos().codigo).toHaveValue(''))
    expect(campos().pedido).toHaveValue('')
  })

  it('o rolo SEM pedido não herda o pedido do rolo anterior', async () => {
    // É este o motivo de limpar os dois, e não a economia de digitação: antes o pedido ficava no
    // campo, então etiquetar um rolo com pedido e em seguida um rolo SEM pedido escrito colava no
    // segundo uma etiqueta com o pedido do primeiro — uma etiqueta que mente, e ninguém percebe.
    etiquetarRoloAction.mockResolvedValue({ ok: true, linha: rolo() })
    abrir()

    await digitarEAdicionar('CAPA78', '1234/25')
    await waitFor(() => expect(campos().pedido).toHaveValue(''))

    etiquetarRoloAction.mockClear()
    await digitarEAdicionar('RWPRA14', '')

    expect(etiquetarRoloAction).toHaveBeenCalledWith('RWPRA14', '')
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

  it('durante a gravação os campos travam, o foco sai deles e o botão diz que está enviando', async () => {
    let solta: (v: unknown) => void = () => {}
    etiquetarRoloAction.mockImplementation(() => new Promise((r) => (solta = r)))
    abrir()

    const c = campos()
    fireEvent.change(c.codigo, { target: { value: 'CAPA78' } })
    fireEvent.keyDown(c.codigo, { key: 'Enter' })

    // Em voo. É AQUI que o rolo 2 era perdido: o campo continuava vivo, o que ele digitava era
    // anexado ao valor antigo (`CAPA78CAPB99`) e a resposta do rolo 1 limpava o campo, apagando o
    // rolo 2 sem que nada na tela dissesse que havia gravação em curso.
    expect(campos().codigo).toBeDisabled()
    expect(campos().pedido).toBeDisabled()
    expect(document.activeElement).not.toBe(campos().codigo)
    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled()

    solta({ ok: true, linha: rolo() })

    await waitFor(() => expect(campos().codigo).toBeEnabled())
    expect(campos().codigo).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Adicionar' })).toBeEnabled()
  })

  it('o Enter que chega durante a gravação avisa, em vez de ser engolido em silêncio', async () => {
    let solta: (v: unknown) => void = () => {}
    etiquetarRoloAction.mockImplementation(() => new Promise((r) => (solta = r)))
    abrir()

    const c = campos()
    fireEvent.change(c.codigo, { target: { value: 'CAPA78' } })
    fireEvent.keyDown(c.codigo, { key: 'Enter' })
    // O Enter do rolo 2 caindo na janela da gravação do rolo 1: descartar calado fazia ele ver a
    // linha do rolo 1 entrar na lista, achar que era a do rolo 2 e seguir para a prateleira
    // seguinte — com o rolo 2 ainda sem etiqueta.
    fireEvent.keyDown(campos().codigo, { key: 'Enter' })

    expect(etiquetarRoloAction).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/ainda está sendo gravado/)).toBeInTheDocument()

    solta({ ok: true, linha: rolo() })
    await waitFor(() => expect(campos().codigo).toBeEnabled())
  })

  it('quando destrava, o foco volta ao Código — é o que faz o gesto existir', async () => {
    etiquetarRoloAction.mockResolvedValue({ ok: true, linha: rolo() })
    abrir()

    // O foco é o único jeito de ele emendar dezenas de rolos sem tocar no tablet. Uma quebra no
    // encaminhamento do `ref` pelo wrapper `Input` (código de terceiro no meio) passaria verde sem
    // este teste.
    await digitarEAdicionar('CAPA78', '1234/25')

    await waitFor(() => expect(campos().codigo).toHaveValue(''))
    expect(document.activeElement).toBe(campos().codigo)
  })

  it('carga que falha não deixa a tabela dizendo que não há nada esperando impressão', async () => {
    listarPendentesAction.mockResolvedValue({
      ok: false,
      erro: 'Não foi possível carregar a lista. Tente de novo; se continuar, chame o desenvolvedor.',
    })
    abrir()

    expect(await screen.findByText(/Não deu para carregar a lista/)).toBeInTheDocument()
    expect(screen.queryByText(/Nada esperando impressão/)).not.toBeInTheDocument()
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

  it('mostra o aviso INTEIRO, na tarja — as duas frases têm instrução de ação', async () => {
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
    // Na TARJA larga, não no toast estreito: são ~565 caracteres, que no tablet virariam um
    // paredão de 14 linhas no canto de baixo.
    expect(mostrado).toHaveAttribute('role', 'status')
  })
})

/**
 * A QUEDA DE CONEXÃO. O wifi do galpão cai no meio da gravação: o servidor pode já ter gravado, e a
 * resposta é que se perde. Sem `catch`, o `finally` destravava a tela e NENHUM toast aparecia — ele
 * não via a linha na lista, achava que não gravou, digitava de novo, e ficavam duas etiquetas (uma
 * órfã, com o número queimado). Cada frase tem de mandar CONFERIR antes de repetir o gesto.
 */
describe('a conexão que cai no meio da ação', () => {
  it('ao gravar o rolo, manda conferir a lista antes de digitar de novo', async () => {
    etiquetarRoloAction.mockRejectedValue(new Error('Failed to fetch'))
    abrir()

    await digitarEAdicionar('CAPA78', '1234/25')

    const dito = await screen.findByText(/Falha de conexão/)
    expect(dito).toHaveTextContent(/Atualizar lista para ver se o rolo foi gravado/)
    // O que ele digitou fica: é com isso na mão que ele confere a lista.
    expect(campos().codigo).toHaveValue('CAPA78')
    expect(campos().pedido).toHaveValue('1234/25')
    // E o ciclo do foco segue inteiro — sem isto ele digitaria o rolo seguinte no nada.
    await waitFor(() => expect(campos().codigo).toBeEnabled())
    expect(document.activeElement).toBe(campos().codigo)
  })

  it('ao remover, diz que a etiqueta pode já ter saído, e a linha fica na tela', async () => {
    listarPendentesAction.mockResolvedValue({ ok: true, linhas: [rolo()], cortada: false })
    removerPendenteAction.mockRejectedValue(new Error('Failed to fetch'))
    abrir()

    fireEvent.click(await screen.findByRole('button', { name: /Remover/ }))

    const dito = await screen.findByText(/Falha de conexão/)
    expect(dito).toHaveTextContent(/CAPA78-123425L0004/)
    expect(dito).toHaveTextContent(/pode já ter sido removida/)
    expect(screen.getByRole('button', { name: /Remover/ })).toBeInTheDocument()
  })

  it('ao baixar o arquivo, manda na 2ª via — nunca etiquetar os rolos de novo', async () => {
    // O caso mais caro: o servidor marca a leva como impressa ANTES de responder, então as
    // etiquetas podem estar marcadas sem o arquivo ter chegado ao tablet. Etiquetar de novo daria
    // números novos a rolos que já têm código.
    listarPendentesAction.mockResolvedValue({ ok: true, linhas: [rolo()], cortada: false })
    gerarCsvPendentesAction.mockRejectedValue(new Error('Failed to fetch'))
    abrir()

    fireEvent.click(await screen.findByRole('button', { name: /Baixar arquivo de etiquetas/ }))

    const dito = await screen.findByText(/Falha de conexão ao baixar o arquivo/)
    expect(dito).toHaveTextContent(/baixe a 2ª via delas na aba "Já impressas"/)
    expect(dito).toHaveTextContent(/não etiquete os rolos de novo/)
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
    // O denominador é o que está na TELA (como na etiquetagem por planilha), e a saída oferecida é
    // estreitar as datas: "limpe a seleção e siga com o resto" não funciona, porque o resto do
    // período não está na tela para ser marcado depois.
    const contador = await screen.findByText(
      new RegExp(`${LIMITE_LINHAS_LEGADO} selecionada\\(s\\) de ${muitas.length} linha\\(s\\)`),
    )
    expect(contador).toHaveTextContent(/estreite as datas/)

    fireEvent.click(screen.getByRole('button', { name: /Baixar 2ª via/ }))
    await waitFor(() => expect(baixarDeNovoAction).toHaveBeenCalled())
    expect(baixarDeNovoAction.mock.calls[0]?.[0]).toHaveLength(LIMITE_LINHAS_LEGADO)
  })

  it('a leva pequena não fala de teto e conta as linhas da tela', async () => {
    listarImpressasAction.mockResolvedValue({
      ok: true,
      linhas: [rolo({ id: 'r1', impressaEm: '2026-09-30T18:00:00.000Z' })],
    })
    abrir()

    fireEvent.click(screen.getByRole('button', { name: 'Já impressas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(listarImpressasAction).toHaveBeenCalled())

    expect(await screen.findByText(/0 selecionada\(s\) de 1 linha\(s\)/)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(`de ${LIMITE_LINHAS_LEGADO}`))).not.toBeInTheDocument()
  })

  it('busca que devolveu zero não continua mandando escolher o período', async () => {
    abrir()

    fireEvent.click(screen.getByRole('button', { name: 'Já impressas' }))
    expect(screen.getByText('Escolha o período e toque em Buscar.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))

    // A frase exata é a da TABELA: o toast tem a mesma abertura e mais a instrução das datas.
    expect(await screen.findByText('Nenhuma etiqueta impressa nesse período.')).toBeInTheDocument()
    expect(screen.queryByText('Escolha o período e toque em Buscar.')).not.toBeInTheDocument()
  })

  it('busca que falhou não se passa por período sem etiqueta', async () => {
    listarImpressasAction.mockResolvedValue({
      ok: false,
      erro: 'Não foi possível carregar a lista. Tente de novo; se continuar, chame o desenvolvedor.',
    })
    abrir()

    fireEvent.click(screen.getByRole('button', { name: 'Já impressas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))

    expect(await screen.findByText(/Não deu para carregar a lista/)).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma etiqueta impressa nesse período.')).not.toBeInTheDocument()
  })
})
