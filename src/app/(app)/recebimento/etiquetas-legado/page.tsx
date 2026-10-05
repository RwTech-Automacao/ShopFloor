import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { resumoLegado } from '@/modules/etiquetas/infra/etiqueta-legado-repository'
import { EtiquetasLegadoCliente } from './etiquetas-legado-cliente'

/**
 * Etiquetagem do ESTOQUE LEGADO — ferramenta de mutirão (spec
 * docs/superpowers/specs/2026-09-24-etiquetas-estoque-legado-design.md).
 *
 * Roda uma vez sobre o material que entrou antes do ShopFloor e nunca ganhou etiqueta. Fica
 * separada de tudo de propósito: para ocultar a função depois, basta tirar o item "Etiquetas
 * legado" do menu (src/shared/ui/app-shell.tsx) — nada nas telas de hoje depende daqui.
 *
 * Mesma permissão das etiquetas do material novo: `recebimento: gerar_etiqueta`, aqui e em toda
 * server action.
 */

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export default async function EtiquetasLegadoPage() {
  const sessao = await getSessao()

  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'gerar_etiqueta')) {
    return <SemPermissao descricao="Você não tem permissão para gerar etiquetas." />
  }

  const resumo = await resumoLegado()

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Etiquetas do estoque legado</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Material que entrou antes do ShopFloor e nunca ganhou etiqueta. Cada linha da planilha
          &ldquo;Saldo por Locação&rdquo; do ERP é um rolo e recebe uma etiqueta no formato{' '}
          <span className="font-mono">CÓDIGO-L0001</span> — o número não reinicia: continua de onde
          a última leva daquele item parou.
        </p>
      </div>

      <p className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
        Já etiquetados: <strong className="text-foreground">{resumo.totalEtiquetas}</strong> rolo(s) de{' '}
        <strong className="text-foreground">{resumo.totalItens}</strong> item(ns)
        {resumo.ultima && ` · última geração em ${formatadorData.format(new Date(resumo.ultima))}`}
      </p>

      <EtiquetasLegadoCliente />
    </div>
  )
}
