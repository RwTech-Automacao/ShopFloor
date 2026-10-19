import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { RegraAlerta } from '@/modules/alertas/domain/regra'
import { RegrasLista } from '../regras-lista'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  alternarRegraAtivaAction: vi.fn(),
  excluirRegraAction: vi.fn(),
  salvarRegraAction: vi.fn(),
  previaRegraAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const BASE: RegraAlerta = {
  modulo: 'shopfloor',
  id: 'r1',
  atualizadoEm: '2026-09-18T12:00:00Z',
  tipo: 'tempo',
  nome: 'Teste lento',
  postos: ['Teste'],
  taxaMinima: null,
  janelaTipo: 'tempo',
  janelaValor: 60,
  minimoBipes: 10,
  limiteTempoSeg: 120,
  limiteOcorrencias: null,
  pausaMaxMin: 30,
  lembreteMin: null,
  intervalos: [],
  horaResumo: null,
  canais: ['telegram'],
  avisarPessoas: true,
  avisarCanal: false,
  destinatarios: ['u1'],
  pmos: ['PMOX', 'PMOY'],
  ativa: true,
}

describe('RegrasLista', () => {
  it('mostra o tipo, o limite formatado por tipo e as PMOs', () => {
    render(
      <RegrasLista
        modulo="shopfloor"
        regras={[
          BASE,
          {
            ...BASE,
            id: 'r2',
            tipo: 'defeito',
            nome: 'Defeito 5x',
            minimoBipes: null,
            limiteTempoSeg: null,
            pausaMaxMin: null,
            limiteOcorrencias: 5,
            pmos: [],
          },
        ]}
        postos={[{ chave: 'Teste', temStatus: true, coletaDefeito: true }]}
        pmos={['PMOX']}
        destinatarios={[{ usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: false, emailOk: true }]}
        configurados={{ telegram: true, discord: true, email: true }}
        canalConfigurado
      />,
    )
    expect(screen.getAllByText('Tipo').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tempo médio por peça').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Defeito repetido').length).toBeGreaterThan(0)
    expect(screen.getAllByText('≤ 2:00/peça').length).toBeGreaterThan(0)
    expect(screen.getAllByText('≥ 5 vezes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('PMOX, PMOY').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Todas').length).toBeGreaterThan(0)
  })

  it('regra de janela "intervalos": a coluna Janela mostra "Blocos de 1 h" e o limite sai como taxa', () => {
    render(
      <RegrasLista
        modulo="shopfloor"
        regras={[
          {
            ...BASE,
            id: 'r3',
            tipo: 'aprovacao',
            nome: 'Taxa por bloco',
            taxaMinima: 95,
            janelaTipo: 'intervalos',
            janelaValor: 60,
            limiteTempoSeg: null,
            pausaMaxMin: null,
            intervalos: [
              { inicio: '07:00', fim: '12:00' },
              { inicio: '13:30', fim: '17:30' },
            ],
          },
        ]}
        postos={[{ chave: 'Teste', temStatus: true, coletaDefeito: true }]}
        pmos={['PMOX']}
        destinatarios={[{ usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: false, emailOk: true }]}
        configurados={{ telegram: true, discord: true, email: true }}
        canalConfigurado
      />,
    )
    expect(screen.getAllByText('Blocos de 1 h').length).toBeGreaterThan(0)
    expect(screen.getAllByText('≥ 95%').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Últimos/)).toBeNull()
  })

  it('resumo diário: Limite vira traço, Janela mostra a hora (nunca "Blocos de") e sem null/undefined/NaN', () => {
    const { container } = render(
      <RegrasLista
        modulo="shopfloor"
        regras={[
          BASE,
          {
            ...BASE,
            id: 'r3',
            tipo: 'resumo',
            nome: 'Fechamento do dia',
            janelaTipo: 'intervalos',
            janelaValor: null,
            minimoBipes: null,
            limiteTempoSeg: null,
            pausaMaxMin: null,
            horaResumo: '18:00',
          },
        ]}
        postos={[{ chave: 'Teste', temStatus: true, coletaDefeito: true }]}
        pmos={[]}
        destinatarios={[{ usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: false, emailOk: true }]}
        configurados={{ telegram: true, discord: true, email: true }}
        canalConfigurado
      />,
    )
    // Positivo antes do negativo: a tela montou com a outra regra e com o resumo.
    expect(screen.getAllByText('Teste lento').length).toBeGreaterThan(0)
    expect(screen.getAllByText('≤ 2:00/peça').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Fechamento do dia').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Resumo diário').length).toBeGreaterThan(0)

    const linha = screen.getAllByText('Fechamento do dia')[0]!.closest('tr') as HTMLElement
    const celulas = Array.from(linha.querySelectorAll('td')).map((c) => c.textContent)
    expect(celulas[3]).toBe('—') // Limite
    expect(celulas[4]).toBe('Dia inteiro, às 18:00') // Janela
    const texto = container.textContent ?? ''
    expect(texto).not.toMatch(/null|undefined|NaN/)
    expect(texto).not.toContain('Blocos de')
  })

  // A regra de fim de EMB é a primeira sem posto nenhum (`postos: []`): na tabela a célula ficaria
  // em branco, e no cartão do celular saía um ' ·  · ' pendurado no meio da linha.
  it('fim de EMB: a coluna Postos mostra travessão e o cartão não pendura separador vazio', () => {
    const { container } = render(
      <RegrasLista
        modulo="recebimento"
        regras={[
          {
            ...BASE,
            modulo: 'recebimento',
            id: 'r4',
            tipo: 'emb',
            nome: 'Divergências de EMB',
            postos: [],
            janelaTipo: 'op',
            janelaValor: null,
            minimoBipes: null,
            limiteTempoSeg: null,
            pausaMaxMin: null,
            pmos: [],
          },
        ]}
        postos={[]}
        pmos={[]}
        destinatarios={[{ usuarioId: 'u1', nome: 'Beto Recebimento', email: 'beto@x', telegram: true, discord: false, emailOk: true }]}
        configurados={{ telegram: true, discord: true, email: true }}
        canalConfigurado
      />,
    )
    // Positivo antes do negativo: a linha montou.
    expect(screen.getAllByText('Divergências de EMB').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Fim de EMB').length).toBeGreaterThan(0)

    const linha = screen.getAllByText('Divergências de EMB')[0]!.closest('tr') as HTMLElement
    const celulas = Array.from(linha.querySelectorAll('td')).map((c) => c.textContent)
    expect(celulas[2]).toBe('—') // Postos
    expect(celulas[3]).toBe('Todos os processos no fim') // Limite
    expect(celulas[4]).toBe('Quando a EMB fecha') // Janela

    const cartao = container.querySelector('.lg\\:hidden') as HTMLElement
    expect(cartao.textContent).toContain('Fim de EMB · Todos os processos no fim · Quando a EMB fecha · PMOs: Todas')
    expect(cartao.textContent).not.toContain(' ·  · ')
    expect(container.textContent ?? '').not.toMatch(/null|undefined|NaN/)
  })

  // A coluna "Postos" imprimia a lista inteira e esticava a linha da tabela (pedido do usuário,
  // 14/10/2026). Estes dois testes amarram a TELA ao resumo: sem eles, alguém pode devolver o
  // `join(', ')` e o domínio continuaria certo enquanto a tela voltaria a inchar, em silêncio.
  const DOZE = ['Inspeção SPI', 'Inspeção SMD', 'Inspeção PTH', 'Teste', 'Burn-in', 'Teste Final',
    'Inspeção Final', 'Inspeção NQA', 'Inspeção SPI BOT', 'Inspeção SPI TOP', 'Inspeção AOI BOT',
    'Inspeção AOI TOP']

  function montarComPostos(daRegra: string[]) {
    return render(
      <RegrasLista
        modulo="shopfloor"
        regras={[{ ...BASE, postos: daRegra }]}
        postos={DOZE.map((chave) => ({ chave, temStatus: true, coletaDefeito: true }))}
        pmos={['PMOX']}
        destinatarios={[{ usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: false, emailOk: true }]}
        configurados={{ telegram: true, discord: true, email: true }}
        canalConfigurado
      />,
    )
  }

  it('a regra com todos os postos mostra "Todos os postos", não os doze nomes', () => {
    const { container } = montarComPostos(DOZE)
    expect(screen.getAllByText('Todos os postos').length).toBeGreaterThan(0)
    // O 12º nome não pode aparecer solto na linha — se aparecer, a célula voltou a listar tudo.
    expect(container.textContent).not.toContain('Inspeção AOI TOP,')
  })

  it('mais de dois postos resumem, e a lista completa fica no title', () => {
    montarComPostos(['Teste', 'Burn-in', 'Inspeção NQA', 'Teste Final'])
    expect(screen.getAllByText('Teste, Burn-in +2').length).toBeGreaterThan(0)
    const celula = screen.getAllByTitle('Teste, Burn-in, Inspeção NQA, Teste Final')
    expect(celula.length).toBeGreaterThan(0)
  })
})
