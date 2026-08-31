import type { ItemLote } from './tipos-lote'

/**
 * Lote coletivo em andamento (itens empilhados, ainda não enviados), persistido em localStorage
 * por (pmo, op, posto) para sobreviver a refresh / fechar aba NO MESMO NAVEGADOR — espelha
 * `nqa-progresso-local.ts`.
 */
const PREFIXO = 'sf:lote:'
function chave(pmo: string, op: string, posto: string) { return `${PREFIXO}${pmo}|${op}|${posto}` }

/** Lê o lote salvo para este contexto, ou null se não houver / estiver corrompido / localStorage falhar. */
export function lerLoteLocal(pmo: string, op: string, posto: string): ItemLote[] | null {
  try {
    const raw = localStorage.getItem(chave(pmo, op, posto))
    if (!raw) return null
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as ItemLote[]) : null
  } catch { return null }
}

/** Grava o lote. Lote vazio remove a chave (não deixa lixo). Silencioso se o localStorage falhar. */
export function salvarLoteLocal(pmo: string, op: string, posto: string, lote: ItemLote[]): void {
  try {
    if (lote.length === 0) { localStorage.removeItem(chave(pmo, op, posto)); return }
    localStorage.setItem(chave(pmo, op, posto), JSON.stringify(lote))
  } catch { /* ignore */ }
}

/** Apaga o lote salvo deste contexto (ao enviar tudo, descartar ou trocar de contexto). */
export function limparLoteLocal(pmo: string, op: string, posto: string): void {
  try { localStorage.removeItem(chave(pmo, op, posto)) } catch { /* ignore */ }
}
