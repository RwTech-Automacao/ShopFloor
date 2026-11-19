'use client'

import { Fragment, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { rotuloTrecho, type SnModo, type TrechoCadastro } from '@/modules/shopfloor/domain/cadastro-op'
import { moverPostoNaRota } from '@/modules/shopfloor/domain/rota-op-nova'
import type { FaixaSN } from '@/modules/shopfloor/domain/faixas-sn'
import { placasDosPaineis, paineisDasPlacas } from '@/modules/shopfloor/domain/placas-por-painel'
import { FaixasSn } from './ordem-form'

/**
 * A corrente de trechos da OP (PRTs → PMO), dividida entre a Nova OP e a edição de OP com trechos: uma coluna por
 * trecho, a numeração dos postos seguindo de um trecho para o outro, o Almoxarifado fixo no fim da PMO, a série de
 * cada PRT e as faixas de SN por trecho. O que cada tela deixa mudar vem por props.
 */

export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

const ICONE = 'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40'

/** Faixas só para ler (as próprias das PRTs na edição: o banco não as regrava). */
function FaixasLeitura({ faixas }: { faixas: FaixaSN[] }) {
  if (faixas.length === 0) return <p className="text-xs text-muted-foreground">Sem faixa gravada.</p>
  return (
    <ul className="flex flex-col gap-0.5 text-sm tabular-nums">
      {faixas.map((f, i) => <li key={i}>{`${f.sn_ini} – ${f.sn_fim}`}</li>)}
    </ul>
  )
}

export function CorrenteTrechos({
  trechos,
  almox,
  idBase,
  qtd,
  nPainel,
  mudarTrecho,
  moverEntreTrechos,
  opcoesAdicionar,
  snModoEditavel = true,
  faixasEditaveis = () => true,
  subtitulo,
  situacao,
  avisoVazio = 'Nenhum posto neste trecho. Traga postos com ← → ou adicione um.',
}: {
  trechos: TrechoCadastro[]
  /** Posto Almoxarifado: fica fixo no fim do trecho da PMO. */
  almox: string | null
  idBase: string
  /** Quantidade da OP (faixas da PMO) e placas por painel. */
  qtd: string
  nPainel: number
  mudarTrecho: (seq: number, f: (t: TrechoCadastro) => TrechoCadastro) => void
  /** Setas ← → na ponta de cada trecho; ausente = o posto não troca de trecho. */
  moverEntreTrechos?: (seq: number, posto: string, delta: -1 | 1) => void
  /** Postos que o "Adicionar posto" do trecho oferece. */
  opcoesAdicionar: (t: TrechoCadastro) => string[]
  /** Série da PRT (mesma da PMO × própria) editável; senão, só o texto. */
  snModoEditavel?: boolean
  /** As faixas do trecho são editáveis? (PMO sempre; PRT conforme a tela.) */
  faixasEditaveis?: (t: TrechoCadastro) => boolean
  /** Linha abaixo do título do trecho; padrão: quantidade · situação no Compels · postos. */
  subtitulo?: (t: TrechoCadastro) => string
  /** Bloco extra no cabeçalho do trecho (ex.: o que já foi apontado no Compels). */
  situacao?: (t: TrechoCadastro) => ReactNode
  avisoVazio?: string
}) {
  // Número de cada posto na rota inteira: a contagem continua de um trecho para o outro.
  const inicioDoTrecho = trechos.map((_, i) => trechos.slice(0, i).reduce((a, t) => a + t.postos.length, 0))
  const linha = subtitulo ?? ((t: TrechoCadastro) =>
    [t.compelsOp && `${t.quantidade ?? '—'} un · ${t.situacao || '—'}`, plural(t.postos.length, 'posto', 'postos')].filter(Boolean).join(' · '))

  return (
    <div className="flex flex-col gap-1 lg:flex-row lg:items-stretch lg:gap-0 lg:overflow-x-auto lg:pb-1">
      {trechos.map((t, ti) => {
        const fixo = t.tipo === 'pmo' ? almox : null
        const inicio = inicioDoTrecho[ti]!
        const disponiveis = opcoesAdicionar(t)
        const editaFaixas = t.tipo === 'pmo' || faixasEditaveis(t)
        return (
          <Fragment key={t.seq}>
            {ti > 0 && (
              <div aria-hidden className="flex shrink-0 items-center justify-center text-muted-foreground lg:w-6">
                <ChevronDown className="size-5 lg:hidden" />
                <ChevronRight className="hidden size-5 lg:block" />
              </div>
            )}
            <section aria-labelledby={`${idBase}-t${t.seq}`}
              className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-3 lg:flex-[1_0_14rem]">
              <header className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h4 id={`${idBase}-t${t.seq}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{rotuloTrecho(t)}</h4>
                  <Badge variant={t.tipo === 'pmo' ? 'default' : 'secondary'}>{t.tipo === 'pmo' ? 'PMO' : 'PRT'}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{linha(t)}</p>
                {situacao?.(t)}
              </header>
              {t.postos.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">{avisoVazio}</p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {t.postos.map((p, i) => (
                    <li key={p} className="flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md border border-border bg-background py-1 pr-1 pl-2 text-sm">
                      <span className="w-6 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{inicio + i + 1}</span>
                      <span className="min-w-0 flex-1 basis-20 break-words">{p}</span>
                      {p !== fixo && (
                        <span className="ml-auto flex items-center">
                          {moverEntreTrechos && ti > 0 && i === 0 && (
                            <button type="button" aria-label={`Mover ${p} para o trecho anterior`} className={ICONE}
                              onClick={() => moverEntreTrechos(t.seq, p, -1)}><ArrowLeft className="size-4" /></button>
                          )}
                          {moverEntreTrechos && ti < trechos.length - 1 && i === t.postos.length - 1 && (
                            <button type="button" aria-label={`Mover ${p} para o trecho seguinte`} className={ICONE}
                              onClick={() => moverEntreTrechos(t.seq, p, 1)}><ArrowRight className="size-4" /></button>
                          )}
                          <button type="button" aria-label={`Subir ${p}`} className={ICONE} disabled={i === 0}
                            onClick={() => mudarTrecho(t.seq, (x) => ({ ...x, postos: moverPostoNaRota(x.postos, i, -1, fixo) }))}><ArrowUp className="size-4" /></button>
                          <button type="button" aria-label={`Descer ${p}`} className={ICONE}
                            disabled={i === t.postos.length - 1 || t.postos[i + 1] === fixo}
                            onClick={() => mudarTrecho(t.seq, (x) => ({ ...x, postos: moverPostoNaRota(x.postos, i, 1, fixo) }))}><ArrowDown className="size-4" /></button>
                          <button type="button" aria-label={`Remover ${p}`} className={cn(ICONE, 'hover:text-red-600')}
                            onClick={() => mudarTrecho(t.seq, (x) => ({ ...x, postos: x.postos.filter((y) => y !== p) }))}><X className="size-4" /></button>
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {disponiveis.length > 0 && (
                <Select value="" onValueChange={(p) => p && mudarTrecho(t.seq, (x) => ({ ...x, postos: [...x.postos, p] }))}>
                  <SelectTrigger className="h-8 text-xs" aria-label={`Adicionar posto em ${rotuloTrecho(t)}`}><SelectValue placeholder="Adicionar posto" /></SelectTrigger>
                  <SelectContent>{disponiveis.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {t.tipo === 'prt' && (snModoEditavel ? (
                <fieldset className="mt-auto flex flex-col gap-1 border-t border-border pt-3 text-sm">
                  <legend className="sr-only">{`Série de ${rotuloTrecho(t)}`}</legend>
                  {(['mesmo', 'proprio'] as SnModo[]).map((modoSn) => (
                    <label key={modoSn} className="flex items-center gap-2">
                      <input type="radio" name={`sn_modo_${t.seq}`} checked={t.snModo === modoSn} className="size-4 accent-enterplak"
                        onChange={() => mudarTrecho(t.seq, (x) => ({ ...x, snModo: modoSn, faixas: modoSn === 'proprio' ? [{ sn_ini: '', sn_fim: '' }] : [] }))} />
                      {modoSn === 'mesmo' ? 'Mesma série da PMO' : 'Série própria'}
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p className="mt-auto border-t border-border pt-3 text-sm" data-testid={`sn-modo-${t.seq}`}>
                  {t.snModo === 'proprio' ? 'Série própria' : 'Mesma série da PMO'}
                </p>
              ))}
              {(t.tipo === 'pmo' || t.snModo === 'proprio') && (
                <div className={cn('flex flex-col gap-2', t.tipo === 'pmo' && 'mt-auto border-t border-border pt-3')}>
                  <p className="text-xs font-medium text-muted-foreground">Faixas de série</p>
                  {editaFaixas ? (
                    <FaixasSn faixas={t.faixas} idBase={t.tipo === 'pmo' ? '' : `t${t.seq}_`}
                      setFaixas={(f: FaixaSN[]) => mudarTrecho(t.seq, (x) => ({ ...x, faixas: f }))}
                      qtd={t.tipo === 'pmo' ? qtd : String(t.quantidade ?? '')} nPainel={t.tipo === 'pmo' ? nPainel : 1} />
                  ) : (
                    <FaixasLeitura faixas={t.faixas} />
                  )}
                </div>
              )}
            </section>
          </Fragment>
        )
      })}
    </div>
  )
}

/** Barra fixa no pé da tela: o resumo da rota à esquerda e as ações (Cancelar/Salvar) à direita. */
export function BarraFixa({ resumo, children }: { resumo: ReactNode; children: ReactNode }) {
  return (
    <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-card px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6 lg:-bottom-8 lg:-mx-8 lg:-mb-8 lg:px-8">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground" data-testid="resumo-rota">{resumo}</p>
      {children}
    </div>
  )
}

/** "3 trechos · 4 postos", com o número de trechos em destaque. */
export function ResumoRota({ trechos }: { trechos: TrechoCadastro[] }) {
  const total = trechos.reduce((a, t) => a + t.postos.length, 0)
  return <><span className="font-medium text-foreground">{plural(trechos.length, 'trecho', 'trechos')}</span>{` · ${plural(total, 'posto', 'postos')}`}</>
}

/**
 * Quantidade, placas por painel e o auxiliar Painéis (com N > 1): três células da grade de dados da OP. A
 * quantidade é sempre em placas; Painéis só calcula. `bloqueiaPlacas`: a OP já tem registros, o N não muda.
 */
export function CamposQuantidade({ qtd, setQtd, placasPorPainel, setPlacasPorPainel, bloqueiaPlacas = false }: {
  qtd: string
  setQtd: (v: string) => void
  placasPorPainel: string
  setPlacasPorPainel: (v: string) => void
  bloqueiaPlacas?: boolean
}) {
  const nPainel = nPainelDe(placasPorPainel)
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="qtd">Quantidade</Label>
        <Input id="qtd" inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="placas_por_painel">Placas por painel</Label>
        <Input id="placas_por_painel" inputMode="numeric" value={placasPorPainel} disabled={bloqueiaPlacas}
          onChange={(e) => setPlacasPorPainel(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          {bloqueiaPlacas ? 'Bloqueado: esta OP já tem registros.' : 'Use quando a etiqueta é por painel: cada bipe conta como N placas.'}
        </p>
      </div>
      {nPainel > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paineis">Painéis</Label>
          <Input
            id="paineis" inputMode="numeric"
            value={qtd.trim() === '' ? '' : String(paineisDasPlacas(Number(qtd), nPainel) ?? '')}
            onChange={(e) => setQtd(e.target.value.trim() === '' || Number.isNaN(Number(e.target.value)) ? '' : String(placasDosPaineis(Number(e.target.value), nPainel)))}
          />
          {!paineisFecham(qtd, nPainel) && (
            <p className="text-xs text-destructive">{qtd} placas não fecham em painéis de {nPainel}. Ajuste a quantidade ou os painéis.</p>
          )}
          <p className="text-xs text-muted-foreground">A faixa de SN conta painéis (um SN por painel).</p>
        </div>
      )}
    </>
  )
}

/** O N de placas por painel digitado; inválido ou vazio conta como 1. */
export function nPainelDe(placasPorPainel: string): number {
  const n = Number(placasPorPainel)
  return Number.isInteger(n) && n >= 1 ? n : 1
}

/** A quantidade fecha em painéis inteiros (ou não há painel/quantidade)? */
export function paineisFecham(qtd: string, nPainel: number): boolean {
  return nPainel <= 1 || qtd.trim() === '' || paineisDasPlacas(Number(qtd), nPainel) !== null
}
