'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { salvarJustificativaDivergencia } from '@/modules/recebimento/application/justificar-divergencia'
import { LIMITE_JUSTIFICATIVA } from '@/modules/recebimento/domain/divergencia'

export interface AlvoJustificativa {
  id: string
  numero: string
  /** Texto gravado hoje ('' = ninguém justificou). */
  texto: string
  /** Nome de quem escreveu por último, se conhecido. */
  autor: string
  /** ISO do último salvamento, se houver. */
  quando: string | null
}

interface Props {
  alvo: AlvoJustificativa
  /** `recebimento.administrar`. Sem isso a caixa é só leitura e não há botão de salvar. */
  podeJustificar: boolean
  onFechar: () => void
  /** Chamado depois de salvar com sucesso, com o texto exato que foi enviado. */
  onSalvo: (id: string, texto: string) => void
}

function formatarQuando(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Explicação de uma divergência de quantidade: o porquê e o que foi alinhado com o fornecedor.
 * Vazio é estado válido (= ninguém justificou) — salvar vazio apaga e o selo volta a `?`.
 */
export function JustificarDivergenciaDialog({ alvo, podeJustificar, onFechar, onSalvo }: Props) {
  const [texto, setTexto] = useState(alvo.texto)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, startSalvar] = useTransition()

  function salvar() {
    setErro(null)
    startSalvar(async () => {
      const r = await salvarJustificativaDivergencia(alvo.id, texto)
      if (r.ok) {
        onSalvo(alvo.id, texto)
        onFechar()
      } else {
        setErro(r.erro)
      }
    })
  }

  const quando = formatarQuando(alvo.quando)
  const autoria = [alvo.autor && `por ${alvo.autor}`, quando && `em ${quando}`].filter(Boolean).join(' ')

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Divergência de quantidade — processo Nº {alvo.numero}</DialogTitle>
          <DialogDescription>
            {podeJustificar
              ? 'Explique o porquê da divergência e o que foi alinhado com o fornecedor.'
              : 'Justificativa da divergência. Somente quem administra o Recebimento pode editar.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Textarea
            aria-label="Justificativa da divergência"
            value={texto}
            readOnly={!podeJustificar}
            maxLength={LIMITE_JUSTIFICATIVA}
            rows={6}
            placeholder={podeJustificar ? 'Escreva a justificativa…' : 'Sem justificativa.'}
            onChange={(e) => setTexto(e.target.value)}
          />
          <div className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span>{autoria ? `Última edição ${autoria}` : ''}</span>
            {podeJustificar && (
              <span>
                {[...texto].length}/{LIMITE_JUSTIFICATIVA}
              </span>
            )}
          </div>
          {erro && (
            <p role="alert" className="text-sm text-red-600">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            {podeJustificar ? 'Cancelar' : 'Fechar'}
          </Button>
          {podeJustificar && (
            <Button className="bg-enterplak hover:bg-enterplak-700" disabled={salvando} onClick={salvar}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
