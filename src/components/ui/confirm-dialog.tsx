'use client'

import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface OpcoesConfirmacao {
  titulo: string
  descricao?: string
  /** Texto do botão que confirma a ação. Padrão: 'Excluir'. */
  rotuloConfirmar?: string
  /** Texto do botão que cancela. Padrão: 'Cancelar'. */
  rotuloCancelar?: string
}

interface UseConfirmacao {
  /** Abre o modal e resolve `true` (confirmou) ou `false` (cancelou/fechou). */
  confirmar: (opcoes: OpcoesConfirmacao) => Promise<boolean>
  /** Renderize UMA vez no JSX do componente — é o modal controlado pelo hook. */
  dialog: React.ReactNode
}

/**
 * Substitui o `window.confirm` nativo por um modal com a cara do sistema, mantendo a
 * ergonomia síncrona: `if (!(await confirmar({ ... }))) return`. A quebra assíncrona
 * (o usuário responde depois) fica escondida aqui, resolvendo a Promise no clique.
 */
export function useConfirmacao(): UseConfirmacao {
  const [aberto, setAberto] = useState(false)
  const [opcoes, setOpcoes] = useState<OpcoesConfirmacao | null>(null)
  // Guarda o `resolve` da Promise em aberto para responder no clique/fechamento.
  const resolveRef = useRef<((valor: boolean) => void) | null>(null)

  const responder = useCallback((valor: boolean) => {
    setAberto(false)
    resolveRef.current?.(valor)
    resolveRef.current = null
  }, [])

  const confirmar = useCallback((novas: OpcoesConfirmacao) => {
    setOpcoes(novas)
    setAberto(true)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  const dialog = (
    <Dialog
      open={aberto}
      // Cobre Esc, clique fora e o X: qualquer fechamento que não seja o Confirmar
      // resolve `false`.
      onOpenChange={(estaAberto) => {
        if (!estaAberto) responder(false)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{opcoes?.titulo}</DialogTitle>
          {/* base-ui exige Description para acessibilidade; fica vazia se não houver. */}
          <DialogDescription>{opcoes?.descricao ?? ''}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => responder(false)}>
            {opcoes?.rotuloCancelar ?? 'Cancelar'}
          </Button>
          <Button
            className="bg-enterplak hover:bg-enterplak-700"
            onClick={() => responder(true)}
          >
            {opcoes?.rotuloConfirmar ?? 'Excluir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { confirmar, dialog }
}
