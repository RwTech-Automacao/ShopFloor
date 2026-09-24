'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { rotuloPassagem } from '@/modules/recebimento/domain/etapa-processo'
import type { RegistroRecebimento } from '@/modules/recebimento/infra/registros-repository'

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  // Fuso fixo de Brasília: os timestamps vêm em UTC do banco e esta tela renderiza no servidor
  // (que roda em UTC). Sem isto, os horários apareceriam 3h à frente em produção.
  timeZone: 'America/Sao_Paulo',
})

function formatarDataHora(valor: string): string {
  return formatadorData.format(new Date(valor))
}

/** Valor do diff como a tela mostra: nulo/vazio vira travessão (era "em branco"). */
function valorDiff(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

/** Cor da caixa de destino, pra bater com as caixas do Fluxo. */
function classePorEtapa(etapa: string | undefined): string {
  if (etapa === 'reprovado') return 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300'
  if (etapa === 'almoxarifado') return 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300'
  if (etapa === 'qualidade') return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
  return ''
}

interface RegistrosTabelaProps {
  linhas: RegistroRecebimento[]
  /** campo → rótulo de `configuracao_campos`: o detalhe mostra "Quantidade recebida". */
  rotulos: Record<string, string>
}

export function RegistrosTabela({ linhas, rotulos }: RegistrosTabelaProps) {
  const [sel, setSel] = useState<RegistroRecebimento | null>(null)

  if (linhas.length === 0) {
    return (
      <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
        Nenhum registro com esses filtros.
      </p>
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data e hora</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Fabricante</TableHead>
              <TableHead>Part number</TableHead>
              <TableHead>Etapa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow
                key={l.id}
                onClick={() => setSel(l)}
                className="cursor-pointer"
                title="Ver o que mudou neste registro"
              >
                <TableCell className="whitespace-nowrap tabular-nums">{formatarDataHora(l.dataHora)}</TableCell>
                <TableCell>{l.colaborador || '—'}</TableCell>
                <TableCell className="font-medium">
                  {l.item || '—'}
                  {/* O número do processo desempata o MESMO item duas vezes na mesma EMB. */}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">#{l.numero}</span>
                </TableCell>
                <TableCell className="max-w-64 truncate" title={l.descricao || undefined}>
                  {l.descricao || '—'}
                </TableCell>
                <TableCell className="max-w-40 truncate" title={l.fornecedor || undefined}>
                  {l.fornecedor || '—'}
                </TableCell>
                <TableCell>{l.fabricante || '—'}</TableCell>
                <TableCell>{l.partNumber || '—'}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {l.passagem ? (
                    <Badge variant="secondary" className={classePorEtapa(l.passagem.para)}>
                      {rotuloPassagem(l.passagem)}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={sel !== null} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {sel && (
            <>
              <DialogHeader>
                <DialogTitle>O que mudou</DialogTitle>
              </DialogHeader>
              <dl className="space-y-1.5 text-sm">
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0 text-muted-foreground">Data e hora</dt>
                  <dd className="min-w-0 flex-1 tabular-nums">{formatarDataHora(sel.dataHora)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0 text-muted-foreground">Colaborador</dt>
                  <dd className="min-w-0 flex-1">{sel.colaborador || '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0 text-muted-foreground">Item</dt>
                  <dd className="min-w-0 flex-1">
                    {sel.item || '—'} <span className="text-muted-foreground">#{sel.numero}</span>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0 text-muted-foreground">Etapa</dt>
                  <dd className="min-w-0 flex-1">{sel.passagem ? rotuloPassagem(sel.passagem) : '—'}</dd>
                </div>
              </dl>

              <div className="mt-2 border-t border-border pt-3">
                {sel.alteracoes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Este registro não alterou campo nenhum.
                  </p>
                ) : (
                  <dl className="space-y-1.5 text-sm">
                    {sel.alteracoes.map((a) => (
                      <div key={a.campo} className="flex gap-2">
                        <dt className="w-40 shrink-0 text-muted-foreground">
                          {rotulos[a.campo] ?? a.campo}
                        </dt>
                        <dd className="min-w-0 flex-1">
                          <span className="text-muted-foreground">{valorDiff(a.de)}</span>
                          <span className="mx-1.5">→</span>
                          <span className="font-medium">{valorDiff(a.para)}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
