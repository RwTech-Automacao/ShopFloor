'use client'

import { useRef, useTransition } from 'react'
import imageCompression from 'browser-image-compression'
import { ImagePlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { anexarFoto, removerFoto } from '@/modules/recebimento/application/anexos-actions'
import type { AnexoComUrl } from '@/modules/recebimento/infra/anexo-repository'

const LIMITE = 3
const UM_MB = 1_048_576

/**
 * Card "Fotos (N/3)" na tela de detalhe. Upload imediato: ao escolher/tirar a
 * foto, comprime no cliente se passar de 1 MB e envia na hora via `anexarFoto`
 * (não depende de nenhum botão Salvar). Exclusão também é imediata.
 * `somenteLeitura` (processo terminal) esconde os controles de anexar/excluir.
 */
export function AnexosProcesso({
  processoId,
  anexos,
  somenteLeitura,
}: {
  processoId: string
  anexos: AnexoComUrl[]
  somenteLeitura: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [ocupado, startTransition] = useTransition()

  const podeAdicionar = !somenteLeitura && anexos.length < LIMITE

  async function aoSelecionar(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = '' // permite re-selecionar o mesmo arquivo depois
    if (!arquivo) return
    if (!arquivo.type.startsWith('image/')) {
      toast.error('Selecione uma imagem.')
      return
    }

    let paraEnviar: File = arquivo
    if (arquivo.size > UM_MB) {
      try {
        paraEnviar = await imageCompression(arquivo, {
          maxSizeMB: 1,
          maxWidthOrHeight: 2000,
          useWebWorker: true,
        })
      } catch {
        toast.error('Não foi possível processar a imagem.')
        return
      }
    }

    const fd = new FormData()
    fd.append('arquivo', paraEnviar, arquivo.name)
    startTransition(async () => {
      const r = await anexarFoto(processoId, fd)
      if (r.ok) toast.success('Foto anexada.')
      else toast.error(r.erro)
    })
  }

  function aoRemover(id: string) {
    if (!window.confirm('Remover esta foto?')) return
    startTransition(async () => {
      const r = await removerFoto(id)
      if (r.ok) toast.success('Foto removida.')
      else toast.error(r.erro)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Fotos ({anexos.length}/{LIMITE})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {anexos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma foto anexada.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {anexos.map((anexo) => (
              <div
                key={anexo.id}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border"
              >
                <a href={anexo.url} target="_blank" rel="noopener noreferrer">
                  {/* Signed URL dinâmica do Supabase Storage — <img> direto (sem next/image). */}
                  <img
                    src={anexo.url}
                    alt={anexo.nomeOriginal}
                    className="h-full w-full object-cover"
                  />
                </a>
                {!somenteLeitura && (
                  <button
                    type="button"
                    onClick={() => aoRemover(anexo.id)}
                    disabled={ocupado}
                    aria-label="Remover foto"
                    className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-50"
                  >
                    <Trash2Icon className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {podeAdicionar && (
          <div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={aoSelecionar}
            />
            <Button
              type="button"
              variant="outline"
              disabled={ocupado}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlusIcon />
              {ocupado ? 'Enviando…' : 'Adicionar foto'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
