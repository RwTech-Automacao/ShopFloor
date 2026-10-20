'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PainelResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import {
  listarNecessidadesAlmoxarifado,
  registrarEntradaAlmoxarifado,
} from '@/modules/shopfloor/application/almoxarifado-actions'
import type { NecessidadeAlmoxarifado } from '@/modules/shopfloor/domain/almoxarifado'

/** Estado da lista de necessidades: a falha é um estado PRÓPRIO, nunca uma lista vazia. */
type EstadoNecessidades =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; itens: NecessidadeAlmoxarifado[] }
  | { tipo: 'erro'; erro: string }

const pecas = (n: number) => (n === 1 ? '1 peça' : `${n} peças`)

interface EntradaSessao {
  bipe: string
  quantidade: number
  tipo: 'serie' | 'caixa'
}

/**
 * Posto Almoxarifado — último da linha. O operador bipa o que acabou de ser embalado: o Nº de
 * Série da peça (OP individual, vale 1 unidade) ou o código da caixa fechada (OP coletiva, o bipe
 * vale a caixa inteira). Campo único, no molde das demais telas de bipe (IntegracaoPanel):
 * card "Peça" ao lado do Contexto, e o acompanhamento (PainelResultado + rastro da sessão) embaixo.
 *
 * REENTRÂNCIA — o ponto mais importante deste painel: estado comum (não `useTransition`) pro
 * envio, e um ref síncrono como trava. É o mesmo remédio do fix do Abastecimento (commit
 * `2565526`): com `useTransition`, o fim da transição e o reset dos campos podiam assentar em
 * desenhos (renders) DIFERENTES — a tela já mostrava o campo destravado antes do reset "pintar",
 * e o bipe que caísse nessa fresta era apagado em silêncio. Com `useState` comum, tudo o que o
 * envio muda (resultado, campo, trava) assenta junto. O ref cobre o caso do leitor mandando dois
 * Enter tão rápido que o segundo chega antes de o React sequer aplicar o primeiro `setState`.
 *
 * CAIXAS ESPERANDO CONFIRMAÇÃO (0155): acima do campo, a lista das caixas fechadas que o posto
 * anterior da rota já concluiu e que ainda não deram entrada. Confirmar é o MESMO bipe de sempre (o
 * código da caixa); depois de cada bipe aceito a lista é recarregada e a caixa confirmada some. A lista
 * só informa — o bipe não depende dela e continua funcionando igual se ela falhar.
 */
