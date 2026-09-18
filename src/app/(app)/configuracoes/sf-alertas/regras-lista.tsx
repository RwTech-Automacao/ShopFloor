'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { formatarMeta } from '@/modules/alertas/domain/taxa'
import { resumoJanela } from '@/modules/alertas/domain/janela'
import { NOME_CANAL, type Canal } from '@/modules/alertas/domain/tipos'
import type { DestinatarioDisponivel, RegraAlerta } from '@/modules/alertas/domain/regra'
import { alternarRegraAtivaAction, excluirRegraAction } from '@/modules/alertas/application/alertas-actions'
import { RegraDialog } from './regra-dialog'
import { ERRO_REGRA_EXCLUIDA } from './regra-form'

const TOAST = { position: 'bottom-center' } as const

export function RegrasLista({
  regras,
  postos,
  destinatarios,
  configurados,
}: {
  regras: RegraAlerta[]
  postos: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
}) {
  const [dialogo, setDialogo] = useState<{ aberto: boolean; regra: RegraAlerta | null }>({ aberto: false, regra: null })
  const [pendente, startTransition] = useTransition()
  const { confirmar, dialog } = useConfirmacao()
  const router = useRouter()

  // Erro da action: toast embaixo; se outro gestor já excluiu a regra, recarrega a lista (ela some).
  function falhou(erro: string) {
    toast.error(erro, TOAST)
    if (erro === ERRO_REGRA_EXCLUIDA) router.refresh()
  }

  const nomes = new Map(destinatarios.map((d) => [d.usuarioId, d.nome]))

  function alternar(regra: RegraAlerta, ativa: boolean) {
    startTransition(async () => {
      const r = await alternarRegraAtivaAction(regra.id, ativa)
      if (!r.ok) falhou(r.erro)
      else toast.success(ativa ? 'Regra ativada' : 'Regra desativada', TOAST)
    })
  }

  async function excluir(regra: RegraAlerta) {
    const ok = await confirmar({
      titulo: `Excluir "${regra.nome}"?`,
      descricao: 'A regra sai da lista e para de alertar; o histórico de ocorrências continua disponível.',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await excluirRegraAction(regra.id)
      if (!r.ok) falhou(r.erro)
      else toast.success('Regra excluída', TOAST)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          className="bg-enterplak hover:bg-enterplak-700"
          onClick={() => setDialogo({ aberto: true, regra: null })}
        >
          <PlusIcon /> Nova regra
        </Button>
      </div>

      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Postos</TableHead>
              <TableHead>Taxa mínima de aprovação</TableHead>
              <TableHead>Janela</TableHead>
              <TableHead>Destinatários</TableHead>
              <TableHead>Canais</TableHead>
              <TableHead>Ativa</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {regras.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  Nenhuma regra de alerta cadastrada.
                </TableCell>
              </TableRow>
            )}
            {regras.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.nome}</TableCell>
                <TableCell>{r.postos.join(', ')}</TableCell>
                <TableCell>{formatarMeta(r.taxaMinima)}%</TableCell>
                <TableCell>{resumoJanela({ tipo: r.janelaTipo, valor: r.janelaValor })}</TableCell>
                <TableCell>{r.destinatarios.map((id) => nomes.get(id) ?? '—').join(', ')}</TableCell>
                <TableCell>{r.canais.map((c) => NOME_CANAL[c]).join(', ')}</TableCell>
                <TableCell>
                  <Switch checked={r.ativa} disabled={pendente} onCheckedChange={(valor) => alternar(r, valor)} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Editar regra"
                      onClick={() => setDialogo({ aberto: true, regra: r })}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Excluir regra"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={pendente}
                      onClick={() => excluir(r)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 lg:hidden">
        {regras.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            Nenhuma regra de alerta cadastrada.
          </p>
        )}
        {regras.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{r.nome}</span>
              <Switch checked={r.ativa} disabled={pendente} onCheckedChange={(valor) => alternar(r, valor)} />
            </div>
            <span className="text-sm text-muted-foreground">
              {r.postos.join(', ')} · mínimo {formatarMeta(r.taxaMinima)}% · {resumoJanela({ tipo: r.janelaTipo, valor: r.janelaValor })}
            </span>
            <span className="text-xs text-muted-foreground">
              {r.canais.map((c) => NOME_CANAL[c]).join(', ')} ·{' '}
              {r.destinatarios.map((id) => nomes.get(id) ?? '—').join(', ')}
            </span>
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Editar regra" onClick={() => setDialogo({ aberto: true, regra: r })}>
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Excluir regra"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={pendente}
                onClick={() => excluir(r)}
              >
                <Trash2Icon />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <RegraDialog
        aberto={dialogo.aberto}
        regra={dialogo.regra}
        postos={postos}
        destinatarios={destinatarios}
        configurados={configurados}
        onFechar={() => setDialogo({ aberto: false, regra: null })}
        onRegraExcluida={() => {
          setDialogo({ aberto: false, regra: null })
          router.refresh()
        }}
      />
      {dialog}
    </div>
  )
}
