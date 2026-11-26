'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  adicionarDefeitoAction, adicionarPecaAction, enviarQualidadeAction, iniciarManutencaoAction, removerDefeitoAction,
  removerPecaAction, salvarLaudoAction, trocarNsAction, type ResultadoAcao,
} from '@/modules/sat/application/ordens-actions'
import { MAX_LAUDO, MAX_SOLUCAO, type Etapa, type TipoOrdem } from '@/modules/sat/domain/ordem'
import type { DefeitoDaOrdem, DefeitoSat, PecaDaOrdem } from '@/modules/sat/infra/ordens-repository'
import { Secao } from '../../blocos'
import { SeletorPecas } from './seletor-pecas'

export interface ManutencaoProps {
  ordemId: string
  etapa: Etapa
  tipo: TipoOrdem | null
  podeManutencao: boolean
  defeitos: DefeitoDaOrdem[]
  pecas: PecaDaOrdem[]
  laudo: string
  defeitosAtivos: DefeitoSat[]
}

const qtd = (n: number) => String(n).replace('.', ',')

/**
 * A manutenção dentro da ficha da OS. Com sat.manutencao: "Iniciar manutenção" (disponível) e, em manutenção,
 * defeitos (lista + solução), peças (4 camadas), laudo, troca de NS e "Enviar para a qualidade". Sem a permissão
 * (ou em outra etapa), só leitura. O banco confere permissão e etapa de novo.
 */
export function Manutencao({ ordemId, etapa, tipo, podeManutencao, defeitos, pecas, laudo, defeitosAtivos }: ManutencaoProps) {
  const router = useRouter()
  const [pendente, iniciar] = useTransition()
  const [defeitoId, setDefeitoId] = useState('')
  const [solucao, setSolucao] = useState('')
  const [codigo, setCodigo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [quantidade, setQuantidade] = useState('1')
  const [textoLaudo, setTextoLaudo] = useState(laudo)
  const [nsNovo, setNsNovo] = useState('')
  const editando = podeManutencao && etapa === 'em_manutencao'

  const executar = (acao: () => Promise<ResultadoAcao<null>>, sucesso: string, depois?: () => void) => iniciar(async () => {
    const r = await acao()
    if (!r.ok) { toast.error(r.erro); return }
    toast.success(sucesso)
    depois?.()
    router.refresh()
  })

  return (
    <Secao titulo="Manutenção">
      {podeManutencao && etapa === 'disponivel' && (
        <div>
          <Button onClick={() => executar(() => iniciarManutencaoAction(ordemId), 'Manutenção iniciada.')} disabled={pendente}>
            Iniciar manutenção
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Defeitos encontrados</span>
        {defeitos.length === 0 && <span className="text-sm text-muted-foreground">Nenhum.</span>}
        <ul className="flex flex-col gap-1 text-sm">
          {defeitos.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3">
              <span className="font-medium">{d.descricao}</span>
              <span>{d.solucao}</span>
              {d.origem === 'qualidade' && <span className="text-xs text-muted-foreground">(qualidade)</span>}
              {editando && d.origem === 'manutencao' && (
                <Button variant="ghost" size="sm" disabled={pendente}
                  onClick={() => executar(() => removerDefeitoAction(ordemId, d.id), 'Defeito removido.')}>Remover</Button>
              )}
            </li>
          ))}
        </ul>
        {editando && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <select aria-label="Defeito" value={defeitoId} onChange={(e) => setDefeitoId(e.target.value)}
              className="h-9 rounded-md border bg-transparent px-2 text-sm">
              <option value="">Escolha o defeito</option>
              {defeitosAtivos.map((d) => <option key={d.id} value={d.id}>{d.descricao}</option>)}
            </select>
            <Input aria-label="Solução" placeholder="Solução" value={solucao} maxLength={MAX_SOLUCAO} onChange={(e) => setSolucao(e.target.value)} />
            <Button disabled={pendente} onClick={() => executar(() => adicionarDefeitoAction(ordemId, defeitoId, solucao), 'Defeito lançado.',
              () => { setDefeitoId(''); setSolucao('') })}>Lançar defeito</Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Peças trocadas</span>
        {pecas.length === 0 && <span className="text-sm text-muted-foreground">Nenhuma.</span>}
        <ul className="flex flex-col gap-1 text-sm">
          {pecas.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3">
              <span className="font-mono">{qtd(p.quantidade)} × {p.codigo}</span>
              <span>{p.descricao}</span>
              {p.situacao === 'devolvida' && <span className="text-xs text-muted-foreground">(devolvida)</span>}
              {editando && p.situacao === 'trocada' && (
                <Button variant="ghost" size="sm" disabled={pendente}
                  onClick={() => executar(() => removerPecaAction(ordemId, p.id), 'Peça removida.')}>Remover</Button>
              )}
            </li>
          ))}
        </ul>
        {editando && (
          <>
            <SeletorPecas ordemId={ordemId} onEscolher={(p) => { setCodigo(p.codigo); setDescricao(p.descricao) }} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_6rem_auto]">
              <Input aria-label="Código do item" placeholder="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
              <Input aria-label="Descrição do item" placeholder="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
              <Input aria-label="Quantidade" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
              <Button disabled={pendente} onClick={() => executar(() => adicionarPecaAction(ordemId, { codigo, descricao, quantidade }),
                'Peça lançada.', () => { setCodigo(''); setDescricao(''); setQuantidade('1') })}>Lançar peça</Button>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Laudo</span>
        {editando ? (
          <>
            <Textarea aria-label="Laudo" value={textoLaudo} maxLength={MAX_LAUDO} onChange={(e) => setTextoLaudo(e.target.value)} />
            <div><Button variant="outline" disabled={pendente}
              onClick={() => executar(() => salvarLaudoAction(ordemId, textoLaudo), 'Laudo salvo.')}>Salvar laudo</Button></div>
          </>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{laudo || '—'}</p>
        )}
      </div>

      {editando && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Troca de número de série</span>
          <div className="flex gap-2">
            <Input aria-label="Número de série novo" placeholder="NS novo" value={nsNovo} onChange={(e) => setNsNovo(e.target.value)} />
            <Button variant="outline" disabled={pendente}
              onClick={() => executar(() => trocarNsAction(ordemId, nsNovo), 'Número de série trocado.', () => setNsNovo(''))}>Trocar NS</Button>
          </div>
        </div>
      )}

      {editando && (
        <div className="flex flex-col gap-1 border-t pt-2">
          {tipo === null && (
            <p className="text-sm text-amber-800">A planilha ainda não diz se esta OS é garantia: confira o ticket do suporte antes de enviar.</p>
          )}
          {tipo !== null && defeitos.length === 0 && <p className="text-sm text-amber-800">Falta lançar ao menos um defeito.</p>}
          {tipo !== null && !laudo.trim() && <p className="text-sm text-amber-800">Falta salvar o laudo.</p>}
          <div><Button disabled={pendente}
            onClick={() => executar(() => enviarQualidadeAction(ordemId), 'Enviada para a qualidade.')}>Enviar para a qualidade</Button></div>
        </div>
      )}
    </Secao>
  )
}
