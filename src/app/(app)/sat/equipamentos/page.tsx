import Link from 'next/link'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { listarEntradas, type FiltroEntradas } from '@/modules/sat/infra/repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { StatusNf } from '../situacao-nf'
import { dia } from '../formato'

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '').slice(0, 200)

/** SAT → Equipamentos recebidos (um por relógio, com a nota dele), com filtros (status da NF, empresa, número de série, período). sat.visualizar. */
export default async function EquipamentosSatPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'sat', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver os equipamentos do SAT." />
  }
  const sp = await searchParams
  const situacao = um(sp.situacao)
  const filtro: FiltroEntradas = {
    situacao: situacao === 'aprovada' || situacao === 'reprovada' ? situacao : '',
    cliente: um(sp.cliente), ns: um(sp.ns), de: um(sp.de), ate: um(sp.ate),
  }
  const entradas = await listarEntradas(filtro)

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-tinta">Equipamentos recebidos</h2>
      <form className="grid grid-cols-1 gap-2 rounded-lg border bg-white p-3 sm:grid-cols-2 lg:grid-cols-6">
        <select name="situacao" defaultValue={filtro.situacao} aria-label="Status da NF" className="h-9 rounded-md border bg-transparent px-2 text-sm">
          <option value="">Todos os status</option>
          <option value="aprovada">NF aprovada</option>
          <option value="reprovada">NF reprovada</option>
        </select>
        <Input name="cliente" placeholder="Empresa" aria-label="Empresa" defaultValue={filtro.cliente} />
        <Input name="ns" placeholder="Número de série" aria-label="Número de série" defaultValue={filtro.ns} />
        <Input name="de" type="date" aria-label="Recebido de" defaultValue={filtro.de} />
        <Input name="ate" type="date" aria-label="Recebido até" defaultValue={filtro.ate} />
        <Button type="submit">Filtrar</Button>
      </form>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2 font-medium">Número de série</th>
              <th className="p-2 font-medium">Produto</th>
              <th className="p-2 font-medium">Empresa</th>
              <th className="p-2 font-medium">NF</th>
              <th className="p-2 font-medium">Situação</th>
              <th className="p-2 font-medium">OS</th>
              <th className="p-2 font-medium">Locação</th>
              <th className="p-2 font-medium">Data</th>
            </tr>
          </thead>
          <tbody>
            {entradas.map((e) => (
              <tr key={e.id} className="border-t hover:bg-muted/40">
                <td className="p-2 font-mono"><Link className="underline" href={`/sat/equipamentos/${e.id}`}>{e.nsEscrito}</Link></td>
                <td className="p-2">{e.produto || '—'}</td>
                <td className="p-2">{e.empresa || '—'}</td>
                <td className="p-2">{e.nf}</td>
                <td className="p-2"><StatusNf situacao={e.situacao} /></td>
                <td className="p-2">{e.osNumero || '—'}</td>
                <td className="p-2">{e.locacao || '—'}</td>
                <td className="p-2">{dia(e.data)}</td>
              </tr>
            ))}
            {entradas.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Nenhum equipamento encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
