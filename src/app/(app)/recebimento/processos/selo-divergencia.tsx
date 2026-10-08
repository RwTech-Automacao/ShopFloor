// Selo de divergência (? / ✅), compartilhado pela grade de Processos e pelo card do Fluxo.

/** O selo de uma divergência. Estado vem de `estadoDaDivergencia` (única fonte da verdade); é um
 *  botão (toque, não só mouse) e o `title` é complemento. Sem divergência, não renderiza nada. */
export function SeloDivergencia({
  estado,
  texto,
  onClick,
}: {
  estado: 'pendente' | 'justificada'
  texto: string
  onClick: () => void
}) {
  const pendente = estado === 'pendente'
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        pendente
          ? 'Sem justificativa — clique para explicar'
          : `Justificada: ${[...texto.trim()].slice(0, 80).join('')}${[...texto.trim()].length > 80 ? '…' : ''}`
      }
      aria-label={pendente ? 'Divergência sem justificativa' : 'Divergência justificada'}
      data-estado={estado}
      className={
        // `relative z-10`: no card, o link que cobre tudo fica por baixo e não engole o toque.
        pendente
          ? 'relative z-10 inline-flex size-5 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800 hover:bg-amber-200'
          : 'relative z-10 inline-flex size-5 items-center justify-center rounded-full text-xs text-green-600 hover:bg-green-100'
      }
    >
      {pendente ? '?' : '✅'}
    </button>
  )
}
