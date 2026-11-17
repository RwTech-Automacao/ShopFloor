'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { salvarMotivoAction } from '@/modules/sat/application/actions'
import type { MotivoNf } from '@/modules/sat/infra/repository'

function LinhaMotivo({ m, salvar, pendente }: { m: MotivoNf; salvar: (id: string, t: string, a: boolean) => void; pendente: boolean }) {
  const [texto, setTexto] = useState(m.texto)
  const [ativo, setAtivo] = useState(m.ativo)
  const mudou = texto.trim() !== m.texto || ativo !== m.ativo
  return (
    <div className="flex flex-wrap items-center gap-3 border-t py-2 first:border-t-0">
      <Input className="max-w-md flex-1" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={200} />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={ativo} onCheckedChange={(v) => setAtivo(v === true)} />
        Ativo
      </label>
      <Button variant="outline" disabled={!mudou || pendente || texto.trim() === ''} onClick={() => salvar(m.id, texto, ativo)}>
        Salvar
      </Button>
    </div>
  )
}

export function MotivosTela({ motivos }: { motivos: MotivoNf[] }) {
  const router = useRouter()
  const [novo, setNovo] = useState('')
  const [pendente, iniciar] = useTransition()

  const salvar = (id: string | null, texto: string, ativo: boolean) => iniciar(async () => {
    const r = await salvarMotivoAction(id, texto, ativo)
    if (!r.ok) { toast.error(r.erro); return }
    toast.success('Motivo salvo.')
    if (id === null) setNovo('')
    router.refresh()
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3">
        <Input className="max-w-md flex-1" placeholder="Novo motivo" value={novo} maxLength={200} onChange={(e) => setNovo(e.target.value)} />
        <Button disabled={pendente || novo.trim() === ''} onClick={() => salvar(null, novo, true)}>Adicionar</Button>
      </div>
      <div className="rounded-lg border bg-white px-3 py-1">
        {motivos.map((m) => <LinhaMotivo key={`${m.id}-${m.texto}-${m.ativo}`} m={m} salvar={salvar} pendente={pendente} />)}
        {motivos.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Nenhum motivo cadastrado.</p>}
      </div>
      <p className="text-xs text-muted-foreground">Motivo desativado some da tela de entrada; as entradas antigas guardam o texto.</p>
    </div>
  )
}
