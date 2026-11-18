import { describe, expect, it } from 'vitest'
import { mensagemMudancaNf, mensagemNota } from '../mensagens'

const CNPJ = '12.345.678/0001-90'

describe('mensagemNota', () => {
  it('aprovada com vários relógios', () => {
    expect(mensagemNota({ numero: '1234', empresa: 'EMPRESA', cnpj: CNPJ, situacao: 'aprovada', motivos: [], ns: ['NS1', 'NS2', 'NS3'] }))
      .toBe('📦 Chegou no SAT: NF 1234 — EMPRESA (12.345.678/0001-90) — aprovada ✅ — 3 relógios: NS1, NS2, NS3')
  })
  it('um relógio, no singular', () => {
    expect(mensagemNota({ numero: '1234', empresa: 'EMPRESA', cnpj: CNPJ, situacao: 'aprovada', motivos: [], ns: ['NS1'] }))
      .toBe('📦 Chegou no SAT: NF 1234 — EMPRESA (12.345.678/0001-90) — aprovada ✅ — 1 relógio: NS1')
  })
  it('reprovada com os motivos; empresa vazia mostra só o CNPJ', () => {
    expect(mensagemNota({ numero: '7', empresa: ' ', cnpj: CNPJ, situacao: 'reprovada', motivos: ['Sem CFOP', 'Valor divergente'], ns: ['NS1', 'NS2'] }))
      .toBe('📦 Chegou no SAT: NF 7 — 12.345.678/0001-90 — reprovada ❌ (Sem CFOP; Valor divergente) — 2 relógios: NS1, NS2')
  })
})

describe('mensagemMudancaNf', () => {
  it('correção da mesma nota', () => {
    expect(mensagemMudancaNf({ tipo: 'correcao', numeroDe: '1234', numeroPara: '1234', empresa: 'EMPRESA', cnpj: CNPJ,
      situacaoDe: 'aprovada', situacaoPara: 'reprovada', motivos: ['Sem CFOP'], ns: ['NS1', 'NS2'] }))
      .toBe('🧾 NF do SAT corrigida: NF 1234 — EMPRESA (12.345.678/0001-90) — aprovada → reprovada ❌ (Sem CFOP) — relógios: NS1, NS2')
  })
  it('troca de nota', () => {
    expect(mensagemMudancaNf({ tipo: 'troca', numeroDe: '1234', numeroPara: '1240', empresa: 'EMPRESA', cnpj: CNPJ,
      situacaoDe: 'aprovada', situacaoPara: 'aprovada', motivos: [], ns: ['NS1'] }))
      .toBe('🧾 NF do SAT trocada: NF 1234 (aprovada) substituída pela NF 1240 — EMPRESA (12.345.678/0001-90) aprovada ✅ — relógios: NS1')
  })
  it('troca sem empresa', () => {
    expect(mensagemMudancaNf({ tipo: 'troca', numeroDe: '1', numeroPara: '2', empresa: '', cnpj: CNPJ,
      situacaoDe: 'reprovada', situacaoPara: 'reprovada', motivos: ['Sem CFOP'], ns: ['NS1'] }))
      .toBe('🧾 NF do SAT trocada: NF 1 (reprovada) substituída pela NF 2 — 12.345.678/0001-90 reprovada ❌ (Sem CFOP) — relógios: NS1')
  })
})
