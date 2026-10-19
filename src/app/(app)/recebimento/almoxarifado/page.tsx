import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarOrdensParaLancamento } from '@/modules/shopfloor/infra/lancamento-repository'
import { mapaPostoPerfil, mapaPostoColetivo, mapaPostoRotaDestino } from '@/modules/shopfloor/infra/postos-repository'
import { LancamentoForm } from '@/app/(app)/shopfloor/operar/lancamento/lancamento-form'

/**
 * Almoxarifado: entrada de produto acabado no estoque (bipe da peça ou da caixa). Tela PRÓPRIA do
 * módulo Recebimento — saiu do Lançamento do ShopFloor em 19/10/2026 — com a mesma lógica dele
 * (cabeçalho carregado pelo primeiro bipe, Contexto, painel de resultado, as mesmas recusas): é o
 * mesmo formulário, em "modo Almoxarifado", com o posto fixo e o colaborador vindo do usuário logado.
 *
 * Permissão: `recebimento.lancar`. Além dela, o perfil precisa de `shopfloor.visualizar`: as OPs e os
 * postos que a tela lê continuam protegidos por essa permissão no banco.
 */
export default async function AlmoxarifadoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para dar entrada no Almoxarifado." />
  }
  if (!podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return (
      <SemPermissao descricao="Esta tela lê as OPs do ShopFloor: o seu perfil precisa também da permissão de visualizar no Fluxo de Processos." />
    )
  }

  const [ordens, postosPerfil, postosColetivo, postosRotaDestino] = await Promise.all([
    listarOrdensParaLancamento(),
    mapaPostoPerfil(),
    mapaPostoColetivo(),
    mapaPostoRotaDestino(),
  ])

  const postosAlmoxarifado = Object.entries(postosPerfil)
    .filter(([, perfil]) => perfil.recurso === 'almoxarifado')
    .map(([nome]) => nome)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))

  if (postosAlmoxarifado.length === 0) {
    return (
      <div className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950/40">
        <p className="font-medium">Não há posto com o perfil Almoxarifado cadastrado.</p>
        <p className="mt-1 text-muted-foreground">
          Peça a um administrador do ShopFloor para cadastrar o posto (Cadastrar Posto, perfil Almoxarifado) e
          incluí-lo na rota das OPs.
        </p>
      </div>
    )
  }
  const posto = postosAlmoxarifado[0]!

  return (
    <div className="flex flex-col gap-4">
      {postosAlmoxarifado.length > 1 && (
        <p className="text-sm text-muted-foreground">
          Há {postosAlmoxarifado.length} postos com o perfil Almoxarifado; esta tela usa &quot;{posto}&quot;.
        </p>
      )}
      <LancamentoForm
        // Só as OPs que têm o posto na rota: o bipe do cabeçalho não carrega OP que não passa por aqui.
        ordens={ordens.filter((o) => o.postos.includes(posto))}
        defeitos={[]}
        postosPerfil={postosPerfil}
        postosColetivo={postosColetivo}
        postosRotaDestino={[...postosRotaDestino]} // array: Set não é serializável servidor→cliente
        modoAlmoxarifado={{ colaborador: sessao.nome, posto }}
      />
    </div>
  )
}