export function AlmoxarifadoPanel({
  colaborador,
  pmo,
  op,
  posto,
  contexto,
}: {
  colaborador: string
  pmo: string
  op: string
  posto: string
  contexto?: React.ReactNode
}) {
  const [bipe, setBipe] = useState('')
  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
  const [recentes, setRecentes] = useState<EntradaSessao[]>([])
  const [enviando, setEnviando] = useState(false)
  const enviandoRef = useRef(false) // espelha `enviando` de forma síncrona — trava o 2º Enter do leitor
  const bipeRef = useRef<HTMLInputElement>(null)
  // A última resposta, com a OP a que ela pertence: enquanto a OP do painel não tem resposta, a lista
  // está "carregando" (derivado, sem setState no corpo do efeito).
  const [respostaNec, setRespostaNec] = useState<{ chave: string; estado: EstadoNecessidades } | null>(null)
  // Só a resposta da ÚLTIMA consulta vale: trocar de OP no meio de uma consulta não pode deixar a
  // lista da OP anterior na tela.
  const consultaRef = useRef(0)
  const temOp = pmo.trim() !== '' && op.trim() !== ''
  const chaveOp = `${pmo}/${op}`
  const necessidades: EstadoNecessidades =
    respostaNec && respostaNec.chave === chaveOp ? respostaNec.estado : { tipo: 'carregando' }

  const carregarNecessidades = useCallback(async () => {
    const minha = ++consultaRef.current
    const chave = `${pmo}/${op}`
    let estado: EstadoNecessidades
    try {
      const r = await listarNecessidadesAlmoxarifado(pmo, op)
      estado = r.ok ? { tipo: 'ok', itens: r.necessidades } : { tipo: 'erro', erro: r.erro }
    } catch {
      estado = { tipo: 'erro', erro: 'Não foi possível carregar as caixas esperando confirmação.' }
    }
    if (minha === consultaRef.current) setRespostaNec({ chave, estado })
  }, [pmo, op])

  useEffect(() => {
    if (!temOp) return
    void carregarNecessidades()
  }, [temOp, carregarNecessidades])

  // Refoca assim que o envio termina — aceito (campo já limpo) ou recusado (texto fica, pro
  // operador ver o que bipou e decidir se bipa de novo ou corrige).
  useEffect(() => {
    if (enviando) return
    bipeRef.current?.focus()
  }, [enviando])

  function onBipar() {
    // Envio anterior ainda em voo: a trava síncrona pega o Enter duplo ANTES do React sequer
    // reaplicar o `enviando` do estado — recusa sem reenviar e sem tocar no campo.
    if (enviandoRef.current) {
      setResultado({ tipo: 'aviso', titulo: 'Registrando o bipe anterior — este ainda não contou. Bipe de novo.' })
      return
    }
    if (bipe.trim() === '') return
    const alvo = bipe
    enviandoRef.current = true
    setEnviando(true)
    // IIFE comum, não `startTransition`: tudo que muda ao final (resultado, campo, trava) precisa
    // assentar no MESMO desenho — é isso que fecha a fresta que engoliu bipe no Abastecimento.
    void (async () => {
      try {
        const r = await registrarEntradaAlmoxarifado({ pmo, op, posto, colaborador, bipe: alvo })
        if (!r.ok) {
          // Recusado: o campo NÃO é limpo — o texto bipado fica na tela pro operador ver o que caiu.
          setResultado({ tipo: 'aviso', titulo: r.erro })
          return
        }
        const rotulo = r.quantidade === 1 ? '1 peça' : `${r.quantidade} peças`
        setResultado({
          tipo: 'ok',
          titulo: rotulo,
          // Etiqueta × contagem real: a entrada foi aceita (quem manda é a peça), mas o operador
          // precisa ver a diferença — ela era só um aviso no log do Postgres, que ninguém lê.
          detalhe: r.divergencia,
          chips: [{ rotulo: r.tipo === 'caixa' ? 'Caixa' : 'Nº Série', valor: alvo.trim(), mono: true }],
          dica: r.divergencia ? 'Confira a caixa física e avise o gestor: a diferença não deu entrada.' : undefined,
        })
        setRecentes((prev) => [{ bipe: alvo.trim(), quantidade: r.quantidade, tipo: r.tipo }, ...prev].slice(0, 30))
        setBipe('') // aceito → limpa pro próximo bipe
        // A caixa confirmada sai da lista: recarrega (fora do caminho do bipe — não espera).
        if (temOp) void carregarNecessidades()
      } finally {
        enviandoRef.current = false
        setEnviando(false)
      }
    })()
  }

  const totalSessao = recentes.reduce((soma, r) => soma + r.quantidade, 0)

  return (
    <div className="flex flex-col gap-3">
      {/* Topo: Peça | Contexto — mesmo arranjo das demais telas de bipe. */}
      <div className="grid shrink-0 gap-3 lg:grid-cols-2">
        <Card size="sm" className="flex flex-col">
          <CardHeader className="shrink-0">
            <CardTitle>Peça</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {temOp && (
              <div className="mb-2 flex flex-col rounded-lg border border-border p-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Caixas esperando confirmação
                  {necessidades.tipo === 'ok' && necessidades.itens.length > 0 ? ` (${necessidades.itens.length})` : ''}
                </p>
                {necessidades.tipo === 'carregando' && <p className="text-sm text-muted-foreground">Carregando…</p>}
                {necessidades.tipo === 'erro' && (
                  <p className="text-sm text-amber-700 dark:text-amber-400">{necessidades.erro}</p>
                )}
                {necessidades.tipo === 'ok' && necessidades.itens.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhuma caixa esperando confirmação nesta OP.</p>
                )}
                {necessidades.tipo === 'ok' && necessidades.itens.length > 0 && (
                  <ul
                    aria-label="Caixas esperando confirmação"
                    className="flex max-h-[8rem] flex-col gap-0.5 overflow-y-auto text-sm"
                  >
                    {necessidades.itens.map((n) => (
                      <li key={n.codigo} className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono">{n.codigo}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{pecas(n.pecas)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <Label htmlFor="bipeAlmoxarifado">Bipe a peça ou a caixa</Label>
            <Input
              id="bipeAlmoxarifado"
              ref={bipeRef}
              value={bipe}
              onChange={(e) => setBipe(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBipar() } }}
              placeholder="Bipe o Nº de Série ou o código da caixa"
              autoComplete="off"
              autoFocus
              className="h-12 text-lg"
              disabled={enviando}
            />
          </CardContent>
        </Card>
        {contexto}
      </div>

      {/* Acompanhamento em largura cheia: resultado grande (tela de bipe) e o rastro da sessão. */}
      <Card className="flex flex-col">
        <CardHeader className="shrink-0">
          <CardTitle>Almoxarifado</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="shrink-0">
            <PainelResultado resultado={resultado} />
          </div>

          <div className="flex flex-col rounded-lg border border-border p-2">
            <div className="mb-1 flex shrink-0 items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Entradas nesta sessão ({recentes.length})</p>
              <p className="text-xs text-muted-foreground">Total: {totalSessao}</p>
            </div>
            <ul className="flex max-h-[10rem] flex-col gap-0.5 overflow-y-auto text-sm">
              {recentes.length === 0 && <li className="text-muted-foreground">—</li>}
              {recentes.map((r, i) => (
                <li key={`${r.bipe}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono">{r.bipe}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {r.quantidade === 1 ? '1 peça' : `${r.quantidade} peças`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
