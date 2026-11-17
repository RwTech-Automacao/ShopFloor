'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { corrigirNfAction, trocarNfAction } from '@/modules/sat/application/actions'
import type { SituacaoNf } from '@/modules/sat/domain/entrada'
import type { MotivoNf } from '@/modules/sat/infra/repository'
import { SituacaoNfCampos } from '../../situacao-nf'

/** Corrigir (a mesma nota muda de situação) ou trocar (nota nova; a antiga fica no histórico). sat.aprovar_nf. */
export function MudarNf({ entradaId, nfAtual, motivos }: { entradaId: string; nfAtual: string; motivos: MotivoNf[] }) {
  const router = useRouter()
  const [modo, setModo] = useState<'corrigir' | 'trocar' | null>(null)
  const [nf, setNf] = useState('')
  const [situacao, setSituacao] = useState<SituacaoNf>('aprovada')
  const [escolhidos, setEscolhidos] = useState<string[]>([])
  const [pendente, iniciar] = useTransition()

  const abrir = (m: 'corrigir' | 'trocar') => { setModo(m); setNf(''); setSituacao('aprovada'); setEscolhidos([]) }

  const confirmar = () => iniciar(async () => {
    const r = modo === 'trocar'
      ? await trocarNfAction(entradaId, nf, situacao, escolhidos)
      : await corrigirNfAction(entradaId, situacao, escolhidos)
    if (!r.ok) { toast.error(r.erro); return }
    toast.success(modo === 'trocar' ? 'NF trocada.' : 'NF corrigida.')
    setModo(null)
    router.refresh()
  })

  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-white p-3">
      <div className="flex flex-wrap gap-2">
        <Button variant={modo === 'corrigir' ? 'default' : 'outline'} onClick={() => abrir('corrigir')}>Corrigir NF {nfAtual}</Button>
        <Button variant={modo === 'trocar' ? 'default' : 'outline'} onClick={() => abrir('trocar')}>Trocar por nota nova</Button>
      </div>
      {modo && (
        <div className="flex flex-col gap-3">
          {modo === 'trocar' && (
            <label className="flex max-w-xs flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">NF nova *</span>
              <Input value={nf} onChange={(e) => setNf(e.target.value)} />
            </label>
          )}
          <SituacaoNfCampos
            nome="situacao-mudanca" situacao={situacao} motivos={escolhidos} opcoes={motivos}
            onSituacao={setSituacao} onMotivos={setEscolhidos}
          />
          <div className="flex gap-2">
            <Button onClick={confirmar} disabled={pendente || (modo === 'trocar' && nf.trim() === '')}>
              {pendente ? 'Salvando…' : 'Confirmar'}
            </Button>
            <Button variant="ghost" onClick={() => setModo(null)}>Cancelar</Button>
          </div>
        </div>
      )}
    </section>
  )
}
