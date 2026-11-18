'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { MAX_MOTIVO_OUTRO, rotuloStatus, type SituacaoNf } from '@/modules/sat/domain/entrada'
import type { MotivoNf } from '@/modules/sat/infra/repository'
import { cn } from '@/lib/utils'

/**
 * Aprovada / reprovada e, na reprovada, os motivos (1+ obrigatório), na ordem da lista. O motivo que exige texto
 * ("Outro") abre o campo "Qual?" logo abaixo, obrigatório. Usado na entrada e na mudança da NF.
 */
export function SituacaoNfCampos({
  situacao, motivos, outro, opcoes, onSituacao, onMotivos, onOutro, nome,
}: {
  situacao: SituacaoNf
  motivos: string[]
  /** O texto do "Outro". */
  outro: string
  opcoes: MotivoNf[]
  onSituacao: (s: SituacaoNf) => void
  onMotivos: (m: string[]) => void
  onOutro: (t: string) => void
  nome: string
}) {
  const ativos = opcoes.filter((m) => m.ativo)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-4 text-sm">
        {(['aprovada', 'reprovada'] as const).map((s) => (
          <label key={s} className="flex items-center gap-2">
            <input type="radio" name={nome} checked={situacao === s} onChange={() => onSituacao(s)} />
            NF {s}
          </label>
        ))}
      </div>
      {situacao === 'reprovada' && (
        <div className="flex flex-col gap-1 rounded-md border p-2">
          <span className="text-xs text-muted-foreground">Motivo(s) da reprovação — ao menos um</span>
          {ativos.length === 0 && (
            <span className="text-sm text-destructive">
              Nenhum motivo de reprovação cadastrado ainda.
            </span>
          )}
          {ativos.map((m) => {
            const marcado = motivos.includes(m.id)
            return (
              <div key={m.id} className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={marcado}
                    onCheckedChange={(v) => onMotivos(v === true ? [...motivos, m.id] : motivos.filter((x) => x !== m.id))}
                  />
                  {m.texto}
                </label>
                {m.exigeTexto && marcado && (
                  <label className="ml-6 flex flex-col gap-1 text-sm">
                    <span className="text-xs text-muted-foreground">Qual? *</span>
                    <Input
                      value={outro} required maxLength={MAX_MOTIVO_OUTRO} placeholder="Descreva o motivo"
                      aria-invalid={outro.trim() === ''} onChange={(e) => onOutro(e.target.value)}
                    />
                  </label>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function StatusNf({ situacao }: { situacao: SituacaoNf }) {
  return (
    <Badge className={cn(situacao === 'aprovada' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800')}>
      {rotuloStatus(situacao)}
    </Badge>
  )
}
