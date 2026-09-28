'use client'

import { useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'

/**
 * Controles do canvas numa barra só: enquadrar, afastar, o zoom em porcentagem e aproximar.
 *
 * Substitui o <Controls> do React Flow porque ele só aceita filhos DEPOIS dos botões dele — não
 * havia como pôr a porcentagem entre o "−" e o "+".
 *
 * A porcentagem existe porque a roda do mouse é boa pra procurar e ruim pra repetir: quem monta a
 * TV quer voltar sempre no MESMO zoom, e digitar 65 é a única forma de acertar duas vezes seguidas.
 *
 * Todos os alvos têm a mesma medida — a barra tem que ler como um controle só, não como peças
 * remendadas.
 */
export function ControlesCanvas({ pct, onAplicar, onMais, onMenos, onEnquadrar }: {
  pct: number
  onAplicar: (pct: number) => void
  onMais: () => void
  onMenos: () => void
  onEnquadrar: () => void
}) {
  const [texto, setTexto] = useState('')
  const [editando, setEditando] = useState(false)

  function aplicar() {
    const n = Number(texto.replace(/[^\d]/g, ''))
    // Fora da faixa do canvas (10% a 400%) o React Flow ignoraria calado; melhor grudar no limite.
    if (Number.isFinite(n) && n > 0) onAplicar(Math.min(400, Math.max(10, n)))
    setEditando(false)
  }

  const alvo = 'flex size-8 shrink-0 items-center justify-center text-foreground transition-colors hover:bg-accent'

  return (
    <div className="flex divide-x divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <button type="button" onClick={onEnquadrar} aria-label="Enquadrar" title="Enquadrar" className={alvo}>
        <Maximize2 className="size-4" />
      </button>
      <button type="button" onClick={onMenos} aria-label="Afastar" title="Afastar" className={alvo}>
        <Minus className="size-4" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label="Zoom do canvas em porcentagem"
        title="Zoom em % — digite e tecle Enter"
        value={editando ? texto : String(pct)}
        onFocus={(e) => { setEditando(true); setTexto(String(pct)); e.currentTarget.select() }}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={aplicar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
          if (e.key === 'Escape') { setEditando(false); e.currentTarget.blur() }
        }}
        className={`${alvo} bg-transparent text-center text-[11px] tabular-nums outline-none focus:bg-accent`}
      />
      <button type="button" onClick={onMais} aria-label="Aproximar" title="Aproximar" className={alvo}>
        <Plus className="size-4" />
      </button>
    </div>
  )
}
