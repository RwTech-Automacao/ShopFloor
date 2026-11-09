'use client'

import { useRouter } from 'next/navigation'
import { Label } from '@/components/ui/label'
import { caminhoRelatorioEmb } from '@/modules/recebimento/domain/emb-relatorio'
import { SeletorEmb } from '../_components/seletor-emb'

/** O seletor de EMB do Relatório de EMB: escolher leva para /recebimento/emb/<emb>. */
export function IrParaEmb({ embs, atual = '' }: { embs: string[]; atual?: string }) {
  const router = useRouter()
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-md sm:min-w-64">
      <Label>EMB</Label>
      <SeletorEmb
        embs={embs}
        valor={atual}
        onEscolher={(e) => { if (e !== atual) router.push(caminhoRelatorioEmb(e)) }}
      />
    </div>
  )
}
