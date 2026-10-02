'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PainelResultado, type ChipResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { tocarErro } from '@/shared/lib/som-erro'
import { trocarRolo } from '@/modules/setup/application/setup-actions'
import { normalizarTexto } from '@/modules/setup/domain/codigo-rolo'
import { conferirPasso, type ItemDoSetup } from '@/modules/setup/domain/conferencia-troca'

// O campo é o herói desta tela: o operador bipa de pé, com o tablet na bancada, e confere
// de relance se o leitor pegou. Fonte grande não é enfeite — é o que se lê a um braço de
// distância sem abaixar a cabeça.
// O placeholder (dica) é um degrau menor que o valor: a dica longa do crachá tem de caber, o que se lê não encolhe.
const INPUT_BIPE = 'h-20 font-mono text-4xl uppercase tracking-wide placeholder:text-3xl md:text-4xl md:placeholder:text-3xl'
const FALHA_CONEXAO_TROCA = 'Falha de conexão. Confira em Últimas trocas se a troca foi registrada antes de reenviar.'
/** Recusas que o operador tem de perceber: bipe engolido em silêncio é erro invisível. */
const BIPE_EM_ENVIO = 'Registrando a troca anterior — esse bipe não contou. Bipe de novo.'
const CAMPO_EM_BRANCO = 'Campo em branco — bipe o código antes de avançar.'

type Campo = 'colaborador' | 'posicao' | 'feeder' | 'saida' | 'entrada' | 'sn'
const CAMPOS_VAZIOS: Record<Campo, string> = { colaborador: '', posicao: '', feeder: '', saida: '', entrada: '', sn: '' }
/**
 * 2/6 — para onde a troca reprovada volta. A reprova costuma ser de posição/feeder ("o feeder F03 não
 * está na posição 01"), não do rolo: voltando na posição o operador bipa de novo os quatro campos que a
 * verificação usa, em vez de só os rolos.
 */
const PASSO_POSICAO = 1

interface PropsAbastecimento {
  setupId: string
  rotulos: { posicao: string; feeder: string }
  /**
   * Os itens montados no setup, para conferir cada bipe no passo em que nasce. `null` quando a carga
   * falhou (ou veio vazia): o modal funciona como antes e o servidor confere tudo no envio — a conferência é um extra,
   * nunca pode travar o operador.
   */
  itens: ItemDoSetup[] | null
  /** A lista está sendo recarregada (pós-troca): o trilho diz "carregando", não "—" (que é "sem itens"). */
  carregandoItens?: boolean
  /** Onde ele está trabalhando (OP, processo, linha/bloco, face); some do resto da tela quando o modal abre. */
  contexto?: { op: string; processo: string; local: string; face: string }
  /** Último crachá usado: o passo 1/6 já vem preenchido com ele, só de confirmar. */
  colaboradorInicial: string
  onColaboradorUsado: (cracha: string) => void
  /** Recarrega o quadro "Últimas trocas" da página — vale para aprovada, reprovada e falha de rede. */
  onTrocaRegistrada: () => void
  /** Falha de rede: a mensagem vai para a página e o modal fecha, para o operador olhar o quadro. */
  onFalhaConexao: (resultado: ResultadoAcao) => void
}

/**
 * Passo a passo da troca de rolo: um campo por vez, contador N/6 e o rastro do que já foi bipado.
 * Um campo só na tela é o que garante o tablet sem scroll, inclusive com o teclado virtual aberto.
 * Exportado separado do Dialog para o teste montar só o passo a passo.
 */
