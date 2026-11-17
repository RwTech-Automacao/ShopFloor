/** Formatação das telas do SAT (data/hora de Brasília, dinheiro em reais). */
export const dia = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
export const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—'
export const reais = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
