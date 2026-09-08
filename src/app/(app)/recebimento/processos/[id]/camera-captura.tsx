'use client'

import { useEffect, useRef, useState } from 'react'
import { CameraIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Captura de foto pela câmera (webcam no PC / câmera do celular) via getUserMedia.
 * Abre um overlay com o vídeo ao vivo; "Tirar foto" congela o frame num canvas e
 * devolve um File JPEG pro chamador (que faz compressão/upload). O stream é sempre
 * encerrado ao fechar/desmontar. Requer contexto seguro (https ou localhost).
 */
export function CameraCaptura({
  aberto,
  onFechar,
  onCapturar,
}: {
  aberto: boolean
  onFechar: () => void
  onCapturar: (arquivo: File) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!aberto) return
    let cancelado = false
    setErro(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setErro('Este navegador não permite acessar a câmera.')
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      })
      .catch(() => {
        setErro('Não foi possível acessar a câmera. Verifique a permissão do navegador.')
      })

    return () => {
      cancelado = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [aberto])

  function tirarFoto() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const arquivo = new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' })
        onCapturar(arquivo)
        onFechar()
      },
      'image/jpeg',
      0.92,
    )
  }

  if (!aberto) return null

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-black/80 p-4">
      {erro ? (
        <div className="max-w-sm rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-foreground">{erro}</p>
          <Button className="mt-4" variant="outline" onClick={onFechar}>Fechar</Button>
        </div>
      ) : (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            playsInline
            muted
            className="max-h-[70vh] w-auto max-w-full rounded-xl bg-black"
          />
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={onFechar}>
              <XIcon className="size-4" /> Cancelar
            </Button>
            <Button type="button" onClick={tirarFoto}>
              <CameraIcon className="size-4" /> Tirar foto
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
