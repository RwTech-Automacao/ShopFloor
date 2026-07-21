'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { criarProcessoManual } from '@/modules/recebimento/application/criar-processo'
import { criarProcessosColetivo } from '@/modules/recebimento/application/criar-processos-coletivo'
import type { CampoFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { CampoControle } from '../campo-controle'

type Modo = 'individual' | 'coletivo'

/** Converte os valores de um conjunto de campos em payload (número → Number). */
function montarValores(
  campos: CampoFormulario[],
  valores: Record<string, string>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const campo of campos) {
    const bruto = valores[campo.campo] ?? ''
    payload[campo.campo] = campo.tipo === 'numero' ? (bruto === '' ? null : Number(bruto)) : bruto
  }
  return payload
}

/**
 * Criação manual de processo. Individual = 1 Comercial + 1 Material (como antes).
 * Coletivo = 1 Comercial (compartilhado) + N linhas de Material (tabela); cada
 * linha vira um processo. Reusa `CampoControle` em ambos os modos.
 */
export function NovoProcessoForm({
  campos,
  itensPorLista,
}: {
  campos: CampoFormulario[]
  itensPorLista: Record<string, string[]>
}) {
  const router = useRouter()
  const [modo, setModo] = useState<Modo>('individual')
  // `valores` guarda o Comercial (e o Material no modo Individual).
  const [valores, setValores] = useState<Record<string, string>>({})
  // `linhas` guarda as linhas de Material do modo Coletivo. A "Quantidade de
  // processos" é só um contador de `linhas.length` — muda por "+ Adicionar linha"
  // e por remover (×); não é digitável (evita reduzir/perder o que já foi preenchido).
  const [linhas, setLinhas] = useState<Record<string, string>[]>([{}])
  const [salvando, startTransition] = useTransition()

  const comercialCampos = campos.filter((c) => c.grupo === 'comercial').sort((a, b) => a.ordem - b.ordem)
  const materialCampos = campos.filter((c) => c.grupo === 'material').sort((a, b) => a.ordem - b.ordem)

  function atualizarValor(campo: string, valor: string) {
    setValores((atual) => ({ ...atual, [campo]: valor }))
  }
  function atualizarLinha(i: number, campo: string, valor: string) {
    setLinhas((atual) => atual.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)))
  }
  function adicionarLinha() {
    setLinhas((atual) => (atual.length >= 200 ? atual : [...atual, {}]))
  }
  function removerLinha(i: number) {
    setLinhas((atual) => (atual.length <= 1 ? atual : atual.filter((_, idx) => idx !== i)))
  }

  function onCriar() {
    startTransition(async () => {
      if (modo === 'individual') {
        const r = await criarProcessoManual(montarValores(campos, valores))
        if (r.ok) {
          toast.success('Processo criado.')
          router.push(`/recebimento/processos/${r.id}`)
        } else {
          toast.error(r.erro)
        }
      } else {
        const comercial = montarValores(comercialCampos, valores)
        const materiais = linhas.map((l) => montarValores(materialCampos, l))
        const r = await criarProcessosColetivo(comercial, materiais)
        if (r.ok) {
          toast.success(`${r.total} processo(s) criado(s).`)
          router.push(`/recebimento/processos/${r.id}`)
        } else {
          toast.error(r.erro)
        }
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toggle Individual | Coletivo */}
      <div className="inline-flex self-start rounded-lg border border-border bg-muted p-1">
        {(['individual', 'coletivo'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModo(m)}
            className={
              modo === m
                ? 'rounded-md bg-enterplak px-5 py-1.5 text-sm font-medium text-white'
                : 'rounded-md px-5 py-1.5 text-sm font-medium text-muted-foreground hover:text-tinta'
            }
          >
            {m === 'individual' ? 'Individual' : 'Coletivo'}
          </button>
        ))}
      </div>

      {/* Comercial (sempre) */}
      <Card>
        <CardHeader>
          <CardTitle>Comercial</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {comercialCampos.map((campo) => (
              <CampoControle
                key={campo.campo}
                campo={campo}
                valor={valores[campo.campo] ?? ''}
                valorCalculado={undefined}
                itens={campo.listaChave ? (itensPorLista[campo.listaChave] ?? []) : []}
                somenteLeitura={false}
                obrigatorio={campo.obrigatorioImportacao}
                onChange={(valor) => atualizarValor(campo.campo, valor)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Material — Individual: card de campos; Coletivo: tabela de N linhas */}
      {modo === 'individual' ? (
        <Card>
          <CardHeader>
            <CardTitle>Material</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {materialCampos.map((campo) => (
                <CampoControle
                  key={campo.campo}
                  campo={campo}
                  valor={valores[campo.campo] ?? ''}
                  valorCalculado={undefined}
                  itens={campo.listaChave ? (itensPorLista[campo.listaChave] ?? []) : []}
                  somenteLeitura={false}
                  obrigatorio={campo.obrigatorioImportacao}
                  onChange={(valor) => atualizarValor(campo.campo, valor)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>
              Material <span className="text-sm font-normal text-muted-foreground">· cada linha vira um processo</span>
            </CardTitle>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              Quantidade de processos
              <span className="flex h-9 min-w-9 items-center justify-center rounded-lg border border-input bg-muted px-2 text-sm font-medium text-foreground">
                {linhas.length}
              </span>
            </span>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-8 pb-2"></th>
                  {materialCampos.map((c) => (
                    <th key={c.campo} className="px-2 pb-2 font-medium">
                      {c.rotulo}
                    </th>
                  ))}
                  <th className="w-8 pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha, i) => (
                  <tr key={i}>
                    <td className="pr-2 align-middle text-sm font-medium text-enterplak">{i + 1}</td>
                    {materialCampos.map((campo) => (
                      <td key={campo.campo} className="px-2 py-1 align-top">
                        <CampoControle
                          campo={campo}
                          valor={linha[campo.campo] ?? ''}
                          valorCalculado={undefined}
                          itens={campo.listaChave ? (itensPorLista[campo.listaChave] ?? []) : []}
                          somenteLeitura={false}
                          obrigatorio={false}
                          mostrarRotulo={false}
                          onChange={(valor) => atualizarLinha(i, campo.campo, valor)}
                        />
                      </td>
                    ))}
                    <td className="py-1 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => removerLinha(i)}
                        disabled={linhas.length <= 1}
                        aria-label={`Remover linha ${i + 1}`}
                        className="text-lg leading-none text-muted-foreground hover:text-red-600 disabled:opacity-30"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              onClick={adicionarLinha}
              className="mt-3 w-full rounded-lg border border-dashed border-border py-2 text-sm font-medium text-enterplak hover:bg-muted"
            >
              + Adicionar linha
            </button>
          </CardContent>
        </Card>
      )}

      <div>
        <Button onClick={onCriar} disabled={salvando} className="bg-enterplak hover:bg-enterplak-700">
          {salvando
            ? 'Criando…'
            : modo === 'individual'
              ? 'Criar processo'
              : `Criar ${linhas.length} processo(s)`}
        </Button>
      </div>
    </div>
  )
}
