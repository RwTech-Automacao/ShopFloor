'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NOME_TIPO_REGRA, type Canal, type TipoRegra } from '@/modules/alertas/domain/tipos'
import type { DestinatarioDisponivel, RegraAlerta } from '@/modules/alertas/domain/regra'
import { RegraForm } from './regra-form'
import { TipoEscolha } from './tipo-escolha'

interface PropsRegra {
  regra: RegraAlerta | null
  postos: string[]
  pmos: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
  canalConfigurado: boolean
  onFechar: () => void
  onRegraExcluida?: () => void
}

/**
 * Regra nova: primeiro os 3 cartões de tipo, depois o formulário do tipo escolhido ("Trocar tipo"
 * volta). Editar: direto no formulário do tipo da regra — o tipo não muda depois de criado.
 */
export function RegraConteudo({
  regra,
  postos,
  pmos,
  destinatarios,
  configurados,
  canalConfigurado,
  onFechar,
  onRegraExcluida,
}: PropsRegra) {
  const [escolhido, setEscolhido] = useState<TipoRegra | null>(null)
  const tipo = regra?.tipo ?? escolhido

  if (!tipo) return <TipoEscolha onEscolher={setEscolhido} />

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Tipo: <strong className="text-foreground">{NOME_TIPO_REGRA[tipo]}</strong>
      </p>
      <RegraForm
        tipo={tipo}
        regra={regra}
        postos={postos}
        pmosDisponiveis={pmos}
        destinatarios={destinatarios}
        configurados={configurados}
        canalConfigurado={canalConfigurado}
        onSalvo={onFechar}
        onCancelar={onFechar}
        onVoltar={regra ? undefined : () => setEscolhido(null)}
        onRegraExcluida={onRegraExcluida}
      />
    </div>
  )
}

export function RegraDialog({ aberto, ...props }: PropsRegra & { aberto: boolean }) {
  return (
    <Dialog open={aberto} onOpenChange={(valor) => !valor && props.onFechar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.regra ? 'Editar regra' : 'Nova regra'}</DialogTitle>
          {!props.regra && (
            <DialogDescription>Escolha o que a regra acompanha. O tipo não muda depois de criado.</DialogDescription>
          )}
        </DialogHeader>
        {/* Monta de novo a cada abertura: a escolha do tipo não sobra de uma regra para a outra. */}
        {aberto && <RegraConteudo key={props.regra?.id ?? 'nova'} {...props} />}
      </DialogContent>
    </Dialog>
  )
}
