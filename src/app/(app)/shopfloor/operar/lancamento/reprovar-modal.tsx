'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { DefeitoModal } from './defeito-modal'

function norm(s: string) {
  return s.trim().replace(/\s+/g, ' ').toUpperCase()
}

interface DefeitoLinha {
  codigo: string
  posicao: string
}

export function ReprovarModal({
  aberto,
  codigoInicial,
  catalogo,
  pmo,
  op,
  posto,
  snEsperado,
  onConfirmar,
  onCancelar,
}: {
  aberto: boolean
  codigoInicial: string
  /** Catálogo de defeitos do posto — o defeito é sempre ESCOLHIDO dele, nunca digitado. */
  catalogo: { codigo: string; tipo: number }[]
  pmo: string
  op: string
  posto: string
  snEsperado: string
  onConfirmar: (dados: { defeitos: { codigo: string; posicao: string }[]; sn: string }) => void
  onCancelar: () => void
}) {
  const [defeitosSel, setDefeitosSel] = useState<DefeitoLinha[]>([{ codigo: codigoInicial, posicao: '' }])
  const [sn, setSn] = useState('')
  const [erro, setErro] = useState('')
  const snRef = useRef<HTMLInputElement>(null)
  // Linha cujo defeito está sendo escolhido no modal; null = fechado.
  const [escolhendo, setEscolhendo] = useState<number | null>(null)

  // Reseta SEMPRE (abrir/fechar ou trocar o defeito inicial) — evita SN/defeito em cache do bipe anterior.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDefeitosSel([{ codigo: codigoInicial, posicao: '' }])
    setSn('')
    setErro('')
  }, [aberto, codigoInicial])

  function confirmar() {
    const preenchidos = defeitosSel.filter((d) => d.codigo.trim() !== '' && d.posicao.trim() !== '')
    if (preenchidos.length === 0) {
      setErro('Informe ao menos um defeito com código e posição')
      return
    }
    if (sn.trim() === '') {
      setErro('Bipe o Nº de Série da peça')
      snRef.current?.focus()
      return
    }
    if (snEsperado !== '' && norm(sn) !== norm(snEsperado)) {
      setErro('SN diferente — bipe a mesma peça')
      setSn('') // bipe errado → limpa o campo pra bipar de novo
      setTimeout(() => snRef.current?.focus(), 0)
      return
    }
    onConfirmar({ defeitos: preenchidos, sn })
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(open) => {
        if (!open) onCancelar()
      }}
    >
      <DialogContent className="max-h-[calc(90dvh-var(--kb-inset,0px))] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar reprova</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Defeitos</Label>
            {defeitosSel.map((d, i) => (
              <div key={i} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
                {/* Botão em vez de campo com lista: o defeito vem do catálogo, pelo mesmo modal da escolha
                    inicial (busca, mais usados, cards) — não entra código digitado que não existe. */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEscolhendo(i)}
                  title={d.codigo || undefined}
                  className={`h-9 justify-start truncate font-normal ${d.codigo ? '' : 'text-muted-foreground'}`}
                >
                  {d.codigo || 'Escolher defeito…'}
                </Button>
                <Input
                  value={d.posicao}
                  placeholder="Posição"
                  autoFocus={i === 0}
                  onChange={(e) => {
                    setDefeitosSel(defeitosSel.map((x, idx) => (idx === i ? { ...x, posicao: e.target.value } : x)))
                    if (erro) setErro('')
                  }}
                  onKeyDown={(e) => {
                    // Enter na Posição → vai pro campo do Nº de Série (fluxo sem mouse).
                    if (e.key === 'Enter') { e.preventDefault(); snRef.current?.focus() }
                  }}
                />
                <button
                  type="button"
                  aria-label="Remover defeito"
                  onClick={() => setDefeitosSel(defeitosSel.length > 1 ? defeitosSel.filter((_, idx) => idx !== i) : defeitosSel)}
                  className="pb-2 text-muted-foreground hover:text-red-600 disabled:opacity-30"
                  disabled={defeitosSel.length <= 1}
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setDefeitosSel([...defeitosSel, { codigo: '', posicao: '' }])}
              className="self-start text-sm font-medium text-enterplak hover:underline"
            >
              <Plus className="mr-1 inline size-4" /> Adicionar defeito
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reprova-sn">Bipe o SN da peça</Label>
            <Input
              id="reprova-sn"
              ref={snRef}
              value={sn}
              onChange={(e) => {
                setSn(e.target.value)
                if (erro) setErro('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirmar()
                }
              }}
              aria-invalid={erro !== '' || undefined}
            />
            {erro && <p className="text-sm text-red-600">{erro}</p>}
          </div>
        </div>
        {/* Dentro do Popup de propósito: o diálogo aninhado fica "por cima" deste, e tocar nele não conta
            como clique fora (que fecharia a reprova no meio). */}
        <DefeitoModal
          aberto={escolhendo !== null}
          pmo={pmo}
          op={op}
          posto={posto}
          catalogo={catalogo}
          onEscolher={(codigo) => {
            setDefeitosSel(defeitosSel.map((x, idx) => (idx === escolhendo ? { ...x, codigo } : x)))
            setEscolhendo(null)
            if (erro) setErro('')
          }}
          onFechar={() => setEscolhendo(null)}
        />
        <DialogFooter>
          <Button onClick={confirmar} className="bg-enterplak hover:bg-enterplak-700">
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
