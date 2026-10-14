import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { agruparEstoquePendente } from '@/modules/shopfloor/domain/estoque-pendente'
import { listarEstoquePendente } from '@/modules/shopfloor/infra/estoque-pendente-repository'
import { EstoquePendenteTabela } from './estoque-pendente-tabela'

export const dynamic = 'force-dynamic'

/** Quantas linhas da fila a tela traz por vez. Acima disso ela avisa que há mais. */
const LIMITE = 200

/**
 * A TELA DE PENDÊNCIAS DA FILA DE ESTOQUE — a única janela humana da fila do Compels (0132).
 *
 * Gate: `shopfloor:visualizar` para VER (o mesmo da policy de `select` da 0132, que é a segunda
 * barreira: mesmo se este `if` sumisse, o banco não devolveria linha) e `shopfloor:administrar` para
 * REENVIAR — conferido de novo dentro da Server Action, porque o botão não existir na tela não
 * impede ninguém de mandar o POST.
 */
export default async function EstoquePendentePage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver a fila de estoque do Compels." />
  }
  const podeAdministrar = podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')

  const { linhas, entradas, cortada } = await listarEstoquePendente(LIMITE)
  const grupos = agruparEstoquePendente(linhas, entradas)

  /*
    ENTRADAS E SAÍDAS CONTADAS SEPARADO, porque somar as duas é somar sentidos opostos: uma entrada
    de 3 revertida por inteiro mais o estorno de 3 dela dá "3 peças esperando" numa soma em que nada
    entra no estoque, e duas entradas de 3 com um estorno de 3 dão 9 onde há 3 a entrar e 3 a sair.
    O saldo (`quantidade - estornado`) é o que a entrada ainda vale; no estorno é a quantidade dele.
  */
  const entradasPendentes = linhas.filter((l) => l.operacao === 'entrada')
  const saidasPendentes = linhas.filter((l) => l.operacao === 'estorno')
  const pecasEntradas = entradasPendentes.reduce((soma, l) => soma + l.quantidade - l.estornado, 0)
  const pecasSaidas = saidasPendentes.reduce((soma, l) => soma + l.quantidade, 0)
  const plural = (n: number) => (n === 1 ? '' : 's')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Estoque pendente no Compels</h2>
        <p className="text-sm text-muted-foreground">
          {/*
            NADA AQUI AFIRMA QUE ALGO CHEGOU AO ERP: com o último metro inexistente, nada pode ter
            chegado, e dizer o contrário contradiria o aviso fixo logo abaixo.
          */}
          {linhas.length === 0
            ? 'Nenhuma movimentação esperando na fila.'
            : `${entradasPendentes.length} entrada${plural(entradasPendentes.length)} `
              + `(${pecasEntradas} peça${plural(pecasEntradas)}) · `
              + `${saidasPendentes.length} saída${plural(saidasPendentes.length)} `
              + `(${pecasSaidas} peça${plural(pecasSaidas)}) esperando para ir ao Compels, `
              + `em ${grupos.length} bipe${plural(grupos.length)}.`}
          {/*
            O repositório completa o par de um estorno com a entrada dele mesmo passando do LIMITE
            (o grupo do bipe vale mais que o número redondo), então a tela pode ter mais linhas que
            o limite. A frase conta o que está de fato na tela.
          */}
          {cortada
            && (linhas.length > LIMITE
              ? ` Mostrando as ${LIMITE} mais acionáveis, mais ${linhas.length - LIMITE} para completar os pares delas`
                + ' — as que precisam de alguém vêm primeiro; há mais na fila.'
              : ` Mostrando ${linhas.length} — as que precisam de alguém vêm primeiro; há mais na fila.`)}
        </p>
      </div>

      {/*
        O AVISO FIXO É REQUISITO, NÃO ENFEITE. O último metro (a chamada que fala com o Compels)
        ainda não existe — endpoint, autenticação e formato dependem do fornecedor —, então a fila
        ACUMULA E NÃO ESVAZIA, e isso é esperado. Sem esta frase, a primeira pessoa que abrir a tela
        abre um chamado dizendo que a integração quebrou.
      */}
      <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
        <p className="font-medium">
          A integração com o Compels ainda não foi configurada: as entradas ficam guardadas aqui até
          isso acontecer.
        </p>
        <p className="mt-1 text-muted-foreground">
          Nada foi perdido e nada precisa ser bipado de novo — cada linha desta tela é uma
          movimentação guardada, com a chave que o ERP vai usar. Enquanto o envio não existir, é
          normal esta lista só crescer.
        </p>
      </div>

      <EstoquePendenteTabela grupos={grupos} podeAdministrar={podeAdministrar} />
    </div>
  )
}
