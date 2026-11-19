'use client'

import { useId, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { editarOrdemAction, type ResultadoOrdem } from '@/modules/shopfloor/application/ordens-actions'
import { fixarAlmoxarifado, moverPostoEntreTrechos, validarCadastro, type TrechoCadastro } from '@/modules/shopfloor/domain/cadastro-op'
import {
  erroTempoBurnin, faixasDaPmo, postosParaAdicionar, receitaDaRota, rotaDosTrechos, temposDaRota, trechosParaGravar,
} from '@/modules/shopfloor/domain/edicao-op-trechos'
import { parseTempoBurninPorPosto } from '@/modules/shopfloor/domain/burnin-posto'
import { postoAlmoxarifadoPadrao } from '@/modules/shopfloor/domain/rota-op-nova'
import { PERFIL_PADRAO, type PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import { ehReativacaoManual } from '@/modules/shopfloor/domain/finalizacao'
import { minutosParaTempo } from '@/modules/shopfloor/domain/tempo-burnin'
import type { ReceitaPorPosto } from '@/modules/shopfloor/domain/receita-posto'
import type { TempoBurninPorPosto } from '@/modules/shopfloor/domain/burnin-posto'
import type { ResumoTrecho } from '@/modules/shopfloor/infra/estrutura-repository'
import { BarraFixa, CamposQuantidade, CorrenteTrechos, ResumoRota, nPainelDe, paineisFecham, plural } from '../../ordens/corrente-trechos'
import { ReceitasDosPostos, TempoBurninCampo } from '../../ordens/editores-posto'

const TOAST = { position: 'bottom-center' as const }
/** Tempo mínimo de Burn-in de um posto de Burn-in que entra na rota pela edição (o mesmo padrão do cadastro antigo). */
const BURNIN_PADRAO = '6:00'

export interface OrdemEdicao {
  id: string
  pmo: string
  op: string
  cliente: string
  qtd: number | null
  descricao: string
  acp: string
  status: string
  embalagemIndividual: boolean
  placasPorPainel: number
}

/** O que já andou no Compels por PRT: apontadas, na fila e a pendência mais antiga. */
function SituacaoPrt({ t, resumo }: { t: TrechoCadastro; resumo: ResumoTrecho[] | null }) {
  if (t.tipo !== 'prt') return null
  if (resumo === null) return <p className="text-xs text-amber-700 dark:text-amber-500">Não foi possível ler a situação no Compels.</p>
  const r = resumo.find((x) => x.codigo === t.codigo && (x.compelsOp ?? null) === (t.compelsOp ?? null))
    ?? resumo.find((x) => x.codigo === t.codigo)
  const apontadas = r?.apontadas ?? 0
  const naFila = r?.naFila ?? 0
  return (
    <div className="flex flex-col gap-0.5 text-xs" data-testid={`situacao-${t.seq}`}>
      <p className="text-foreground">
        {`No Compels: ${plural(apontadas, 'apontada', 'apontadas')} · ${naFila} na fila`}
      </p>
      {r?.motivo && <p className="text-amber-700 dark:text-amber-500">{`Pendência: ${r.motivo}`}</p>}
    </div>
  )
}

export function EditarOpCliente({
  ordem, trechos: trechosIniciais, resumo, postos, postosPerfil, clientesExistentes, temRegistros, receita: receitaInicial,
  tempoBurnin, pmosExistentes = [],
}: {
  ordem: OrdemEdicao
  trechos: TrechoCadastro[]
  /** Situação das PRTs no Compels (sf_resumo_trechos_op); null = não foi possível ler. */
  resumo: ResumoTrecho[] | null
  postos: string[]
  postosPerfil: Record<string, PerfilPosto>
  clientesExistentes: string[]
  /** A OP já tem lançamentos: as placas por painel ficam travadas (o servidor confere de novo). */
  temRegistros: boolean
  /** Receita da Integração e tempos de Burn-in gravados (editáveis por posto, como no cadastro antigo). */
  receita: ReceitaPorPosto
  tempoBurnin: TempoBurninPorPosto
  /** PMOs que podem entrar na receita de um posto de Integração. */
  pmosExistentes?: string[]
}) {
  const router = useRouter()
  const idBase = useId()
  const [salvando, startSalvar] = useTransition()
  const { confirmar, dialog } = useConfirmacao()
  const perfilDo = (p: string) => postosPerfil[p] ?? PERFIL_PADRAO
  const almox = postoAlmoxarifadoPadrao(postos, perfilDo)
  // Fixo no fim da PMO só quando a rota GRAVADA já o tem (a mesma regra do servidor, rotaDaEdicao).
  const almoxFixo = almox !== null && trechosIniciais.some((t) => t.postos.includes(almox)) ? almox : null
  const ehIntegracao = (p: string) => perfilDo(p).recurso === 'integracao'
  const ehBurnin = (p: string) => perfilDo(p).recurso === 'burnin'
  const [receita, setReceita] = useState<ReceitaPorPosto>(receitaInicial)
  const [tempos, setTempos] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(tempoBurnin).map(([p, min]) => [p, minutosParaTempo(min)])))

  const [trechos, setTrechos] = useState<TrechoCadastro[]>(trechosIniciais)
  const [cliente, setCliente] = useState(ordem.cliente)
  const [descricao, setDescricao] = useState(ordem.descricao)
  const [qtd, setQtd] = useState(ordem.qtd != null ? String(ordem.qtd) : '')
  const [acp, setAcp] = useState(ordem.acp)
  const statusInicial = ordem.status.toUpperCase() === 'FINALIZADA' ? 'FINALIZADA' : 'ATIVA'
  const [status, setStatus] = useState(statusInicial)
  const [placasPorPainel, setPlacasPorPainel] = useState(String(ordem.placasPorPainel))
  const [embalagemIndividual, setEmbalagemIndividual] = useState(ordem.embalagemIndividual)
  const nPainel = nPainelDe(placasPorPainel)
  // Reativar uma finalizada liga reaberta_manual (0148), que é definitivo: o mesmo aviso do cadastro antigo.
  const avisaReativacao = ehReativacaoManual(ordem.status, status)

  const mudarTrecho = (seq: number, f: (t: TrechoCadastro) => TrechoCadastro) =>
    setTrechos((ts) => fixarAlmoxarifado(ts.map((t) => (t.seq === seq ? f(t) : t)), almoxFixo))

  function formulario(confirmarForaDaFaixa: boolean): FormData {
    const rota = rotaDosTrechos(trechos)
    const fd = new FormData()
    fd.set('id', ordem.id)
    // PMO e número: os gravados (a action recusa a troca numa OP com trechos).
    fd.set('pmo', ordem.pmo)
    fd.set('op', ordem.op)
    fd.set('cliente', cliente.trim())
    fd.set('qtd', qtd.trim())
    fd.set('descricao', descricao.trim())
    fd.set('acp', acp.trim())
    fd.set('status', status)
    if (embalagemIndividual) fd.set('embalagem_individual', 'on')
    fd.set('placas_por_painel', temRegistros ? String(ordem.placasPorPainel) : placasPorPainel.trim())
    fd.set('fluxo', JSON.stringify(rota))
    fd.set('componentes', JSON.stringify(receitaDaRota(rota, receita, ehIntegracao)))
    fd.set('tempo_burnin', JSON.stringify(temposDaRota(rota, tempos, ehBurnin)))
    fd.set('faixas', JSON.stringify(faixasDaPmo(trechos)))
    // A edição por trecho (0194): rota, série e faixas de cada trecho, gravadas numa transação só.
    fd.set('trechos', JSON.stringify(trechosParaGravar(trechos)))
    if (confirmarForaDaFaixa) fd.set('confirmar_fora_faixa', '1')
    return fd
  }

  function salvar() {
    const v = validarCadastro({
      modo: 'compels', pmo: ordem.pmo, op: ordem.op, cliente: cliente.trim(), descricao: descricao.trim(),
      qtd: qtd.trim() === '' || Number.isNaN(Number(qtd)) ? null : Number(qtd), acp: acp.trim(),
      embalagemIndividual, placasPorPainel: Number(placasPorPainel), trechos, componentes: [], burnin: [],
    })
    if (!v.ok) { toast.error(v.erro, TOAST); return }
    // a mesma conferência do servidor (lerBurnin): o tempo tem que ser hhh:mm
    const rota = rotaDosTrechos(trechos)
    const t = parseTempoBurninPorPosto(JSON.stringify(temposDaRota(rota, tempos, ehBurnin)), rota.filter(ehBurnin))
    if (!t.ok) { toast.error(erroTempoBurnin(t.posto), TOAST); return }
    startSalvar(async () => {
      let r: ResultadoOrdem = await editarOrdemAction(undefined, formulario(false))
      if (!r.ok && r.confirmarForaDaFaixa) {
        // Aviso, não trava: a OP já tem SNs que ficariam fora das faixas novas. Confirmou → reenvia com a confirmação.
        if (!(await confirmar({ titulo: r.erro, rotuloConfirmar: 'Salvar mesmo assim' }))) return
        r = await editarOrdemAction(undefined, formulario(true))
      }
      if (!r.ok) { toast.error(r.erro, TOAST); return }
      toast.success('OP editada', { ...TOAST, description: `${ordem.pmo}/${ordem.op}` })
      if (r.aviso) toast.warning(r.aviso, TOAST)
      router.push('/shopfloor/ordens-nova')
    })
  }

  const prontoParaSalvar = cliente.trim() !== '' && paineisFecham(qtd, nPainel)

  return (
    <div className="flex flex-1 flex-col gap-3">
      <section aria-labelledby={`${idBase}-dados`} className="rounded-lg border border-border bg-card">
        <h3 id={`${idBase}-dados`} className="px-4 pt-3 text-sm font-semibold">Dados da OP</h3>
        <div className="grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pmo">PMO</Label>
            <Input id="pmo" value={ordem.pmo} readOnly disabled aria-describedby="trava-op" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op">Nº OP</Label>
            <Input id="op" value={ordem.op} readOnly disabled aria-describedby="trava-op" />
          </div>
          <p id="trava-op" className="flex items-start gap-1.5 self-end text-xs text-muted-foreground sm:col-span-2 lg:col-span-1">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            OP com trechos não troca PMO nem número: os trechos apontam para as OPs do Compels desta PMO/OP.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cliente">Cliente *</Label>
            <Input id="cliente" list="clientes-existentes" value={cliente} onChange={(e) => setCliente(e.target.value)} />
            <datalist id="clientes-existentes">{clientesExistentes.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <CamposQuantidade qtd={qtd} setQtd={setQtd} placasPorPainel={placasPorPainel} setPlacasPorPainel={setPlacasPorPainel}
            bloqueiaPlacas={temRegistros} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="descricao">Descrição</Label>
            <Input id="descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="acp">ACP</Label>
            <Input id="acp" value={acp} onChange={(e) => setAcp(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v ?? status)}>
              <SelectTrigger id="status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ATIVA">Ativa</SelectItem>
                <SelectItem value="FINALIZADA">Finalizada</SelectItem>
              </SelectContent>
            </Select>
            {avisaReativacao && (
              <p className="text-xs text-amber-700 dark:text-amber-500">
                Reativar uma OP finalizada tira ela do fechamento automático em definitivo — a partir daí, só fecha quem reabriu.
              </p>
            )}
          </div>
          <label className="flex items-start gap-2 text-sm sm:col-span-2 lg:col-span-3">
            <input type="checkbox" checked={embalagemIndividual} onChange={(e) => setEmbalagemIndividual(e.target.checked)} className="mt-0.5 size-4 accent-enterplak" />
            <span>Embalagem <b>individual</b> — 1 produto por caixa (deixe desmarcado para caixa coletiva).</span>
          </label>
        </div>
      </section>

      <section aria-labelledby={`${idBase}-rota`} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div>
          <h3 id={`${idBase}-rota`} className="text-sm font-semibold">Rota e faixas</h3>
          <p className="text-xs text-muted-foreground">
            Use ← → nas pontas para passar um posto de um trecho para o vizinho. O que já andou não muda de dono: posto com
            registros não troca de trecho, e uma PRT já bipada ou apontada no Compels não troca o posto final nem a série
            (a faixa dela só pode crescer).
          </p>
        </div>
        <CorrenteTrechos trechos={trechos} almox={almoxFixo} idBase={idBase} qtd={qtd} nPainel={nPainel}
          mudarTrecho={mudarTrecho}
          moverEntreTrechos={(seq, p, delta) => setTrechos((ts) => moverPostoEntreTrechos(ts, seq, p, delta, almoxFixo))}
          opcoesAdicionar={(t) => postosParaAdicionar(postos, trechos, t, almox)}
          situacao={(t) => <SituacaoPrt t={t} resumo={resumo} />}
          extraPosto={(p) => ehBurnin(p) && (
            <TempoBurninCampo valor={tempos[p] ?? ''} rotulo={`Tempo mínimo de Burn-in em ${p}`}
              setValor={(v) => setTempos((prev) => ({ ...prev, [p]: v }))} />
          )}
          aoAdicionarPosto={(p) => {
            if (ehBurnin(p) && (tempos[p] ?? '') === '') setTempos((prev) => ({ ...prev, [p]: BURNIN_PADRAO }))
          }}
          rodapeTrecho={(t) => (
            <ReceitasDosPostos postos={t.postos} ehIntegracao={ehIntegracao} receita={receita} setReceita={setReceita}
              pmosExistentes={pmosExistentes} pmoDaOp={ordem.pmo} />
          )}
          avisoVazio="Nenhum posto neste trecho. Traga postos com ← → ou adicione um: o trecho não pode ficar vazio." />
      </section>

      <BarraFixa resumo={<ResumoRota trechos={trechos} />}>
        <Link href="/shopfloor/ordens-nova" className={buttonVariants({ variant: 'ghost' })}>Cancelar</Link>
        <Button type="button" onClick={salvar} disabled={salvando || !prontoParaSalvar} className="bg-enterplak hover:bg-enterplak-700">
          {salvando ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </BarraFixa>
      {dialog}
    </div>
  )
}
