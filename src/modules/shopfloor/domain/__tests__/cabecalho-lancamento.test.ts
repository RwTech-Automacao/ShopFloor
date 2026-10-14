import { describe, it, expect } from 'vitest'
import { resolverOpPorSn } from '../cabecalho-lancamento'

const O = (
  cliente: string,
  pmo: string,
  op: string,
  sn_ini: string,
  sn_fim: string,
  status = 'ATIVA',
) => ({ cliente, pmo, op, sn_ini, sn_fim, status })
const ORDS = [
  O('C1', 'PMOA', '8801', 'A100', 'A199'),
  O('C1', 'PMOB', '8802', 'B100', 'B199'),
  O('C1', 'PMOC', '8803', '', ''), // sem faixa → ignorada
]

describe('resolverOpPorSn', () => {
  it('SN dentro da faixa de UMA OP → ok com a OP', () => {
    expect(resolverOpPorSn(ORDS, 'A150')).toEqual({ ok: true, ordem: ORDS[0] })
    expect(resolverOpPorSn(ORDS, 'B100')).toEqual({ ok: true, ordem: ORDS[1] })
  })
  it('SN fora de todas as faixas → SEM_OP', () => {
    expect(resolverOpPorSn(ORDS, 'Z999')).toEqual({ ok: false, erro: 'SEM_OP' })
  })
  it('SN vazio → SEM_OP', () => {
    expect(resolverOpPorSn(ORDS, '')).toEqual({ ok: false, erro: 'SEM_OP' })
  })
  it('OP sem faixa (sn_ini/fim vazios) é ignorada', () => {
    // nada casa a PMOC (sem faixa); um SN qualquer fora de A/B → SEM_OP
    expect(resolverOpPorSn([O('C1', 'PMOC', '8803', '', '')], 'A150')).toEqual({ ok: false, erro: 'SEM_OP' })
  })
  it('SN em duas faixas ATIVAS sobrepostas → AMBIGUO', () => {
    const dup = [O('C1', 'PMOA', '8801', 'A100', 'A199'), O('C1', 'PMOA', '8809', 'A100', 'A199')]
    expect(resolverOpPorSn(dup, 'A150')).toEqual({ ok: false, erro: 'AMBIGUO' })
  })
})

// ---------- busca em duas etapas (adendo de 09/10/2026 da spec) ----------
describe('resolverOpPorSn: etapa 2, as OPs finalizadas', () => {
  const ATIVA = O('C1', 'PMOA', '8801', 'A100', 'A199')
  const FIM = O('C1', 'PMOF', '8802', 'F100', 'F199', 'FINALIZADA')

  it('SN só numa FINALIZADA → OP_FINALIZADA, carregando qual é a OP', () => {
    // Antes isto era "SN não encontrado em nenhuma OP": o operador não tinha o que fazer com a
    // mensagem. Agora a tela sabe qual OP mandar reativar.
    expect(resolverOpPorSn([ATIVA, FIM], 'F150')).toEqual({ ok: false, erro: 'OP_FINALIZADA', ordem: FIM })
  })

  it('a etapa 2 não desvia o caminho normal: SN de OP ATIVA segue carregando', () => {
    expect(resolverOpPorSn([ATIVA, FIM], 'A150')).toEqual({ ok: true, ordem: ATIVA })
  })

  it('SN numa FINALIZADA E numa ATIVA → carrega a ATIVA, SEM ambiguidade (caso 3 do adendo)', () => {
    const sobrepostas = [O('C1', 'PMOF', '8802', 'A100', 'A199', 'FINALIZADA'), ATIVA]
    expect(resolverOpPorSn(sobrepostas, 'A150')).toEqual({ ok: true, ordem: ATIVA })
  })

  it('duas ATIVAS sobrepostas continuam AMBIGUO mesmo com uma FINALIZADA na faixa', () => {
    const tres = [
      O('C1', 'PMOF', '8802', 'A100', 'A199', 'FINALIZADA'),
      ATIVA,
      O('C1', 'PMOA', '8809', 'A100', 'A199'),
    ]
    expect(resolverOpPorSn(tres, 'A150')).toEqual({ ok: false, erro: 'AMBIGUO' })
  })

  it('status em caixa/espaços variados conta como finalizada (ehOpFinalizada)', () => {
    const grafias = [' finalizada ', 'Finalizada', 'FINALIZADA']
    for (const s of grafias) {
      const o = O('C1', 'PMOF', '8802', 'F100', 'F199', s)
      expect(resolverOpPorSn([o], 'F150'), s).toEqual({ ok: false, erro: 'OP_FINALIZADA', ordem: o })
    }
  })

  it('status nulo ou vazio conta como ATIVA (histórico da planilha)', () => {
    const semStatus = { cliente: 'C1', pmo: 'PMOZ', op: '8810', sn_ini: 'Z100', sn_fim: 'Z199', status: null }
    expect(resolverOpPorSn([semStatus], 'Z150')).toEqual({ ok: true, ordem: semStatus })
    const vazio = O('C1', 'PMOY', '8811', 'Y100', 'Y199', '')
    expect(resolverOpPorSn([vazio], 'Y150')).toEqual({ ok: true, ordem: vazio })
  })

  it('SN em DUAS finalizadas → AMBIGUO (não dá para dizer qual reativar)', () => {
    const duas = [
      O('C1', 'PMOF', '8802', 'F100', 'F199', 'FINALIZADA'),
      O('C1', 'PMOG', '8803', 'F100', 'F199', 'FINALIZADA'),
    ]
    expect(resolverOpPorSn(duas, 'F150')).toEqual({ ok: false, erro: 'AMBIGUO' })
  })
})
