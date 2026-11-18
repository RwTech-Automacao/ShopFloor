import { describe, expect, it } from 'vitest'
import { lerAba, montarOs, FormatoDaAbaInesperado, type LinhaPlanilha } from '../planilha'

// Fixtures SINTÉTICAS: só os cabeçalhos são os da planilha "Peças em garantia"; clientes, OS e NS são inventados.
const csv = (linhas: string[][]) =>
  linhas.map((l) => l.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n')

const CAB_2026 = ['DATA', 'TÉCNICO', 'CLIENTE', 'EQUIPAMENTO', 'NS', 'GARANTIA\nSEM GARANTIA', 'PRIMEIRO REGISTRO',
  'DEFEITO', 'ALGUMA OBSERVAÇÃO?', 'QTD', 'CÓDIGO DA PEÇA', 'PEÇA', 'OS', 'SOLUÇÃO', 'VENDEDOR',
  'E-MAIL ENVIADO PARA COMERCIAL', 'TROCA ANTECIPADA?', 'CLIENTE DEVOLVEU RELÓGIO?']
const CAB_2025 = ['DATA', 'TÉCNICO', 'CLIENTE', 'EQUIPAMENTO', 'NS', 'GARANTIA SEM GARANTIA', 'PRIMEIRO REGISTRO',
  'DEFEITO', 'QTD', 'CÓDIGO DA PEÇA', 'PEÇA', 'OS', 'SOLUÇÃO', 'VENDEDOR', 'E-MAIL ENVIADO PARA COMERCIAL',
  'RETORNO COMERCIAL']
const CAB_2024 = ['DATA DO ENVIO', 'SOLICITANTE', 'CLIENTE', 'EQUIPAMENTO', 'NUMERO DE SÉRIE', 'Qtd',
  'CÓDIGO DA PEÇA', 'PEÇA', 'Número do Chamado no SysAid', 'NFS', 'VENDEDOR RESPONSÁVEL',
  'DEVOLUÇÃO DA PEÇA DEFEITUOSA', 'Observação']

const ABA_2026 = { gid: '1', nome: 'Garantia 2026 - Automação' }
const ABA_2025 = { gid: '2', nome: 'Garantia 2025' }
const ABA_2024 = { gid: '3', nome: 'Garantia 2025/2024' }

const linha2026 = (o: Partial<Record<string, string>>) => CAB_2026.map((c) => o[c] ?? '')
const linha2025 = (o: Partial<Record<string, string>>) => CAB_2025.map((c) => o[c] ?? '')
const linha2024 = (o: Partial<Record<string, string>>) => CAB_2024.map((c) => o[c] ?? '')

describe('lerAba', () => {
  it('aba 2026: cabeçalho na linha 1, data com hora, vários NS na célula ficam crus (separa em montarOs)', () => {
    const linhas = lerAba(csv([
      CAB_2026,
      linha2026({ DATA: '6/1/2026 09:34:05', 'TÉCNICO': 'Téc A', CLIENTE: 'Cliente Fictício Ltda', EQUIPAMENTO: 'REP X',
        NS: '00043005620000001\n00043005620000002', 'GARANTIA\nSEM GARANTIA': 'GARANTIA', DEFEITO: 'não liga',
        'ALGUMA OBSERVAÇÃO?': 'obs', QTD: '2', 'CÓDIGO DA PEÇA': 'PRT001', 'PEÇA': 'Fonte', OS: '90001',
        'SOLUÇÃO': 'Envio ao SAT', VENDEDOR: 'Vend V' }),
      linha2026({}),
    ]), ABA_2026)
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({
      aba: 'Garantia 2026 - Automação', linha: 2, data: '2026-01-06', tecnico: 'Téc A', cliente: 'Cliente Fictício Ltda',
      equipamento: 'REP X', ns: '00043005620000001\n00043005620000002', garantia: 'GARANTIA', defeito: 'não liga',
      observacao: 'obs', quantidade: 2, codigoPeca: 'PRT001', peca: 'Fonte', os: '90001', solucao: 'Envio ao SAT',
      vendedor: 'Vend V',
    })
  })

  it('aba 2025: linha de lixo antes do cabeçalho; data dd/mm/aaaa', () => {
    const linhas = lerAba(csv([
      ['Peças enviadas em garantia', '', ''],
      CAB_2025,
      linha2025({ DATA: '06/01/2025', CLIENTE: 'C2', NS: '562-00010', 'CÓDIGO DA PEÇA': 'PRT002', 'PEÇA': 'Teclado', OS: '80001', QTD: '1,5' }),
    ]), ABA_2025)
    expect(linhas).toEqual([expect.objectContaining({ linha: 3, data: '2025-01-06', os: '80001', ns: '562-00010', quantidade: 1.5 })])
  })

  it('aba 2025/2024: outros nomes de coluna (solicitante, nº do chamado = OS, observação), sem solução', () => {
    const linhas = lerAba(csv([
      ['', ''],
      CAB_2024,
      linha2024({ 'DATA DO ENVIO': '15/12/2024', SOLICITANTE: 'Téc B', CLIENTE: 'C3', 'NUMERO DE SÉRIE': '430056200011',
        Qtd: '1', 'CÓDIGO DA PEÇA': 'PRT003', 'PEÇA': 'Bobina', 'Número do Chamado no SysAid': '70001',
        'VENDEDOR RESPONSÁVEL': 'Vend W', 'Observação': 'urgente' }),
    ]), ABA_2024)
    expect(linhas[0]).toMatchObject({ data: '2024-12-15', tecnico: 'Téc B', ns: '430056200011', os: '70001',
      vendedor: 'Vend W', observacao: 'urgente', solucao: '' })
  })

  it('sem cabeçalho reconhecível: recusa (a planilha mudou de formato)', () => {
    expect(() => lerAba(csv([['a', 'b'], ['1', '2']]), ABA_2026)).toThrow(FormatoDaAbaInesperado)
  })

  it('data ilegível vira null', () => {
    const [l] = lerAba(csv([CAB_2026, linha2026({ DATA: 'ontem', OS: '1', 'PEÇA': 'x' })]), ABA_2026)
    expect(l!.data).toBeNull()
  })
})

const base: LinhaPlanilha = {
  aba: 'A', linha: 2, data: '2026-01-06', tecnico: '', cliente: 'C1', equipamento: 'REP', ns: '', garantia: '',
  primeiroRegistro: '', defeito: '', observacao: '', quantidade: 1, codigoPeca: '', peca: '', os: '', solucao: '',
  vendedor: '',
}

describe('montarOs', () => {
  it('uma OS com vários NS e várias peças (uma linha por peça; célula com 2 NS = 2 itens)', () => {
    const os = montarOs([
      { ...base, os: '90001', ns: '00043005620000001 00043005620000002', codigoPeca: 'PRT001', peca: 'Fonte', defeito: 'não liga' },
      { ...base, linha: 3, os: '90001', ns: '00043005620000001', codigoPeca: 'PRT002', peca: 'Teclado', solucao: 'Envio ao SAT' },
    ])
    expect(os).toHaveLength(1)
    expect(os[0]).toMatchObject({ chave: '90001', numero: '90001', defeito: 'não liga', solucao: 'Envio ao SAT', linha: 2 })
    expect(os[0]!.itens.map((i) => [i.modelo, i.sequencia, i.codigoPeca])).toEqual([
      ['562', '1', 'PRT001'], ['562', '2', 'PRT001'], ['562', '1', 'PRT002'],
    ])
  })

  it('duplicada entre abas (mesma OS + NS + peça + data) grava uma vez; a aba de prioridade manda nos campos', () => {
    const os = montarOs([
      { ...base, aba: 'Garantia 2025', os: '80001', ns: '562-0010', codigoPeca: 'PRT002', solucao: 'Troca' },
      { ...base, aba: 'Garantia 2025/2024', os: '80001', ns: '00043005620000010', codigoPeca: 'prt002', vendedor: 'Vend W' },
    ])
    expect(os).toHaveLength(1)
    expect(os[0]!.itens).toHaveLength(1)
    expect(os[0]).toMatchObject({ aba: 'Garantia 2025', solucao: 'Troca', vendedor: 'Vend W' })
  })

  it('mesma OS e peça em datas diferentes são dois itens', () => {
    const os = montarOs([
      { ...base, os: '1', ns: '562-1', codigoPeca: 'P' },
      { ...base, os: '1', ns: '562-1', codigoPeca: 'P', data: '2026-02-01' },
    ])
    expect(os[0]!.itens).toHaveLength(2)
    expect(os[0]!.data).toBe('2026-01-06')
  })

  it('sem OS, sem NS ou NS ilegível: grava assim mesmo (sem par de busca)', () => {
    const os = montarOs([
      { ...base, os: '', ns: '-', peca: 'Cabo', cliente: 'C9', equipamento: 'REP Z' },
      { ...base, linha: 3, os: '', ns: '', peca: 'Chave', cliente: 'C9', equipamento: 'REP Z' },
    ])
    expect(os).toHaveLength(1)
    expect(os[0]!.chave).toBe('sem-os|2026-01-06|C9|REP Z')
    expect(os[0]!.numero).toBe('')
    expect(os[0]!.itens.map((i) => [i.nsEscrito, i.modelo, i.sequencia, i.peca])).toEqual([
      ['-', null, null, 'Cabo'], ['', null, null, 'Chave'],
    ])
  })

  it('número da OS com espaços em volta é o mesmo', () => {
    const os = montarOs([{ ...base, os: ' 90001 ', codigoPeca: 'A' }, { ...base, os: '90001', codigoPeca: 'B' }])
    expect(os).toHaveLength(1)
  })
})
