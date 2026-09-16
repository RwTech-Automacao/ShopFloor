'use client'

import { useState, useTransition } from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { buscarIntegracaoRepinmetro } from '@/modules/shopfloor/application/repinmetro-actions'
import type { IntegracaoRep } from '@/modules/shopfloor/infra/repinmetro-repository'
import { PECAS_REP, classeResultado, pecasComSerial } from '@/modules/shopfloor/domain/repinmetro'

type Por = 'rep' | 'peca'

const TODOS = '__todos__' // sentinela do Select (value vazio não é permitido)

const CLASSE_COR: Record<string, string> = {
  aprovado: 'text-green-700',
  reprovado: 'text-red-600 font-medium',
  na: 'text-muted-foreground',
}

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR')
}

/** Um teste de produção: o REP e as peças montadas. Na busca por peça, a peça encontrada fica destacada. */
function IntegracaoCard({ integracao, destaque }: { integracao: IntegracaoRep; destaque: string[] }) {
  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-muted/40 px-3 py-2 text-sm">
        <span className="font-medium">{fmtData(integracao.dataInicio)}</span>
        <span className="text-muted-foreground">
          {integracao.modelo ? `Modelo ${integracao.modelo} · ` : ''}REP {integracao.numeroSerie}
        </span>
        {integracao.status && (
          <span className={cn('font-medium', CLASSE_COR[classeResultado(integracao.status)])}>{integracao.status}</span>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 px-3 py-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {PECAS_REP.map((peca) => {
          const serial = integracao.seriais[peca.chave]
          const achada = destaque.includes(peca.chave)
          return (
            <div
              key={peca.chave}
              className={cn('flex items-center justify-between gap-2 rounded px-1', achada && 'bg-enterplak/10 dark:bg-enterplak/25')}
            >
              <dt className={achada ? 'font-medium text-foreground' : 'text-muted-foreground'}>{peca.rotulo}</dt>
              <dd className={cn('font-mono text-xs', serial ? 'text-foreground' : 'text-muted-foreground', achada && 'font-semibold')}>
                {serial || '—'}
              </dd>
            </div>
          )
        })}
      </dl>
      {(integracao.observacao || integracao.dataFim) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {integracao.dataFim && <span>Concluído: {fmtData(integracao.dataFim)}</span>}
          {integracao.observacao && <span>Obs.: {integracao.observacao}</span>}
        </div>
      )}
    </div>
  )
}

export function IntegracaoRepForm({ modelos }: { modelos: string[] }) {
  const [por, setPor] = useState<Por>('rep')
  const [modelo, setModelo] = useState('') // '' = todos os modelos (só na busca pelo REP)
  const [termo, setTermo] = useState('')
  const [resultado, setResultado] = useState<{ por: Por; termo: string; integracoes: IntegracaoRep[] } | null>(null)
  const [buscando, startBusca] = useTransition()

  function onBuscar() {
    if (buscando) return
    if (termo.trim() === '') {
      toast.error('Bipe ou digite o número de série.')
      return
    }
    startBusca(async () => {
      const r = await buscarIntegracaoRepinmetro(por, termo, por === 'rep' ? modelo : '')
      if (r.ok) setResultado({ por, termo: termo.trim(), integracoes: r.integracoes })
      else toast.error(r.erro)
    })
  }

  function trocarPor(novo: Por) {
    setPor(novo)
    setResultado(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integração do REP</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Buscar por</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Buscar por">
            {([['rep', 'Produto final (REP)'], ['peca', 'Produto integrado (peça)']] as const).map(([valor, rotulo]) => (
              <Button
                key={valor}
                type="button"
                role="radio"
                aria-checked={por === valor}
                variant={por === valor ? 'default' : 'outline'}
                size="sm"
                onClick={() => trocarPor(valor)}
              >
                {rotulo}
              </Button>
            ))}
          </div>
        </div>

        <div className={cn('grid grid-cols-1 items-end gap-4', por === 'rep' ? 'sm:grid-cols-[14rem_1fr_auto]' : 'sm:grid-cols-[1fr_auto]')}>
          {por === 'rep' && (
            <div className="flex flex-col gap-1.5">
              <Label>Modelo</Label>
              <Select value={modelo === '' ? TODOS : modelo} onValueChange={(v) => setModelo(v === TODOS ? '' : (v ?? ''))}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos os modelos">
                    {(v) => (v && v !== TODOS ? String(v) : 'Todos os modelos')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os modelos</SelectItem>
                  {modelos.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="termoIntegracaoRep">
              {por === 'rep' ? 'Nº de Série do produto final' : 'Nº de Série da peça (impressora, MRP, módulo biométrico, RFID, fonte ou leitor de barras)'}
            </Label>
            <Input
              id="termoIntegracaoRep"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onBuscar()
                }
              }}
              autoComplete="off"
              placeholder="Bipe ou digite o número de série"
            />
          </div>
          <Button variant="outline" onClick={onBuscar} disabled={buscando}>
            <Search className="mr-1 size-4" /> {buscando ? 'Buscando…' : 'Buscar'}
          </Button>
        </div>

        {resultado !== null && resultado.integracoes.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {resultado.por === 'rep'
              ? 'Nenhum teste de produção para esse Nº de Série.'
              : 'Nenhum REP com uma peça desse Nº de Série.'}
          </p>
        )}
        {resultado !== null && resultado.integracoes.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              {resultado.integracoes.length} teste(s) de produção ·{' '}
              {resultado.por === 'rep' ? `REP ${resultado.termo}` : `peça ${resultado.termo}`}
            </p>
            {resultado.integracoes.map((integracao) => (
              <IntegracaoCard
                key={integracao.origemId}
                integracao={integracao}
                destaque={resultado.por === 'peca' ? pecasComSerial(integracao.seriais, resultado.termo) : []}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
