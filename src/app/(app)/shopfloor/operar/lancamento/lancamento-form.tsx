'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { Plus, X, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PainelResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { HistoricoLancamentos, type LinhaHistorico } from './historico-lancamentos'
import { serieDentroDaFaixa } from '@/modules/shopfloor/domain/serie'
import { resolverOpPorSn } from '@/modules/shopfloor/domain/cabecalho-lancamento'
import { classificarAcao, defeitosDoPosto } from '@/modules/shopfloor/domain/acao-lancamento'
import { PERFIL_PADRAO, perfilTemStatus, perfilPedeConfirmacaoConserto, type PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import { formatarDuracao } from '@/modules/shopfloor/domain/tempo-burnin'
import { lancar, buscarEntradaBurnin, verificarConserto } from '@/modules/shopfloor/application/lancar-action'
import type { OrdemLancamentoLista } from '@/modules/shopfloor/infra/lancamento-repository'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { IntegracaoPanel } from './integracao-panel'
import { EmbalagemPanel } from './embalagem-panel'
import { AprovarModal } from './aprovar-modal'
import { ReprovarModal } from './reprovar-modal'

const TIPOS_DEFEITO = ['SMD', 'PTH', 'Integração', 'TOP', 'BOT', 'Funcional', 'Elétrico']
const OPCOES_STATUS = ['Aprovado', 'Reprovado']
// Paridade com o legado (Código.gs): NQA Funcional também aceita "Não aplicável" (conta como aprovado).
const OPCOES_NQA_FUNCIONAL = ['Aprovado', 'Reprovado', 'Não aplicável']

interface DefeitoLinha {
  codigo: string
  posicao: string
  tipo: string
}

/** Texto curto de um defeito para o diálogo de confirmação de conserto. */
function descreverDefeito(d: { codigo: string; posicao: string; tipo: string }): string {
  const partes: string[] = []
  if (d.posicao.trim()) partes.push(`Posição ${d.posicao.trim()}`)
  if (d.codigo.trim()) partes.push(`Cód ${d.codigo.trim()}`)
  if (d.tipo.trim()) partes.push(d.tipo.trim())
  return partes.join(' · ') || 'defeito relatado'
}


export function LancamentoForm({
  ordens,
  defeitos,
  postosPerfil,
}: {
  ordens: OrdemLancamentoLista[]
  defeitos: { codigo: string; tipo: number }[]
  postosPerfil: Record<string, PerfilPosto>
}) {
  const [colaborador, setColaborador] = useState('')
  const [cliente, setCliente] = useState('')
  const [pmo, setPmo] = useState('')
  const [op, setOp] = useState('')
  const [posto, setPosto] = useState('')
  const [numeroSerie, setNumeroSerie] = useState('')
  const [status, setStatus] = useState('')
  const [nqaVisual, setNqaVisual] = useState('')
  const [nqaFuncional, setNqaFuncional] = useState('')
  const [defeitosSel, setDefeitosSel] = useState<DefeitoLinha[]>([{ codigo: '', posicao: '', tipo: '' }])
  const [posicoesSPI, setPosicoesSPI] = useState<string[]>([''])
  const [burninEvento, setBurninEvento] = useState<'entrada' | 'saida'>('entrada')
  const [observacao, setObservacao] = useState('')
  const [bipeCab, setBipeCab] = useState('')
  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
  const [historico, setHistorico] = useState<LinhaHistorico[]>([])
  const [ultimoEhLancamento, setUltimoEhLancamento] = useState(false)
  const [aprovarSn, setAprovarSn] = useState<string | null>(null)
  const [reprovarCodigo, setReprovarCodigo] = useState<string | null>(null)
  const [enviando, startTransition] = useTransition()
  const [processando, setProcessando] = useState(false) // trava a UI do confirm até o resultado (não deixa bipar em cima)
  const [listaAberta, setListaAberta] = useState(false) // acordeão de defeitos (SPI/Inspeção/Teste) aberto?
  const snRef = useRef<HTMLInputElement>(null)
  const bipeCabRef = useRef<HTMLInputElement>(null)
  const colaboradorRef = useRef<HTMLInputElement>(null)
  const postoTriggerRef = useRef<HTMLButtonElement>(null)
  const burninEventoTriggerRef = useRef<HTMLButtonElement>(null)
  const nqaVisualRef = useRef<HTMLButtonElement>(null) // trigger do Select de Inspeção Visual
  const { confirmar, dialog } = useConfirmacao()

  const ordemSel = useMemo(
    () => ordens.find((o) => o.cliente === cliente && o.pmo === pmo && o.op === op) ?? null,
    [ordens, cliente, pmo, op],
  )
  const perfilDo = (p: string) => postosPerfil[p] ?? PERFIL_PADRAO

  const postosDaOp = ordemSel?.postos ?? []

  const comStatus = posto !== '' && perfilTemStatus(perfilDo(posto))
  const ehNqa = perfilDo(posto).recurso === 'nqa'
  const ehSpi = perfilDo(posto).reprova === 'posicoes'
  const ehEmbalagem = perfilDo(posto).recurso === 'caixa'
  const ehBurnin = perfilDo(posto).recurso === 'burnin'
  const ehIntegracao = posto !== '' && perfilDo(posto).recurso === 'integracao'
  // Postos de teste/inspeção com defeito: status implícito pelo que se bipa (SN→aprova, defeito→reprova).
  // SPI (migração 0075) também é reprova==='defeitos' → entra aqui (usa lista fixa de solda via defeitosPosto).
  // Burn-in entra só na SAÍDA (entrada é neutra: grava direto, sem classificar SN/defeito).
  const ehScanner = comStatus && !ehNqa && ((!ehBurnin && perfilDo(posto).reprova === 'defeitos') || (ehBurnin && burninEvento === 'saida'))
  // Burn-in entrada também passa pelo campo de ação (grava direto, sem classificar) — usado no roteamento Enter/Enviar.
  const usaAcao = ehScanner || (ehBurnin && burninEvento === 'entrada')
  // Postos de defeito não-Burn-in (Inspeção/Teste/SPI): o campo é SÓ o Nº de Série; o defeito vem de uma
  // lista em acordeão no mesmo campo (touch, sem depender do teclado ruim). Burn-in saída segue bipando no campo.
  const usaAcordeao = ehScanner && !ehBurnin
  const defeitosPosto = useMemo(() => defeitosDoPosto(perfilDo(posto).chave, defeitos), [posto, defeitos, postosPerfil])
  const defeitosFiltrados = useMemo(() => {
    const f = numeroSerie.trim().toUpperCase()
    return f === '' ? defeitosPosto : defeitosPosto.filter((d) => d.codigo.toUpperCase().includes(f))
  }, [numeroSerie, defeitosPosto])
  // No Burn-in, status/defeitos só valem na saída (entrada é neutra).
  const mostraStatus = comStatus && !ehNqa && (!ehBurnin || burninEvento === 'saida')
  const reprovado = status.toLowerCase() === 'reprovado'
  const semFaixa = ordemSel !== null && (ordemSel.sn_ini.trim() === '' || ordemSel.sn_fim.trim() === '')

  /** Mostra o resultado no balão; se `linha` vier, registra no histórico (lançamento efetivo). */
  function mostrar(res: ResultadoAcao, linha?: LinhaHistorico) {
    setResultado(res)
    if (linha) {
      setHistorico((h) => [linha, ...h].slice(0, 30))
      setUltimoEhLancamento(true)
      // Lançamento recusado (duplicado, sequência, fora da faixa…) também limpa o campo pra próxima bipagem.
      if (!linha.lancamento) limparPeca()
    } else {
      setUltimoEhLancamento(false)
    }
  }

  /** Limpa todos os campos dinâmicos da peça (evita dado velho ao trocar contexto/posto). */
  function resetCamposDinamicos() {
    setStatus(''); setDefeitosSel([{ codigo: '', posicao: '', tipo: '' }]); setPosicoesSPI([''])
    setNqaVisual(''); setNqaFuncional(''); setObservacao(''); setBurninEvento('entrada')
    setResultado(null); setUltimoEhLancamento(false); setListaAberta(false) // balão some → tabela volta a mostrar o histórico completo
  }
  /** Trocar entrada/saída limpa o status/defeitos (evita defeito velho da saída ao voltar p/ entrada). */
  function mudarBurninEvento(v: 'entrada' | 'saida') {
    setBurninEvento(v)
    setStatus(''); setDefeitosSel([{ codigo: '', posicao: '', tipo: '' }]); setPosicoesSPI([''])
    setTimeout(() => snRef.current?.focus(), 0) // escolhido o evento, foco vai pro campo de ação
  }
  function mudarPosto(v: string) {
    setPosto(v); resetCamposDinamicos(); setHistorico([]) // novo posto → histórico da sessão zera
    const perfilV = postosPerfil[v] ?? PERFIL_PADRAO
    // Burn-in → seletor de Evento; NQA → Inspeção Visual (A/R); demais → campo de ação (SN).
    setTimeout(() => {
      if (perfilV.recurso === 'burnin') burninEventoTriggerRef.current?.focus()
      else if (perfilV.recurso === 'nqa') nqaVisualRef.current?.focus()
      else snRef.current?.focus()
    }, 0)
  }
  function onBiparCabecalho() {
    if (bipeCab.trim() === '') return
    const r = resolverOpPorSn(ordens, bipeCab)
    if (!r.ok) {
      toast.error(r.erro === 'SEM_OP' ? 'SN não encontrado em nenhuma OP.' : 'SN cai em mais de uma OP.')
      bipeCabRef.current?.select()
      return
    }
    setCliente(r.ordem.cliente)
    setPmo(r.ordem.pmo)
    setOp(r.ordem.op)
    if (!r.ordem.postos.includes(posto)) setPosto('') // posto persiste se valer na nova OP; senão, re-escolher
    resetCamposDinamicos(); setHistorico([]) // nova OP → histórico zera
    setBipeCab('')
    setTimeout(() => colaboradorRef.current?.focus(), 0)
  }
  function atualizarCabecalho() {
    setCliente(''); setPmo(''); setOp('')
    setColaborador(''); setPosto('') // trocar de cabeçalho zera também quem e onde
    setNumeroSerie(''); resetCamposDinamicos(); setHistorico([]) // reset total → histórico zera
    setBipeCab('')
    setTimeout(() => bipeCabRef.current?.focus(), 0)
  }

  /** Motivo de o lançamento estar inválido (null = ok). Usado pro botão E pro feedback do Enter. */
  function motivoLancamento(): string | null {
    if (!colaborador.trim() || !cliente || !pmo || !op || !posto) return 'Preencha Colaborador, contexto (OP) e Posto antes de bipar.'
    if (numeroSerie.trim() === '') return 'Bipe o Nº de Série.'
    if (!ordemSel || semFaixa) return 'Esta OP não tem faixa de Nº de Série cadastrada.'
    if (!serieDentroDaFaixa(ordemSel.sn_ini, ordemSel.sn_fim, numeroSerie)) return 'Nº de Série fora da faixa desta OP.'
    if (ehNqa && (nqaVisual === '' || nqaFuncional === '')) return 'Selecione a Inspeção Visual e a Funcional.'
    if (mostraStatus && status === '') return 'Selecione o Status (Aprovado/Reprovado).'
    if (mostraStatus && reprovado) {
      if (ehSpi) { if (!posicoesSPI.some((p) => p.trim() !== '')) return 'Informe ao menos uma posição do defeito.' }
      // servidor exige código E posição E tipo em ao menos um defeito
      else if (!defeitosSel.some((d) => d.codigo.trim() !== '' && d.posicao.trim() !== '' && d.tipo.trim() !== '')) return 'Preencha código, posição e tipo do defeito.'
    }
    return null
  }
  const valido = motivoLancamento() === null

  function limparPeca() {
    setNumeroSerie(''); setStatus(''); setNqaVisual(''); setNqaFuncional(''); setObservacao(''); setListaAberta(false)
    setDefeitosSel([{ codigo: '', posicao: '', tipo: '' }]); setPosicoesSPI([''])
    // Volta pro início do ciclo da tela: NQA começa na Inspeção Visual; demais, no campo de SN.
    setTimeout(() => (ehNqa ? nqaVisualRef.current : snRef.current)?.focus(), 0)
  }

  async function onEnviar() {
    if (enviando) return
    if (numeroSerie.trim() === '') { setTimeout(() => (ehNqa ? nqaVisualRef.current : snRef.current)?.focus(), 0); return }
    const motivo = motivoLancamento()
    if (motivo) { mostrar({ tipo: 'aviso', titulo: motivo }); limparPeca(); return } // erro claro + limpa o campo
    setProcessando(true) // trava o campo até o resultado
    // Aviso de tempo mínimo de Burn-in (só na saída; não trava).
    if (ehBurnin && burninEvento === 'saida' && (ordemSel?.tempoBurninPorPosto?.[posto] ?? 0) > 0) {
      const entradaIso = await buscarEntradaBurnin(pmo, op, numeroSerie, posto)
      if (entradaIso) {
        const decorridoMin = (Date.now() - Date.parse(entradaIso)) / 60000
        const min = ordemSel!.tempoBurninPorPosto[posto]!
        if (decorridoMin < min) {
          const faltam = formatarDuracao(Math.max(1, Math.ceil(min - decorridoMin)))
          const ok = await confirmar({
            titulo: 'Sair antes do tempo mínimo de Burn-in?',
            descricao: `Faltavam ${faltam} para o mínimo. Registrar a saída mesmo assim?`,
            rotuloConfirmar: 'Registrar saída',
          })
          if (!ok) return
        }
      }
    }
    // Confirmação de conserto: ao APROVAR num posto que coleta defeito e conserta no próprio posto,
    // se o último registro da peça ali foi reprova, confirmar que o defeito foi consertado.
    let conservoConfirmado: { codigo: string; posicao: string; tipo: string }[] | undefined
    if (!ehBurnin && comStatus && status === 'Aprovado' && perfilPedeConfirmacaoConserto(perfilDo(posto))) {
      const defeitos = await verificarConserto(pmo, op, numeroSerie, posto)
      if (defeitos && defeitos.length > 0) {
        const lista = defeitos.map(descreverDefeito).join(' · ')
        const ok = await confirmar({
          titulo: 'Confirmar conserto do defeito?',
          descricao: `Esta peça reprovou com: ${lista}. Confirma que foi consertado antes de aprovar?`,
          rotuloConfirmar: 'Sim, foi consertado',
        })
        if (!ok) return
        conservoConfirmado = defeitos
      }
    }

    startTransition(async () => {
      const r = await lancar({
        colaborador,
        posto,
        pmo,
        op,
        numeroSerie,
        status: mostraStatus ? status : undefined,
        burninEvento: ehBurnin ? burninEvento : undefined,
        nqaVisual: ehNqa ? nqaVisual : undefined,
        nqaFuncional: ehNqa ? nqaFuncional : undefined,
        observacao: ehNqa ? observacao : undefined,
        defeitos:
          reprovado && !ehSpi
            ? defeitosSel.filter((d) => d.codigo.trim() !== '' && d.posicao.trim() !== '' && d.tipo.trim() !== '')
            : undefined,
        posicoesSPI: reprovado && ehSpi ? posicoesSPI.filter((p) => p.trim() !== '') : undefined,
        conservoConfirmado,
      })
      // Resultado (aprovado/reprovado) do posto: NQA é derivado de Visual/Funcional; demais, do Status.
      const outcome: 'aprovado' | 'reprovado' | null = ehNqa
        ? (nqaVisual === 'Reprovado' || nqaFuncional === 'Reprovado' ? 'reprovado' : 'aprovado')
        : (mostraStatus && status ? (status === 'Reprovado' ? 'reprovado' : 'aprovado') : null)
      const sn = numeroSerie.trim()
      setProcessando(false) // resultado chegou → destrava
      if (r.ok) {
        mostrar({
          tipo: outcome === 'reprovado' ? 'reprova' : 'ok',
          titulo: 'Peça registrada',
          chips: [
            { rotulo: 'Nº Série', valor: sn, mono: true },
            { rotulo: 'Posto', valor: posto },
            ...(mostraStatus && status ? [{ valor: status, destaque: status === 'Aprovado' }] : []),
          ],
        }, { lancamento: true, status: outcome, sn })
        limparPeca()
      } else {
        mostrar({
          tipo: 'aviso',
          titulo: r.erro,
          chips: [
            { rotulo: 'Nº Série', valor: sn, mono: true },
            { rotulo: 'Posto', valor: posto },
          ],
        }, { lancamento: false, status: null, sn })
      }
    })
  }

  /** Rótulo do tipo de defeito a partir do catálogo (backend exige tipo preenchido no reprovado; nunca vazio). */
  function tipoTextoDoCodigo(codigo: string): string {
    const d = defeitos.find((x) => x.codigo === codigo)
    return d?.tipo === 2 ? 'Teste' : 'Peça'
  }

  /** Postos-scanner: decide aprovado/reprovado pelo que foi bipado no campo de ação. */
  function onAcao() {
    if (!colaborador.trim() || !posto || !ordemSel || semFaixa) {
      mostrar({ tipo: 'aviso', titulo: 'Preencha Colaborador e Posto (com OP e faixa de Nº de Série) antes de bipar.' })
      return
    }
    // Burn-in entrada é neutra: não classifica (não é aprovação/reprova) — grava direto.
    if (ehBurnin && burninEvento === 'entrada') {
      gravarBurninEntrada()
      return
    }
    // Inspeção/Teste/SPI: o campo é SÓ Nº de Série — reprova é pela lista (acordeão).
    if (usaAcordeao) {
      if (serieDentroDaFaixa(ordemSel.sn_ini, ordemSel.sn_fim, numeroSerie)) {
        setAprovarSn(numeroSerie.trim())
      } else {
        mostrar({ tipo: 'aviso', titulo: 'Nº de Série fora da faixa desta OP. Para reprovar, abra a lista de defeitos (seta).' })
        limparPeca()
      }
      return
    }
    // Burn-in saída (demais scanner): classifica SN ou defeito bipado no campo.
    const r = classificarAcao(numeroSerie, defeitosPosto, ordemSel.sn_ini, ordemSel.sn_fim)
    if (r.tipo === 'aprovado') {
      setAprovarSn(numeroSerie.trim())
    } else if (r.tipo === 'reprovado') {
      setReprovarCodigo(r.codigo)
    } else {
      mostrar({ tipo: 'aviso', titulo: 'Não reconhecido: nem SN da faixa desta OP, nem defeito do catálogo.' })
      limparPeca() // limpa o campo pra próxima bipagem
    }
  }

  /** Abre/fecha o acordeão de defeitos e limpa o campo (SN ↔ filtro não se misturam). */
  function alternarLista() {
    setListaAberta((a) => !a)
    setNumeroSerie('')
    setTimeout(() => snRef.current?.focus(), 0)
  }
  /** Escolher um defeito da lista abre o modal de reprova (SN é bipado lá dentro). */
  function escolherDefeito(codigo: string) {
    setReprovarCodigo(codigo)
    setListaAberta(false)
    setNumeroSerie('')
  }

  /** Burn-in entrada: SN bipado grava direto (sem modal, sem status — evento neutro). */
  function gravarBurninEntrada() {
    if (enviando) return
    const sn = numeroSerie.trim()
    if (sn === '') return
    setProcessando(true) // trava o campo até o resultado
    startTransition(async () => {
      const r = await lancar({ colaborador, posto, pmo, op, numeroSerie: sn, burninEvento: 'entrada' })
      setProcessando(false) // resultado chegou → destrava
      if (r.ok) {
        mostrar({
          tipo: 'ok',
          titulo: 'Entrada de Burn-in registrada',
          chips: [
            { rotulo: 'Nº Série', valor: sn, mono: true },
            { rotulo: 'Posto', valor: posto },
          ],
        }, { lancamento: true, status: null, sn })
        limparPeca()
      } else {
        mostrar({
          tipo: 'aviso',
          titulo: r.erro,
          chips: [
            { rotulo: 'Nº Série', valor: sn, mono: true },
            { rotulo: 'Posto', valor: posto },
          ],
        }, { lancamento: false, status: null, sn })
      }
    })
  }

  async function gravarAprovado() {
    const sn = aprovarSn
    if (sn === null || enviando) return
    setAprovarSn(null) // fecha o modal na hora
    setProcessando(true) // trava o campo até o resultado
    setTimeout(() => snRef.current?.focus(), 0) // foco volta já; se houver diálogo de aviso/conserto, ele assume

    // Aviso de tempo mínimo de Burn-in (saída antecipada; não trava — só confirma).
    if (ehBurnin && burninEvento === 'saida' && (ordemSel?.tempoBurninPorPosto?.[posto] ?? 0) > 0) {
      const entradaIso = await buscarEntradaBurnin(pmo, op, sn, posto)
      if (entradaIso) {
        const decorridoMin = (Date.now() - Date.parse(entradaIso)) / 60000
        const min = ordemSel!.tempoBurninPorPosto[posto]!
        if (decorridoMin < min) {
          const faltam = formatarDuracao(Math.max(1, Math.ceil(min - decorridoMin)))
          const ok = await confirmar({
            titulo: 'Sair antes do tempo mínimo de Burn-in?',
            descricao: `Faltavam ${faltam} para o mínimo. Registrar a saída mesmo assim?`,
            rotuloConfirmar: 'Registrar saída',
          })
          if (!ok) { setProcessando(false); setTimeout(() => snRef.current?.focus(), 0); return } // aborta a saída
        }
      }
    }

    // Confirmação de conserto: se o posto pede e a peça tinha reprova, confirma que o defeito foi
    // consertado antes de gravar o Aprovado (mesma regra do fluxo antigo, agora no caminho scanner).
    // Burn-in exige manutenção → perfilPedeConfirmacaoConserto é sempre false pra ele; não roda aqui.
    let conservoConfirmado: { codigo: string; posicao: string; tipo: string }[] | undefined
    if (perfilPedeConfirmacaoConserto(perfilDo(posto))) {
      const defeitos = await verificarConserto(pmo, op, sn, posto)
      if (defeitos && defeitos.length > 0) {
        const lista = defeitos.map(descreverDefeito).join(' · ')
        const ok = await confirmar({
          titulo: 'Confirmar conserto do defeito?',
          descricao: `Esta peça reprovou com: ${lista}. Confirma que foi consertado antes de aprovar?`,
          rotuloConfirmar: 'Sim, foi consertado',
        })
        if (!ok) { setProcessando(false); setTimeout(() => snRef.current?.focus(), 0); return } // aborta a aprovação
        conservoConfirmado = defeitos
      }
    }
    setTimeout(() => snRef.current?.focus(), 0)
    startTransition(async () => {
      const r = await lancar({
        colaborador, posto, pmo, op, numeroSerie: sn, status: 'Aprovado', conservoConfirmado,
        burninEvento: ehBurnin ? 'saida' : undefined,
      })
      setProcessando(false) // resultado chegou → destrava
      if (r.ok) {
        mostrar({
          tipo: 'ok',
          titulo: ehBurnin ? 'Saída de Burn-in registrada' : 'Peça registrada',
          chips: [
            { rotulo: 'Nº Série', valor: sn.trim(), mono: true },
            { rotulo: 'Posto', valor: posto },
            { valor: 'Aprovado', destaque: true },
          ],
        }, { lancamento: true, status: 'aprovado', sn: sn.trim() })
        limparPeca()
      } else {
        mostrar({
          tipo: 'aviso',
          titulo: r.erro,
          chips: [
            { rotulo: 'Nº Série', valor: sn.trim(), mono: true },
            { rotulo: 'Posto', valor: posto },
          ],
        }, { lancamento: false, status: null, sn: sn.trim() })
      }
    })
  }

  async function gravarReprovado(dados: { defeitos: { codigo: string; posicao: string }[]; sn: string }) {
    if (enviando) return
    setReprovarCodigo(null) // fecha o modal na hora; o registro roda em 2º plano
    setProcessando(true) // trava o campo até o resultado
    setTimeout(() => snRef.current?.focus(), 0)

    // Aviso de tempo mínimo de Burn-in (saída antecipada; não trava — só confirma).
    if (ehBurnin && burninEvento === 'saida' && (ordemSel?.tempoBurninPorPosto?.[posto] ?? 0) > 0) {
      const entradaIso = await buscarEntradaBurnin(pmo, op, dados.sn, posto)
      if (entradaIso) {
        const decorridoMin = (Date.now() - Date.parse(entradaIso)) / 60000
        const min = ordemSel!.tempoBurninPorPosto[posto]!
        if (decorridoMin < min) {
          const faltam = formatarDuracao(Math.max(1, Math.ceil(min - decorridoMin)))
          const ok = await confirmar({
            titulo: 'Sair antes do tempo mínimo de Burn-in?',
            descricao: `Faltavam ${faltam} para o mínimo. Registrar a saída mesmo assim?`,
            rotuloConfirmar: 'Registrar saída',
          })
          if (!ok) { setProcessando(false); setTimeout(() => snRef.current?.focus(), 0); return } // aborta a saída
        }
      }
    }

    startTransition(async () => {
      const r = await lancar({
        colaborador,
        posto,
        pmo,
        op,
        numeroSerie: dados.sn,
        status: 'Reprovado',
        defeitos: dados.defeitos.map((x) => ({ codigo: x.codigo, posicao: x.posicao, tipo: tipoTextoDoCodigo(x.codigo) })),
        burninEvento: ehBurnin ? 'saida' : undefined,
      })
      setReprovarCodigo(null)
      setProcessando(false) // resultado chegou → destrava
      if (r.ok) {
        mostrar({
          tipo: 'reprova',
          titulo: ehBurnin ? 'Saída de Burn-in registrada' : 'Peça registrada',
          chips: [
            { rotulo: 'Nº Série', valor: dados.sn.trim(), mono: true },
            { rotulo: 'Posto', valor: posto },
            { valor: 'Reprovado', destaque: false },
          ],
        }, { lancamento: true, status: 'reprovado', sn: dados.sn.trim() })
        limparPeca()
      } else {
        mostrar({
          tipo: 'aviso',
          titulo: r.erro,
          chips: [
            { rotulo: 'Nº Série', valor: dados.sn.trim(), mono: true },
            { rotulo: 'Posto', valor: posto },
          ],
        }, { lancamento: false, status: null, sn: dados.sn.trim() })
      }
    })
  }

  return (
    <div className={`flex flex-col gap-3 ${ehIntegracao ? 'min-h-full' : 'h-full min-h-0'}`}>
      {/* Contexto */}
      <Card size="sm" className="shrink-0">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Contexto</CardTitle>
          {op !== '' && (
            <Button variant="outline" size="sm" onClick={atualizarCabecalho}>Atualizar cabeçalho</Button>
          )}
        </CardHeader>
        {op === '' ? (
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="bipeCab">Bipe o Nº de Série para carregar a OP</Label>
            <Input
              id="bipeCab"
              ref={bipeCabRef}
              value={bipeCab}
              onChange={(e) => setBipeCab(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBiparCabecalho() } }}
              placeholder="Bipe ou digite o SN e Enter"
              autoComplete="off"
              autoFocus
              className="h-12 text-lg"
            />
            <p className="text-xs text-muted-foreground">Digitar + Enter também funciona (sem scanner).</p>
          </CardContent>
        ) : (
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="colaborador">Colaborador</Label>
              <Input
                id="colaborador"
                ref={colaboradorRef}
                value={colaborador}
                onChange={(e) => setColaborador(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); postoTriggerRef.current?.focus() } }}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Cliente</Label>
              <Input value={cliente} readOnly disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>PMO</Label>
              <Input value={pmo} readOnly disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>OP</Label>
              <Input value={op} readOnly disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Posto</Label>
              <Select value={posto} onValueChange={(v) => mudarPosto(v ?? '')}>
                <SelectTrigger ref={postoTriggerRef}><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{postosDaOp.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Descrição</Label>
              <Input value={ordemSel?.descricao ?? ''} readOnly disabled />
            </div>
            {semFaixa && (
              <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-3">Esta OP não tem faixa de Nº de Série cadastrada — não é possível lançar.</p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Área de ação: empilha no estreito, 2 colunas no lg (bipe/ação à esquerda, resultado à direita).
          grid-rows minmax(0,1fr) trava a linha → a coluna direita (histórico) rola por dentro, não empurra a página. */}
      <div className={`flex flex-col ${ehIntegracao ? '' : 'min-h-0 flex-1 lg:grid lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)] lg:gap-4'}`}>
        {ehIntegracao && (
          <div className="flex flex-col">
            <IntegracaoPanel
              colaborador={colaborador}
              cliente={cliente}
              pmo={pmo}
              op={op}
              posto={posto}
              descricao={ordemSel?.descricao ?? ''}
              componentes={ordemSel?.receitaPorPosto?.[posto] ?? []}
            />
          </div>
        )}

        {ehEmbalagem && (
          <div className="flex min-h-0 flex-col lg:col-span-2">
            <EmbalagemPanel colaborador={colaborador} pmo={pmo} op={op} posto={posto} qtdOP={ordemSel?.qtd ?? null} />
          </div>
        )}

        {/* Bipagem */}
        {!ehIntegracao && !ehEmbalagem && (
          <>
            <Card className="flex min-h-0 flex-col">
              <CardHeader className="shrink-0 flex flex-row items-center justify-between gap-2">
                <CardTitle>Peça</CardTitle>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
                {/* Burn-in: Evento vem ANTES do campo de ação (define entrada=neutra / saída=scanner). */}
                {ehBurnin && (
                  <div className="flex shrink-0 flex-col gap-1.5 sm:max-w-xs">
                    <Label>Evento</Label>
                    <Select value={burninEvento} onValueChange={(v) => mudarBurninEvento((v ?? 'entrada') as 'entrada' | 'saida')}>
                      <SelectTrigger ref={burninEventoTriggerRef}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="entrada">Entrada</SelectItem>
                        <SelectItem value="saida">Saída</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {ehNqa && (
                  <div className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-lg">
                    <div className="flex flex-col gap-1.5">
                      <Label>Inspeção Visual</Label>
                      <Select value={nqaVisual} onValueChange={(v) => setNqaVisual(v ?? '')}>
                        <SelectTrigger ref={nqaVisualRef} className="h-12 text-base"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>{OPCOES_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Inspeção Funcional</Label>
                      <Select value={nqaFuncional} onValueChange={(v) => setNqaFuncional(v ?? '')}>
                        <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>{OPCOES_NQA_FUNCIONAL.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <Label htmlFor="nqaObservacao">Comentário</Label>
                      <Input
                        id="nqaObservacao"
                        value={observacao}
                        onChange={(e) => setObservacao(e.target.value)}
                        placeholder="Comentário livre (opcional)"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                )}

                <div className="flex shrink-0 flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="sn">{ehScanner && !usaAcordeao ? 'Bipe a peça ou o código do defeito' : 'Nº de Série'}</Label>
                    {(enviando || processando) && (
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600" aria-live="polite">
                        <span className="size-3 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" /> Gravando…
                      </span>
                    )}
                  </div>
                  {ehScanner && !usaAcordeao && (
                    <datalist id="acao-defeitos-list">
                      {defeitosPosto.map((d) => <option key={d.codigo} value={d.codigo} />)}
                    </datalist>
                  )}
                  <div className="relative">
                    <Input
                      id="sn"
                      ref={snRef}
                      value={numeroSerie}
                      onChange={(e) => setNumeroSerie(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        if (usaAcordeao && listaAberta) { const d0 = defeitosFiltrados[0]; if (d0) escolherDefeito(d0.codigo) }
                        else if (usaAcao) onAcao()
                        else onEnviar()
                      }}
                      autoComplete="off"
                      disabled={enviando || processando}
                      list={ehScanner && !usaAcordeao ? 'acao-defeitos-list' : undefined}
                      className={`h-12 text-lg disabled:opacity-60 ${usaAcordeao ? 'pr-12' : ''}`}
                      placeholder={usaAcordeao ? (listaAberta ? 'Filtre o defeito…' : 'Bipe o Nº de Série') : (ehScanner ? 'Bipe a peça ou o código do defeito' : 'Bipe o Nº de Série')}
                    />
                    {usaAcordeao && (
                      <button
                        type="button"
                        aria-label={listaAberta ? 'Fechar lista de defeitos' : 'Abrir lista de defeitos'}
                        aria-expanded={listaAberta}
                        onClick={alternarLista}
                        disabled={enviando || processando}
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-enterplak disabled:opacity-40"
                      >
                        {listaAberta ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
                      </button>
                    )}
                  </div>
                  {usaAcordeao && listaAberta && (
                    <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-border">
                      {defeitosFiltrados.length === 0 && (
                        <p className="px-3 py-3 text-sm text-muted-foreground">Nenhum defeito com “{numeroSerie.trim()}”.</p>
                      )}
                      {defeitosFiltrados.map((d) => (
                        <button
                          key={d.codigo}
                          type="button"
                          onClick={() => escolherDefeito(d.codigo)}
                          className="block w-full border-b border-border px-3 py-2.5 text-left text-base last:border-b-0 hover:bg-muted"
                        >
                          {d.codigo}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {mostraStatus && !ehScanner && (
                  <div className="flex shrink-0 flex-col gap-1.5 sm:max-w-xs">
                    <Label>Status</Label>
                    <Select value={status} onValueChange={(v) => setStatus(v ?? '')}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>{OPCOES_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}

                {/* Demais reprovado → defeitos múltiplos */}
                {mostraStatus && !ehSpi && !ehScanner && reprovado && (
                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                    <Label>Defeitos</Label>
                    <datalist id="defeitos-list">
                      {defeitos.map((d) => <option key={d.codigo} value={d.codigo} />)}
                    </datalist>
                    {defeitosSel.map((d, i) => (
                      <div key={i} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                        <Input list="defeitos-list" value={d.codigo} onChange={(e) => setDefeitosSel(defeitosSel.map((x, idx) => (idx === i ? { ...x, codigo: e.target.value } : x)))} placeholder="Código" />
                        <Input value={d.posicao} onChange={(e) => setDefeitosSel(defeitosSel.map((x, idx) => (idx === i ? { ...x, posicao: e.target.value } : x)))} placeholder="Posição" />
                        <Select value={d.tipo} onValueChange={(v) => setDefeitosSel(defeitosSel.map((x, idx) => (idx === i ? { ...x, tipo: v ?? '' } : x)))}>
                          <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                          <SelectContent>{TIPOS_DEFEITO.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                        <button type="button" aria-label="Remover defeito" onClick={() => setDefeitosSel(defeitosSel.length > 1 ? defeitosSel.filter((_, idx) => idx !== i) : defeitosSel)} className="pb-2 text-muted-foreground hover:text-red-600 disabled:opacity-30" disabled={defeitosSel.length <= 1}>
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setDefeitosSel([...defeitosSel, { codigo: '', posicao: '', tipo: '' }])} className="self-start text-sm font-medium text-enterplak hover:underline">
                      <Plus className="mr-1 inline size-4" /> Adicionar defeito
                    </button>
                  </div>
                )}

                {!usaAcao && (
                  <div className="shrink-0">
                    <Button onClick={onEnviar} disabled={!valido || enviando} className="h-11 bg-enterplak px-8 hover:bg-enterplak-700">
                      {enviando ? 'Enviando…' : 'Enviar'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex min-h-0 flex-1 flex-col">
              <PainelResultado resultado={resultado} />
              <HistoricoLancamentos linhas={ultimoEhLancamento ? historico.slice(1) : historico} />
            </div>
          </>
        )}
      </div>
      <AprovarModal
        aberto={aprovarSn !== null}
        sn={aprovarSn ?? ''}
        onConfirmar={gravarAprovado}
        onCancelar={() => { setAprovarSn(null); setTimeout(() => snRef.current?.focus(), 0) }}
      />
      <ReprovarModal
        aberto={reprovarCodigo !== null}
        codigoInicial={reprovarCodigo ?? ''}
        defeitosCatalogo={defeitosPosto.map((d) => d.codigo)}
        snEsperado=""
        onConfirmar={gravarReprovado}
        onCancelar={() => { setReprovarCodigo(null); setTimeout(() => snRef.current?.focus(), 0) }}
      />
      {dialog}
    </div>
  )
}
