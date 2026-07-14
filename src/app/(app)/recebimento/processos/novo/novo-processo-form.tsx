'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { criarProcessoManual } from '@/modules/recebimento/application/criar-processo'
import type { CampoFormulario } from '@/modules/recebimento/infra/processo-detalhe-repository'
import { CampoControle } from '../campo-controle'

const GRUPOS: { chave: CampoFormulario['grupo']; rotulo: string }[] = [
  { chave: 'comercial', rotulo: 'Comercial' },
  { chave: 'material', rotulo: 'Material' },
]

/**
 * Formulário de criação manual de processo. Recebe apenas os campos editáveis
 * (não-calculados) de Comercial e Material. Os obrigatórios (`*`) seguem
 * `obrigatorioImportacao`. Ao criar, redireciona para o detalhe do novo
 * processo (que nasce 'aberto', pronto para conferência).
 */
export function NovoProcessoForm({
  campos,
  itensPorLista,
}: {
  campos: CampoFormulario[]
  itensPorLista: Record<string, string[]>
}) {
  const router = useRouter()
  const [valores, setValores] = useState<Record<string, string>>({})
  const [salvando, startTransition] = useTransition()

  function atualizarValor(campo: string, valor: string) {
    setValores((atual) => ({ ...atual, [campo]: valor }))
  }

  // Números vão como number (input type="number", ponto decimal) para não
  // passar pelo parser BR de `converterValor` (vírgula decimal, pensado para
  // planilha). Demais tipos vão como string e o servidor converte/valida.
  function montarPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {}
    for (const campo of campos) {
      const bruto = valores[campo.campo] ?? ''
      payload[campo.campo] = campo.tipo === 'numero' ? (bruto === '' ? null : Number(bruto)) : bruto
    }
    return payload
  }

  function onCriar() {
    startTransition(async () => {
      const r = await criarProcessoManual(montarPayload())
      if (r.ok) {
        toast.success('Processo criado.')
        router.push(`/recebimento/processos/${r.id}`)
      } else {
        toast.error(r.erro)
      }
    })
  }

  const gruposComCampos = GRUPOS.map((grupo) => ({
    ...grupo,
    campos: campos.filter((campo) => campo.grupo === grupo.chave).sort((a, b) => a.ordem - b.ordem),
  })).filter((grupo) => grupo.campos.length > 0)

  return (
    <div className="flex flex-col gap-4">
      {gruposComCampos.map((grupo) => (
        <Card key={grupo.chave}>
          <CardHeader>
            <CardTitle>{grupo.rotulo}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {grupo.campos.map((campo) => (
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
      ))}

      <div>
        <Button onClick={onCriar} disabled={salvando} className="bg-enterplak hover:bg-enterplak-700">
          {salvando ? 'Criando…' : 'Criar processo'}
        </Button>
      </div>
    </div>
  )
}
