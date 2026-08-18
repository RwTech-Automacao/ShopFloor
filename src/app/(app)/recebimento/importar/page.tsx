import Link from 'next/link'
import { AlertTriangleIcon } from 'lucide-react'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { Button } from '@/components/ui/button'
import {
  carregarCamposComerciais,
  carregarItensPorLista,
} from '@/modules/recebimento/infra/campo-comercial-repository'
import { listarPadroesImportacao } from '@/modules/recebimento/infra/padrao-importacao-repository'
import { carregarImportacaoCorrecao } from '@/modules/recebimento/infra/importacao-repository'
import { WizardImportacao, type CorrecaoImportacao } from './wizard-importacao'

export default async function ImportarPage({
  searchParams,
}: {
  searchParams: Promise<{ corrigir?: string }>
}) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'importar')) {
    return <SemPermissao descricao="Você não tem permissão para importar planilhas." />
  }

  const { corrigir } = await searchParams

  // Modo correção: carrega a importação-alvo e pré-checa o bloqueio.
  let correcao: CorrecaoImportacao | undefined
  if (corrigir) {
    const alvo = await carregarImportacaoCorrecao(corrigir)
    if (!alvo) {
      return (
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold">Corrigir importação</h1>
          <AvisoCorrecao>Importação não encontrada.</AvisoCorrecao>
        </div>
      )
    }
    if (alvo.totalNaoAbertos > 0) {
      return (
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold">Corrigir importação</h1>
          <AvisoCorrecao>
            Não é possível corrigir: {alvo.totalNaoAbertos} item
            {alvo.totalNaoAbertos === 1 ? '' : 's'} desta EMB já{' '}
            {alvo.totalNaoAbertos === 1 ? 'está' : 'estão'} em conferência ou finalizado
            {alvo.totalNaoAbertos === 1 ? '' : 's'}. A correção só vale antes de começar a conferir.
          </AvisoCorrecao>
        </div>
      )
    }
    correcao = {
      importacaoId: corrigir,
      emb: alvo.numeroEmb ?? '',
      totalAtual: alvo.totalProcessos,
    }
  }

  const campos = await carregarCamposComerciais()
  const chaves = Array.from(
    new Set(campos.map((campo) => campo.listaChave).filter((chave): chave is string => chave !== null)),
  )
  const itensPorLista = await carregarItensPorLista(chaves)
  const padroes = await listarPadroesImportacao()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        {correcao ? `Corrigir importação — EMB ${correcao.emb || '—'}` : 'Importar planilha'}
      </h1>
      {correcao && (
        <p className="text-sm text-muted-foreground">
          A nova planilha vai <strong>substituir</strong> os {correcao.totalAtual} processo
          {correcao.totalAtual === 1 ? '' : 's'} atuais desta EMB. A EMB fica travada.
        </p>
      )}
      <WizardImportacao
        campos={campos}
        itensPorLista={itensPorLista}
        padroes={padroes}
        correcao={correcao}
      />
    </div>
  )
}

function AvisoCorrecao({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span className="flex items-start gap-2">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
        {children}
      </span>
      <Button variant="outline" render={<Link href="/recebimento/importacoes" />}>
        Voltar às importações
      </Button>
    </div>
  )
}
