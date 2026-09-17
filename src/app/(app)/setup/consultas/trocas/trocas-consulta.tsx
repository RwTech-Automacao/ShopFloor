'use client'

import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { consultarTrocas } from '@/modules/setup/application/setup-actions'
import { trocasParaCsv } from '@/modules/setup/domain/csv-trocas'
import type { Equipamento, FiltroTrocas, Troca } from '@/modules/setup/infra/setup-repository'
import { rotuloEquipamento } from '../../selecao-setup'

// Sentinela: o Select não aceita item com value="" (usado internamente para "nenhuma seleção").
const TODOS = '__todos__'
const TAMANHO = 100
const LOTE_EXPORTACAO = 1000
const LIMITE_EXPORTACAO = 20000

/** YYYY-MM-DD de hoje no fuso local (o navegador do chão de fábrica é America/Sao_Paulo). */
function hojeISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function fmtData(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function BadgeResultado({ resultado }: { resultado: Troca['resultado'] }) {
  return resultado === 'APROVADO' ? (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-medium text-green-800">Aprovado</span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-medium text-red-800">Reprovado</span>
  )
}

export function TrocasConsulta({ equipamentos }: { equipamentos: Equipamento[] }) {
  const [de, setDe] = useState(hojeISO())
  const [ate, setAte] = useState(hojeISO())
  const [pmo, setPmo] = useState('')
  const [op, setOp] = useState('')
  const [linha, setLinha] = useState('')
  const [equipamento, setEquipamento] = useState('')
  const [resultado, setResultado] = useState('')
  const [posicao, setPosicao] = useState('')
  const [rolo, setRolo] = useState('')
  const [sn, setSn] = useState('')

  const [linhasTab, setLinhasTab] = useState<Troca[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [carregando, setCarregando] = useState(false)
  const [buscou, setBuscou] = useState(false)
  const [exportando, setExportando] = useState(false)
  // Descarta a resposta de uma consulta antiga se o usuário já disparou outra (novo filtro ou página).
  const seqRef = useRef(0)

  const linhas = useMemo(
    () => [...new Set(equipamentos.map((e) => e.linha))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
    [equipamentos],
  )
  // Um equipamento por valor (o mesmo nome não deveria repetir entre processos, mas se repetir,
  // fica só o 1º pro rótulo — é só um filtro, não a fonte de verdade do processo da troca).
  const maquinas = useMemo(() => {
    const fonte = linha ? equipamentos.filter((e) => e.linha === linha) : equipamentos
    const vistos = new Map<string, Equipamento>()
    for (const e of fonte) if (!vistos.has(e.equipamento)) vistos.set(e.equipamento, e)
    return [...vistos.values()]
  }, [equipamentos, linha])

  /**
   * `Troca` não guarda o processo (só o setup guarda) — então pra decidir se mostra "Bloco X" (PTH)
   * ou o nome cru (SMD) na grade, procuramos o equipamento no catálogo por linha+nome. Sem achar
   * (ex.: equipamento renomeado depois), cai no nome cru.
   */
  function rotuloMaquinaDaTroca(t: Troca): string {
    const e = equipamentos.find((eq) => eq.linha === t.linha && eq.equipamento === t.equipamento)
    return e ? rotuloEquipamento(e.processo, e.equipamento) : t.equipamento
  }

  function montarFiltro(): FiltroTrocas {
    return {
      de: de || undefined,
      ate: ate || undefined,
      pmo: pmo.trim() || undefined,
      op: op.trim() || undefined,
      linha: linha || undefined,
      equipamento: equipamento || undefined,
      resultado: resultado || undefined,
      posicao: posicao.trim() || undefined,
      rolo: rolo.trim() || undefined,
      sn: sn.trim() || undefined,
    }
  }

  function buscar(pag: number) {
    const seq = ++seqRef.current
    setCarregando(true)
    void (async () => {
      try {
        const r = await consultarTrocas(montarFiltro(), pag, TAMANHO)
        if (seq !== seqRef.current) return
        if (!r.ok) { toast.error(r.erro); setLinhasTab([]); setTotal(0) }
        else { setLinhasTab(r.linhas); setTotal(r.total); setPagina(pag) }
      } catch {
        if (seq === seqRef.current) { toast.error('Não foi possível consultar. Verifique a conexão.'); setLinhasTab([]); setTotal(0) }
      } finally {
        if (seq === seqRef.current) { setCarregando(false); setBuscou(true) }
      }
    })()
  }

  function consultar(e?: FormEvent) {
    e?.preventDefault()
    buscar(0)
  }

  function limpar() {
    seqRef.current++ // qualquer resposta que ainda volte é descartada
    setDe(hojeISO()); setAte(hojeISO())
    setPmo(''); setOp(''); setLinha(''); setEquipamento(''); setResultado(''); setPosicao(''); setRolo(''); setSn('')
    setLinhasTab([]); setTotal(0); setPagina(0)
    setCarregando(false)
    setBuscou(false)
  }

  async function exportarCsv() {
    const filtro = montarFiltro()
    setExportando(true)
    try {
      const primeira = await consultarTrocas(filtro, 0, LOTE_EXPORTACAO)
      if (!primeira.ok) { toast.error(primeira.erro); return }
      if (primeira.total === 0) { toast.error('Nenhuma troca para exportar com esses filtros.'); return }
      if (primeira.total > LIMITE_EXPORTACAO) {
        toast.error(`Mais de ${LIMITE_EXPORTACAO.toLocaleString('pt-BR')} trocas no período — reduza o filtro (datas, OP…) antes de exportar.`)
        return
      }
      const todas = [...primeira.linhas]
      const totalLotes = Math.ceil(primeira.total / LOTE_EXPORTACAO)
      for (let p = 1; p < totalLotes; p++) {
        const r = await consultarTrocas(filtro, p, LOTE_EXPORTACAO)
        if (!r.ok) { toast.error(r.erro); return }
        todas.push(...r.linhas)
      }
      const blob = new Blob([trocasParaCsv(todas)], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'trocas-de-rolo.csv'
      a.click()
      // Sem o revoke o blob fica na memória da aba até ela fechar.
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Não foi possível exportar. Verifique a conexão.')
    } finally {
      setExportando(false)
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO))
  const naPrimeira = pagina === 0
  const naUltima = pagina + 1 >= totalPaginas

  return (
    <div className="flex flex-col gap-4 pt-4">
      <form onSubmit={consultar} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="t-de">De</Label>
          <Input id="t-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="t-ate">Até</Label>
          <Input id="t-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="t-pmo">PMO</Label>
          <Input id="t-pmo" value={pmo} onChange={(e) => setPmo(e.target.value)} className="w-32" placeholder="PMO" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="t-op">OP</Label>
          <Input id="t-op" value={op} onChange={(e) => setOp(e.target.value)} className="w-28" placeholder="OP" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="t-linha">Linha</Label>
          <Select value={linha || TODOS} onValueChange={(v) => { setLinha(v === TODOS ? '' : String(v)); setEquipamento('') }}>
            <SelectTrigger id="t-linha" className="w-32">
              <SelectValue placeholder="Todas">{(v: string | null) => (!v || v === TODOS ? 'Todas' : `Linha ${v}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas</SelectItem>
              {linhas.map((l) => <SelectItem key={l} value={l}>Linha {l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="t-equipamento">Máquina/Bloco</Label>
          <Select value={equipamento || TODOS} onValueChange={(v) => setEquipamento(v === TODOS ? '' : String(v))}>
            <SelectTrigger id="t-equipamento" className="w-40">
              <SelectValue placeholder="Todos">
                {(v: string | null) => {
                  if (!v || v === TODOS) return 'Todos'
                  const e = maquinas.find((m) => m.equipamento === v)
                  return e ? rotuloEquipamento(e.processo, e.equipamento) : v
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              {maquinas.map((m) => <SelectItem key={m.id} value={m.equipamento}>{rotuloEquipamento(m.processo, m.equipamento)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="t-resultado">Resultado</Label>
          <Select value={resultado || TODOS} onValueChange={(v) => setResultado(v === TODOS ? '' : String(v))}>
            <SelectTrigger id="t-resultado" className="w-36">
              <SelectValue placeholder="Todos">
                {(v: string | null) => (!v || v === TODOS ? 'Todos' : v === 'APROVADO' ? 'Aprovado' : 'Reprovado')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              <SelectItem value="APROVADO">Aprovado</SelectItem>
              <SelectItem value="REPROVADO">Reprovado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="t-posicao">Posição</Label>
          <Input id="t-posicao" value={posicao} onChange={(e) => setPosicao(e.target.value)} className="w-28" placeholder="Posição/Posto" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="t-rolo">Rolo</Label>
          <Input id="t-rolo" value={rolo} onChange={(e) => setRolo(e.target.value)} className="w-36" placeholder="Código do rolo" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="t-sn">SN Inicial</Label>
          <Input id="t-sn" value={sn} onChange={(e) => setSn(e.target.value)} className="w-36" placeholder="Número de série" />
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="bg-enterplak hover:bg-enterplak-700" disabled={carregando}>Consultar</Button>
          <Button type="button" variant="outline" onClick={limpar} disabled={carregando}>Limpar filtros</Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {buscou && (
            <>{total} {total === 1 ? 'troca' : 'trocas'} · página {pagina + 1} de {totalPaginas}</>
          )}
        </span>
        <Button variant="outline" size="sm" onClick={exportarCsv} disabled={exportando}>
          <Download className="mr-1 size-4" /> {exportando ? 'Exportando…' : 'Exportar CSV'}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data/hora</TableHead>
              <TableHead>OP</TableHead>
              <TableHead>Linha · Máquina · Face</TableHead>
              <TableHead>Posição/Feeder</TableHead>
              <TableHead>Saiu → Entrou</TableHead>
              <TableHead>SN</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Operador</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {carregando && (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Consultando…</TableCell></TableRow>
            )}
            {!carregando && buscou && linhasTab.length === 0 && (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Nenhuma troca encontrada com esses filtros.</TableCell></TableRow>
            )}
            {!carregando && !buscou && (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Use os filtros e clique em Consultar.</TableCell></TableRow>
            )}
            {!carregando && linhasTab.map((t) => (
              <TableRow key={t.id} className="align-top">
                <TableCell>{fmtData(t.dataHora)}</TableCell>
                <TableCell className="font-medium">{t.op}</TableCell>
                <TableCell>{t.linha} · {rotuloMaquinaDaTroca(t)} · {t.face}</TableCell>
                <TableCell className="font-mono">{t.posicao}/{t.feeder}</TableCell>
                <TableCell className="font-mono">{t.roloSaida} → {t.roloEntrada}</TableCell>
                <TableCell className="font-mono">{t.snInicial}</TableCell>
                <TableCell>
                  <BadgeResultado resultado={t.resultado} />
                  {t.resultado === 'REPROVADO' && t.motivos.length > 0 && (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {t.motivos.map((m, i) => <p key={i} className="text-xs text-red-600">{m}</p>)}
                    </div>
                  )}
                </TableCell>
                <TableCell>{t.operadorNome}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {buscou && total > 0 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={carregando || naPrimeira} onClick={() => buscar(pagina - 1)}>Anterior</Button>
          <Button variant="outline" size="sm" disabled={carregando || naUltima} onClick={() => buscar(pagina + 1)}>Próxima</Button>
        </div>
      )}
    </div>
  )
}
