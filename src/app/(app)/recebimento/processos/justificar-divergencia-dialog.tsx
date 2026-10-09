'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { salvarJustificativaDivergencia } from '@/modules/recebimento/application/justificar-divergencia'
import { LIMITE_JUSTIFICATIVA } from '@/modules/recebimento/domain/divergencia'

/**
 * De que item é a divergência, para quem justifica não precisar voltar à grade (pedido de
 * 09/10/2026). Os valores vêm **crus** das duas telas que abrem este diálogo: a grade lê a linha
 * do banco (o `numeric` do PostgREST chega como string e `divergencia` é coluna text livre, que
 * aceita '1,5' digitado à mão) e o Fluxo lê a RPC, que já converte as quantidades para número.
 * Quem formata é este arquivo — uma régua só, para as duas telas contarem a mesma história.
 */
export interface ContextoDivergencia {
  /** `codigo_material` na grade, `item` no Fluxo. */
  codigo: string
  /** `descricao_material` na grade, `descricao` no Fluxo. */
  descricao: string
  quantidadePedido: number | string | null
  quantidadeRecebida: number | string | null
  divergencia: number | string | null
}

export interface AlvoJustificativa {
  id: string
  numero: string
  /** Texto gravado hoje ('' = ninguém justificou). */
  texto: string
  /** Nome de quem escreveu por último, se conhecido. */
  autor: string
  /** ISO do último salvamento, se houver. */
  quando: string | null
  /** Obrigatório de propósito: tela nova que abra este diálogo tem de dizer de que item se trata. */
  contexto: ContextoDivergencia
}

interface Props {
  alvo: AlvoJustificativa
  /** `recebimento.administrar`. Sem isso a caixa é só leitura e não há botão de salvar. */
  podeJustificar: boolean
  onFechar: () => void
  /** Chamado depois de salvar com sucesso, com o texto exato que foi enviado. */
  onSalvo: (id: string, texto: string) => void
}

/** O que a célula da grade mostra quando não há valor. */
const VAZIO = '—'

/**
 * Mesma régua da célula da grade: separador de milhar em pt-BR e, se for negativo, vermelho.
 * O que não é número sai como veio (`divergencia` é texto livre e já recebeu valor digitado) —
 * inventar um "0" ali seria dizer que não há divergência.
 */
function Numero({ valor }: { valor: number | string | null }) {
  if (valor === null || valor === undefined || valor === '') return VAZIO
  const n = Number(valor)
  if (!Number.isFinite(n)) return String(valor)
  const texto = n.toLocaleString('pt-BR')
  return n < 0 ? <span className="font-medium text-red-600">{texto}</span> : texto
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 break-words font-medium">{children}</dd>
    </>
  )
}

/** De que item é a divergência e de quanto ela foi — o bastante para escrever a justificativa
 *  sem sair do diálogo. */
function BlocoContexto({ contexto }: { contexto: ContextoDivergencia }) {
  return (
    <dl
      role="group"
      aria-label="Contexto da divergência"
      className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
    >
      <Linha rotulo="Código do material">{contexto.codigo || VAZIO}</Linha>
      <Linha rotulo="Descrição">{contexto.descricao || VAZIO}</Linha>
      <Linha rotulo="Quantidade pedida">
        <Numero valor={contexto.quantidadePedido} />
      </Linha>
      <Linha rotulo="Quantidade recebida">
        <Numero valor={contexto.quantidadeRecebida} />
      </Linha>
      <Linha rotulo="Divergência">
        <Numero valor={contexto.divergencia} />
      </Linha>
    </dl>
  )
}

function formatarQuando(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Explicação de uma divergência de quantidade: o porquê e o que foi alinhado com o fornecedor.
 * Vazio é estado válido (= ninguém justificou) — salvar vazio apaga e o selo volta a `?`.
 */
export function JustificarDivergenciaDialog({ alvo, podeJustificar, onFechar, onSalvo }: Props) {
  const [texto, setTexto] = useState(alvo.texto)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, startSalvar] = useTransition()

  function salvar() {
    setErro(null)
    startSalvar(async () => {
      const r = await salvarJustificativaDivergencia(alvo.id, texto)
      if (r.ok) {
        onSalvo(alvo.id, texto)
        onFechar()
      } else {
        setErro(r.erro)
      }
    })
  }

  const quando = formatarQuando(alvo.quando)
  const autoria = [alvo.autor && `por ${alvo.autor}`, quando && `em ${quando}`].filter(Boolean).join(' ')

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Divergência de quantidade — processo Nº {alvo.numero}</DialogTitle>
          <DialogDescription>
            {podeJustificar
              ? 'Explique o porquê da divergência e o que foi alinhado com o fornecedor.'
              : 'Justificativa da divergência. Somente quem administra o Recebimento pode editar.'}
          </DialogDescription>
        </DialogHeader>

        <BlocoContexto contexto={alvo.contexto} />

        <div className="flex flex-col gap-1.5">
          <Textarea
            aria-label="Justificativa da divergência"
            value={texto}
            readOnly={!podeJustificar}
            maxLength={LIMITE_JUSTIFICATIVA}
            rows={6}
            placeholder={podeJustificar ? 'Escreva a justificativa…' : 'Sem justificativa.'}
            onChange={(e) => setTexto(e.target.value)}
          />
          <div className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span>{autoria ? `Última edição ${autoria}` : ''}</span>
            {podeJustificar && (
              <span>
                {[...texto].length}/{LIMITE_JUSTIFICATIVA}
              </span>
            )}
          </div>
          {erro && (
            <p role="alert" className="text-sm text-red-600">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            {podeJustificar ? 'Cancelar' : 'Fechar'}
          </Button>
          {podeJustificar && (
            <Button className="bg-enterplak hover:bg-enterplak-700" disabled={salvando} onClick={salvar}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
