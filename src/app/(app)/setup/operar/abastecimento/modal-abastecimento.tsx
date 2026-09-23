'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PainelResultado, type ChipResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { tocarErro } from '@/shared/lib/som-erro'
import { trocarRolo } from '@/modules/setup/application/setup-actions'

const INPUT_BIPE = 'h-11 text-lg uppercase'
const FALHA_CONEXAO_TROCA = 'Falha de conexão. Confira em Últimas trocas se a troca foi registrada antes de reenviar.'

type Campo = 'colaborador' | 'posicao' | 'feeder' | 'saida' | 'entrada' | 'sn'
const CAMPOS_VAZIOS: Record<Campo, string> = { colaborador: '', posicao: '', feeder: '', saida: '', entrada: '', sn: '' }
/** 4/6 — para onde a troca reprovada volta: é o primeiro campo que o operador tem que reconferir. */
const PASSO_ROLO_SAIDA = 3

interface PropsAbastecimento {
  setupId: string
  rotulos: { posicao: string; feeder: string }
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
  setupId, rotulos, colaboradorInicial, onColaboradorUsado, onTrocaRegistrada, onFalhaConexao,
}: PropsAbastecimento) {
  const [campos, setCampos] = useState<Record<Campo, string>>({ ...CAMPOS_VAZIOS, colaborador: colaboradorInicial })
  const [passo, setPasso] = useState(0)
  // Sobe a cada `irPara`: força o efeito de foco a rodar mesmo quando o passo não muda.
  const [refoco, setRefoco] = useState(0)
  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
  const [enviando, startEnvio] = useTransition()

  const campoRef = useRef<HTMLInputElement>(null)
  // Evita bipe duplo (scanner manda Enter rápido) enquanto a transição ainda não marcou `enviando`.
  const enviandoRef = useRef(false)

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
  const anteriores = passos.slice(0, passo)

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

  function avancar() {
    // O passo não passa em branco: sem valor, o Enter só mantém o operador no mesmo campo.
    if (campos[atual.campo].trim() === '') return
    if (passo < passos.length - 1) { irPara(passo + 1); return }
    enviar()
  }

  function enviar() {
    if (enviando || enviandoRef.current) return
    const v = {
      colaborador: campos.colaborador.trim(), posicao: campos.posicao.trim(), feeder: campos.feeder.trim(),
      saida: campos.saida.trim(), entrada: campos.entrada.trim(), sn: campos.sn.trim(),
    }
    const iVazio = passos.findIndex((p) => v[p.campo] === '')
    if (iVazio >= 0) { irPara(iVazio); return }
    const chips: ChipResultado[] = [
      { rotulo: rotulos.posicao, valor: v.posicao },
      { rotulo: rotulos.feeder, valor: v.feeder },
      { rotulo: 'Saiu', valor: v.saida, mono: true },
      { rotulo: 'Entrou', valor: v.entrada, mono: true },
      { rotulo: 'SN Inicial', valor: v.sn, mono: true },
    ]
    enviandoRef.current = true
    onColaboradorUsado(v.colaborador)
    startEnvio(async () => {
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
        if (!r.ok) {
          setResultado({ tipo: 'aviso', titulo: r.erro, chips })
          tocarErro()
          irPara(PASSO_ROLO_SAIDA)
        } else if (r.resultado === 'APROVADO') {
          setResultado({
            tipo: 'ok',
            titulo: 'Troca aprovada — pode seguir',
            chips,
            dica: r.semFaixa ? 'Confira o SN manualmente — a OP não tem faixa de SN cadastrada.' : undefined,
          })
          // Zera os cinco bipes e mantém o crachá: a próxima troca começa confirmando quem está na máquina.
          setCampos({ ...CAMPOS_VAZIOS, colaborador: v.colaborador })
          irPara(0)
        } else {
          setResultado({ tipo: 'reprova', titulo: 'Troca reprovada — confira o componente', detalhe: r.motivos.join(' '), chips })
          tocarErro()
          // Não limpa: o operador corrige só o que estiver errado.
          irPara(PASSO_ROLO_SAIDA)
        }
        onTrocaRegistrada()
      } finally {
        enviandoRef.current = false
      }
    })
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* Resultado e rastro cedem espaço (rolam por dentro) quando o teclado virtual abre; o campo atual, nunca. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto empty:hidden">
        <PainelResultado resultado={resultado} />
        {anteriores.length > 0 && (
          <dl className="flex flex-col gap-0.5 text-xs">
            {anteriores.map(({ campo, rotulo }) => (
              <div key={campo} className="flex gap-2">
                <dt className="w-24 flex-none truncate text-muted-foreground">{rotulo}</dt>
                <dd className="min-w-0 truncate font-medium">{campos[campo]}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="flex flex-none flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={`troca-${atual.campo}`} className="text-base">{atual.rotulo}</Label>
          <span className="text-sm tabular-nums text-muted-foreground">{passo + 1}/{passos.length}</span>
        </div>
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

      {passo > 0 && (
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-none self-start px-4 text-base"
          onClick={() => irPara(passo - 1)}
          disabled={enviando}
        >
          Voltar
        </Button>
      )}
    </div>
  )
}

/** O modal em si: abre por setup localizado ou pelo botão "Abastecer"; fechar descarta o que foi digitado. */
export function ModalAbastecimento({ aberto, onFechar, ...props }: PropsAbastecimento & { aberto: boolean; onFechar: () => void }) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) onFechar() }}>
      {/* initialFocus={false}: abrindo por toque o Base UI focaria o popup (para não abrir o teclado) e o
          primeiro bipe se perderia. Quem manda no foco é o efeito do passo, que também dá select(). */}
      <DialogContent className="flex flex-col sm:max-w-md" initialFocus={false}>
        <DialogHeader>
          <DialogTitle>Abastecimento</DialogTitle>
        </DialogHeader>
        {/* Monta de novo a cada abertura: a troca seguinte começa no 1/6, sem sobra do que foi fechado. */}
        {aberto && <ConteudoAbastecimento {...props} />}
      </DialogContent>
    </Dialog>
  )
}
