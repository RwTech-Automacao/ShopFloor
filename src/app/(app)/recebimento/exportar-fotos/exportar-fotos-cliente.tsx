'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import JSZip from 'jszip'
import { DownloadIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import {
  obterFotosDoMes,
  limparFotosDoMes,
} from '@/modules/recebimento/application/exportar-fotos-actions'
import { nomeArquivoFoto } from '@/modules/recebimento/domain/anexo'

/** Uma linha por mês: exportar o ZIP (montado aqui no navegador) e limpar. */
export function ExportarFotosCliente({
  mes,
  rotulo,
  total,
}: {
  mes: string
  rotulo: string
  total: number
}) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)
  const { confirmar, dialog } = useConfirmacao()

  async function exportar() {
    setOcupado(true)
    try {
      const r = await obterFotosDoMes(mes)
      if (!r.ok) {
        toast.error(r.erro)
        return
      }
      const zip = new JSZip()
      let ignoradas = 0
      for (const foto of r.fotos) {
        try {
          const resp = await fetch(foto.signedUrl)
          if (!resp.ok) throw new Error('fetch falhou')
          const blob = await resp.blob()
          zip.file(
            nomeArquivoFoto(foto.pedido, foto.item, foto.numero, foto.indice, foto.ext),
            blob,
          )
        } catch {
          ignoradas += 1
        }
      }
      const conteudo = await zip.generateAsync({ type: 'blob' })
      dispararDownload(conteudo, `Fotos_${mes}.zip`)
      toast.success(
        ignoradas > 0 ? `ZIP gerado (${ignoradas} foto(s) ignorada(s)).` : 'ZIP gerado.',
      )
    } catch {
      toast.error('Não foi possível gerar o ZIP.')
    } finally {
      setOcupado(false)
    }
  }

  async function limpar() {
    if (
      !(await confirmar({
        titulo: `Apagar TODAS as ${total} foto(s) de ${rotulo}?`,
        descricao: 'Faça o export antes — isto não tem desfazer.',
        rotuloConfirmar: 'Apagar',
      }))
    ) {
      return
    }
    setOcupado(true)
    void (async () => {
      try {
        const r = await limparFotosDoMes(mes)
        if (r.ok) {
          toast.success(`${r.removidos} foto(s) removida(s).`)
          router.refresh()
        } else {
          toast.error(r.erro)
        }
      } finally {
        setOcupado(false)
      }
    })()
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
      <span className="font-medium">
        {rotulo}{' '}
        <span className="text-muted-foreground">
          ({total} foto{total === 1 ? '' : 's'})
        </span>
      </span>
      <div className="flex gap-2">
        <Button onClick={exportar} disabled={ocupado} className="bg-enterplak hover:bg-enterplak-700">
          <DownloadIcon />
          {ocupado ? 'Processando…' : 'Exportar ZIP'}
        </Button>
        <Button onClick={limpar} disabled={ocupado} variant="outline">
          <Trash2Icon />
          Limpar fotos do mês
        </Button>
      </div>
      {dialog}
    </div>
  )
}

function dispararDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
