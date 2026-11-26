import Link from 'next/link'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { agruparPorEtapa, ehTipo, ROTULO_TIPO, TIPOS } from '@/modules/sat/domain/ordem'
import { listarOrdens, type FiltroOrdens } from '@/modules/sat/infra/ordens-repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { TipoOrdemSelo } from '../etapa-ordem'

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '').slice(0, 200)

/**
 * SAT → Ordens de serviço: o quadro por etapa (contagem + cartões), com filtros por tipo, cliente, NS (antigo ou
 * novo) e período em que a OS nasceu. sat.visualizar.
 */
export default async function FilaSatPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'sat', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver as ordens de serviço do SAT." />
  }
  const sp = await searchParams
  const tipo = um(sp.tipo)
  const filtro: FiltroOrdens = {
    tipo: tipo === 'a_definir' || ehTipo(tipo) ? tipo : '',
    cliente: um(sp.cliente), ns: um(sp.ns), de: um(sp.de), ate: um(sp.ate),
  }
  const ordens = await listarOrdens(filtro)
  const colunas = agruparPorEtapa(ordens)
  const buscouNs = filtro.ns.trim() !== ''

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-tinta">Ordens de serviço</h2>
      <form className="grid grid-cols-1 gap-2 rounded-lg border bg-white p-3 sm:grid-cols-2 lg:grid-cols-6">
        <select name="tipo" defaultValue={filtro.tipo} aria-label="Tipo" className="h-9 rounded-md border bg-transparent px-2 text-sm">
          <option value="">Todos os tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
          <option value="a_definir">Garantia a definir</option>
        </select>
        <Input name="cliente" placeholder="Cliente" aria-label="Cliente" defaultValue={filtro.cliente} />
        <Input name="ns" placeholder="Número de série (antigo ou novo)" aria-label="Número de série" defaultValue={filtro.ns} />
        <Input name="de" type="date" aria-label="Aberta de" defaultValue={filtro.de} />
        <Input name="ate" type="date" aria-label="Aberta até" defaultValue={filtro.ate} />
        <Button type="submit">Filtrar</Button>
      </form>

      {buscouNs && (
        <p className="text-sm">
          {ordens.length === 0
            ? 'Nenhuma OS com esse número de série.'
            : `Número de série encontrado em: ${colunas.filter((c) => c.ordens.length > 0).map((c) => `${c.rotulo} (${c.ordens.length})`).join(', ')}`}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {colunas.map((c) => (
          <section key={c.etapa} aria-label={c.rotulo} className="flex flex-col gap-2 rounded-lg border bg-white p-3">
            <h3 className="flex items-center justify-between gap-2 text-sm font-semibold text-tinta">
              {c.rotulo}
              <span className="rounded-full bg-muted px-2 text-xs">{c.ordens.length}</span>
            </h3>
            <ul className="flex flex-col gap-1">
              {c.ordens.map((o) => (
                <li key={o.id}>
                  <Link href={`/sat/ordens/${o.id}`} className="flex flex-col gap-0.5 rounded-md border px-2 py-1 text-sm hover:bg-muted/40">
                    <span className="flex justify-between gap-2">
                      <span className="font-mono font-semibold">{o.numero}</span>
                      <span className="text-xs text-muted-foreground">há {o.tempoNaEtapa}</span>
                    </span>
                    <span className="font-mono text-xs">{o.nsAtual}</span>
                    <span className="truncate text-xs text-muted-foreground">{o.cliente || '—'}</span>
                    <TipoOrdemSelo tipo={o.tipo} />
                  </Link>
                </li>
              ))}
              {c.ordens.length === 0 && <li className="text-xs text-muted-foreground">Nenhuma OS.</li>}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