export function ConteudoAbastecimento({
  setupId, rotulos, itens, carregandoItens = false, contexto, colaboradorInicial, onColaboradorUsado, onTrocaRegistrada, onFalhaConexao,
}: PropsAbastecimento) {
  const [campos, setCampos] = useState<Record<Campo, string>>({ ...CAMPOS_VAZIOS, colaborador: colaboradorInicial })
  const [passo, setPasso] = useState(0)
  // Sobe a cada `irPara`: força o efeito de foco a rodar mesmo quando o passo não muda.
  const [refoco, setRefoco] = useState(0)
  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
  /**
   * Estado comum, e não `useTransition`, de propósito. Com transição o React tratava o fim do envio
   * como trabalho de baixa prioridade: o reset dos campos aparecia na tela num desenho e o fim do
   * envio só no seguinte. No meio dos dois a tela já mostrava o passo novo e o componente ainda
   * recusava — e o bipe que caía nessa fresta era apagado pelo reset, calado. Aqui tudo assenta
   * junto, no mesmo desenho.
   */
  const [enviando, setEnviando] = useState(false)

  const campoRef = useRef<HTMLInputElement>(null)
  // Espelha `enviando` de forma síncrona: o leitor manda dois Enter tão rápido que o segundo chega
  // antes de o React aplicar o estado.
  const enviandoRef = useRef(false)
  // Há uma recusa de PASSO na tela (e não o desfecho do envio)? Só ela some quando o passo seguinte dá certo.
  const recusaDePassoRef = useRef(false)

  const passos: { campo: Campo; rotulo: string; placeholder?: string }[] = [
    { campo: 'colaborador', rotulo: 'Colaborador', placeholder: 'Bipe ou digite o crachá' },
    { campo: 'posicao', rotulo: rotulos.posicao },
    { campo: 'feeder', rotulo: rotulos.feeder },
    { campo: 'saida', rotulo: 'Rolo que sai', placeholder: 'CÓDIGO-LOTE' },
    { campo: 'entrada', rotulo: 'Rolo que entra', placeholder: 'CÓDIGO-LOTE' },
    { campo: 'sn', rotulo: 'SN Inicial', placeholder: 'Nº de Série da placa' },
  ]
  // `passo` só muda por `irPara` com índice de `passos`: o passo atual existe sempre.
  const atual = passos[passo]!
  const ultimo = passo === passos.length - 1
  const vazio = campos[atual.campo].trim() === ''

  function irPara(indice: number) {
    setPasso(indice)
    setRefoco((n) => n + 1)
  }

  // Sempre seleciona o conteúdo ao focar: o leitor de bipe digita em cima e substitui, em vez de concatenar.
  useEffect(() => {
    const el = campoRef.current
    el?.focus()
    el?.select()
  }, [passo, refoco])

  /** Recusa que se percebe: som e painel. Recusa calada é bipe perdido sem ninguém notar. */
  function recusar(titulo: string) {
    recusaDePassoRef.current = true
    setResultado({ tipo: 'aviso', titulo })
    tocarErro()
  }

  /** O que o Enter faz neste passo — e também o que o botão do rodapé faz, para o tablet só de toque. */
  function avancar() {
    // A troca anterior ainda está no servidor. O bipe não pode valer (viraria troca duplicada), mas
    // também não pode sumir: o operador não olha a tela, é o som que o alcança.
    if (enviando || enviandoRef.current) { recusar(BIPE_EM_ENVIO); return }
    // O passo não passa em branco — e avisa, porque um Enter sem valor é justamente o sintoma de
    // bipe que não pegou.
    if (vazio) { recusar(CAMPO_EM_BRANCO); return }
    // ATENÇÃO: `conferirPasso` devolve null para "nada a conferir" (inclusive valor vazio), não para
    // "aprovado". Por isso esta conferência vem DEPOIS da guarda do vazio — inverter a ordem deixaria o
    // passo em branco avançar calado.
    // Roda no cliente: nenhuma ida ao servidor entre um passo e outro, então não há espera nem janela
    // para o bipe seguinte entrar por cima. O envio final continua passando pela st_trocar_rolo, que vale.
    // Lista ausente OU vazia = sem conferência: com zero itens toda posição seria recusada e o operador
    // ficaria preso (um admin pode apagar os itens de um setup já liberado).
    const recusaDoPasso = itens === null || itens.length === 0 ? null : conferirPasso({
      campo: atual.campo,
      valor: campos[atual.campo],
      bipados: { posicao: campos.posicao, feeder: campos.feeder, saida: campos.saida },
      itens,
      pth: rotulos.posicao === 'Posto',
    })
    if (recusaDoPasso) {
      recusar(recusaDoPasso)
      setCampos((c) => ({ ...c, [atual.campo]: '' }))
      setRefoco((n) => n + 1)
      return
    }
    // Bipe certo depois de um errado: o erro já foi resolvido, não fica olhando para ele.
    if (recusaDePassoRef.current) { recusaDePassoRef.current = false; setResultado(null) }
    if (!ultimo) { irPara(passo + 1); return }
    enviar()
  }

  function enviar() {
    if (enviando || enviandoRef.current) return
    const v = {
      colaborador: campos.colaborador.trim(), posicao: campos.posicao.trim(), feeder: campos.feeder.trim(),
      saida: campos.saida.trim(), entrada: campos.entrada.trim(), sn: campos.sn.trim(),
    }
    const iVazio = passos.findIndex((p) => v[p.campo] === '')
    if (iVazio >= 0) { recusar(`Falta bipar ${passos[iVazio]!.rotulo}.`); irPara(iVazio); return }
    const chips: ChipResultado[] = [
      { rotulo: rotulos.posicao, valor: v.posicao },
      { rotulo: rotulos.feeder, valor: v.feeder },
      { rotulo: 'Saiu', valor: v.saida, mono: true },
      { rotulo: 'Entrou', valor: v.entrada, mono: true },
      { rotulo: 'SN Inicial', valor: v.sn, mono: true },
    ]
    enviandoRef.current = true
    setEnviando(true)
    onColaboradorUsado(v.colaborador)
    void (async () => {
      try {
        let r: Awaited<ReturnType<typeof trocarRolo>>
        try {
          r = await trocarRolo({
            setupId, posicao: v.posicao, feeder: v.feeder, roloSaida: v.saida, roloEntrada: v.entrada,
            snInicial: v.sn, colaborador: v.colaborador,
          })
        } catch {
          tocarErro()
          onTrocaRegistrada()
          onFalhaConexao({ tipo: 'aviso', titulo: FALHA_CONEXAO_TROCA, chips })
          return
        }
        // Todo desfecho zera os cinco bipes e mantém o crachá; muda só o passo de destino.
        // Desfecho do envio: não é recusa de passo, e permanece.
        recusaDePassoRef.current = false
        const recomecar = (indice: number) => {
          setCampos({ ...CAMPOS_VAZIOS, colaborador: v.colaborador })
          irPara(indice)
        }
        if (!r.ok) {
          setResultado({ tipo: 'aviso', titulo: r.erro, chips })
          tocarErro()
          recomecar(PASSO_POSICAO)
        } else if (r.resultado === 'APROVADO') {
          setResultado({
            tipo: 'ok',
            titulo: 'Troca aprovada — pode seguir',
            chips,
            dica: r.semFaixa ? 'Confira o SN manualmente — a OP não tem faixa de SN cadastrada.' : undefined,
          })
          // A próxima troca começa confirmando quem está na máquina.
          recomecar(0)
        } else {
          setResultado({ tipo: 'reprova', titulo: 'Troca reprovada — confira o componente', detalhe: r.motivos.join(' '), chips })
          tocarErro()
          // Campos vazios de propósito: com os valores antigos no lugar dava para sair apertando Enter
          // por cima e reenviar a mesma troca errada, que é o oposto de voltar na posição.
          recomecar(PASSO_POSICAO)
        }
        onTrocaRegistrada()
      } finally {
        // Cai no mesmo desenho que o reset dos campos acima: tudo o que acontece neste mesmo passo
        // do envio o React aplica de uma vez. É isso que fecha a fresta que engolia bipe.
        enviandoRef.current = false
        setEnviando(false)
      }
    })()
  }

  // O que o sistema já sabe, derivado dos itens JÁ carregados (nenhuma consulta nova). Só vale depois
  // da posição bipada; sem itens (null ou vazio) as linhas mostram "—", nunca moldura vazia.
  const temItens = itens !== null && itens.length > 0
  // O trilho decide pelo CONTEÚDO do campo, não pelo número do passo: quem volta para corrigir a
  // posição não pode perder o contexto justamente na hora em que ele mais importa.
  const posicaoBipada = campos.posicao.trim() !== ''
  const feederBipado = campos.feeder.trim() !== ''
  const daPosicao = temItens && posicaoBipada
    ? itens.filter((i) => normalizarTexto(i.posicao) === normalizarTexto(campos.posicao))
    : []
  const doItem = feederBipado ? daPosicao.filter((i) => normalizarTexto(i.feeder) === normalizarTexto(campos.feeder)) : daPosicao
  const unicos = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].join(' · ')
  const esperadoFeeder = unicos(daPosicao.map((i) => i.feeder))
  const esperadoComponente = unicos(doItem.map((i) => i.componente))
  const esperadoRolo = unicos(doItem.map((i) => i.rolo))
  const dicaPosicao = `Bipe ${rotulos.posicao === 'Posto' ? 'o posto' : 'a posição'} para ver o que o sistema espera.`

  type Linha = { chave: string; rotulo: string; valor: string; esperado: boolean; mono?: boolean }
  const linhas: Linha[] = [
    { chave: 'colaborador', rotulo: 'Colaborador', valor: campos.colaborador.trim().toUpperCase(), esperado: false },
    { chave: 'posicao', rotulo: rotulos.posicao, valor: posicaoBipada ? campos.posicao.trim() : '', esperado: false, mono: true },
    feederBipado
      ? { chave: 'feeder', rotulo: rotulos.feeder, valor: campos.feeder.trim(), esperado: false, mono: true }
      : { chave: 'feeder', rotulo: rotulos.feeder, valor: esperadoFeeder, esperado: true, mono: true },
    { chave: 'componente', rotulo: 'Componente', valor: esperadoComponente, esperado: true, mono: true },
    { chave: 'rolo', rotulo: 'Rolo montado', valor: esperadoRolo, esperado: true, mono: true },
    // O que saiu e o que entrou aparecem só depois de bipados: conferência de relance no 6/6.
    ...(campos.saida.trim() !== '' ? [{ chave: 'saida', rotulo: 'Rolo que sai', valor: campos.saida.trim(), esperado: false, mono: true }] : []),
    ...(campos.entrada.trim() !== '' ? [{ chave: 'entrada', rotulo: 'Rolo que entra', valor: campos.entrada.trim(), esperado: false, mono: true }] : []),
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Onde ele está trabalhando: some do resto da tela quando o modal abre, então fica aqui. */}
      {contexto && (
        <p className="flex-none text-base font-medium" data-testid="contexto">
          OP {contexto.op} · {contexto.processo} · {contexto.local} · {contexto.face}
        </p>
      )}

      {/* Trilha dos seis passos: feito / agora / por vir. O contador N/6 fica ao lado do rótulo. */}
      <div className="flex flex-none items-center gap-3">
        <ol className="flex flex-1 gap-1.5" aria-label="Passos da troca">
          {passos.map((p, i) => (
            <li
              key={p.campo}
              data-estado={i < passo ? 'feito' : i === passo ? 'agora' : 'porvir'}
              aria-current={i === passo ? 'step' : undefined}
              className={`h-2 flex-1 rounded-full ${i < passo ? 'bg-enterplak' : i === passo ? 'bg-enterplak/60 ring-2 ring-enterplak/40' : 'bg-muted'}`}
            />
          ))}
        </ol>
        <span className="text-lg font-semibold tabular-nums text-muted-foreground">{passo + 1}/{passos.length}</span>
      </div>

      <div className="@container flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 gap-4 @xl:grid-cols-[300px_minmax(0,1fr)]">
          {/* Trilho: o que o sistema já sabe. A pessoa confere em vez de lembrar. */}
          <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">O que você está trocando</h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 @xl:grid-cols-1">
              {linhas.map((l) => (
                <div key={l.chave} className="min-w-0">
                  <dt className="text-sm text-muted-foreground">{l.rotulo}</dt>
                  <dd className={`flex min-w-0 items-baseline gap-2 text-xl font-semibold ${l.mono ? 'font-mono' : ''}`}>
                    {l.valor !== '' ? (
                      <>
                        <span className="min-w-0 break-all">{l.valor}</span>
                        {l.esperado && <span className="flex-none rounded bg-muted px-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">esperado</span>}
                      </>
                    ) : (
                      <span className="text-base font-normal text-muted-foreground">{!temItens && l.esperado ? (carregandoItens ? 'carregando…' : '—') : 'aguardando'}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {temItens && !posicaoBipada && <p className="text-sm text-muted-foreground">{dicaPosicao}</p>}
          </aside>

          <div className="flex min-h-0 flex-col gap-3">
            {/* A recusa fica acima do campo: o motivo em destaque, onde o olho já está. Rola por dentro
                só se passar de 45vh; não cede espaço ao campo, que nunca sai da tela. */}
            <div className="flex max-h-[45vh] flex-none flex-col gap-3 overflow-y-auto empty:hidden">
              <PainelResultado resultado={resultado} />
            </div>

            <div className="flex flex-none flex-col justify-center gap-2 sm:flex-1">
              <Label htmlFor={`troca-${atual.campo}`} className="text-2xl font-semibold">{atual.rotulo}</Label>
              <Input
                id={`troca-${atual.campo}`}
                key={atual.campo}
                ref={campoRef}
                value={campos[atual.campo]}
                onChange={(e) => setCampos((c) => ({ ...c, [atual.campo]: e.target.value }))}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  avancar()
                }}
                placeholder={atual.placeholder}
                autoComplete="off"
                className={INPUT_BIPE}
              />
            </div>

            {/* O Enter do leitor continua sendo o caminho normal; o botão é para o tablet só de toque, cujo
                teclado virtual pode não ter Enter. Ele faz exatamente o que o Enter faria neste passo. */}
            <div className="flex flex-none gap-2">
              {passo > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-14 px-6 text-lg"
                  onClick={() => irPara(passo - 1)}
                  disabled={enviando}
                >
                  Voltar
                </Button>
              )}
              <Button
                type="button"
                className="h-14 flex-1 bg-enterplak px-6 text-lg hover:bg-enterplak-700"
                onClick={avancar}
                disabled={enviando || vazio}
              >
                {ultimo ? 'Registrar troca' : 'Avançar'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** O modal em si: abre por setup localizado ou pelo botão "Abastecer"; fechar descarta o que foi digitado. */
export function ModalAbastecimento({ aberto, onFechar, ...props }: PropsAbastecimento & { aberto: boolean; onFechar: () => void }) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) onFechar() }}>
      {/* initialFocus={false}: abrindo por toque o Base UI focaria o popup (para não abrir o teclado) e o
          primeiro bipe se perderia. Quem manda no foco é o efeito do passo, que também dá select(). */}
      {/* 65% da largura e da altura da tela, com um piso para o celular e um teto para o monitor
          grande. O `sm:max-w-md` de antes eram 448px FIXOS: no tablet do chão de fábrica, que é
          onde esta tela vive, sobrava tela de um lado e o rastro dos bipes já feitos ficava
          espremido. */}
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:h-[75vh] sm:max-w-[65vw] sm:min-w-[34rem] lg:max-w-[54rem]"
        initialFocus={false}
      >
        <DialogHeader>
          <DialogTitle>Abastecimento</DialogTitle>
        </DialogHeader>
        {/* Monta de novo a cada abertura: a troca seguinte começa no 1/6, sem sobra do que foi fechado. */}
        {aberto && <ConteudoAbastecimento {...props} />}
      </DialogContent>
    </Dialog>
  )
}
