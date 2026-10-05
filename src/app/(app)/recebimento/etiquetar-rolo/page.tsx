import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { EtiquetarRoloCliente } from './etiquetar-rolo-cliente'

/**
 * ETIQUETAGEM JUNTO AO INVENTÁRIO ROTATIVO (spec de 30/09/2026, migração 0135).
 *
 * O material que entrou antes do ShopFloor existir está na prateleira sem etiqueta e por isso não
 * pode ser bipado na montagem. A etiqueta nasce no gesto da recontagem: o almoxarife já está com o
 * rolo na mão, lê o que está escrito nele e digita — um rolo por vez, com o tablet na mão. No fim
 * do turno ele baixa um arquivo com tudo o que ainda não foi impresso.
 *
 * Esta tela substitui no menu a etiquetagem por planilha (`/recebimento/etiquetas-legado`), que
 * continua de pé na rota: recontar rolo a rolo é o que o almoxarife realmente faz, e a planilha do
 * ERP só serviria para conferir o saldo depois.
 *
 * Mesma permissão de todas as etiquetas: `recebimento: gerar_etiqueta`, aqui e em toda server
 * action (e também nas funções do banco, que exigem a permissão por conta própria).
 *
 * E TAMBÉM `visualizar`, porque aqui etiquetar e ler são a mesma tarefa. As permissões são caixas
 * independentes (não há herança em `podeNoModulo`), então o perfil com `gerar_etiqueta` e sem
 * `visualizar` é criável — e para ele esta tela era pior que um erro: a policy de leitura da 0126
 * exige `visualizar`, RLS negando um `select` devolve ZERO LINHAS (não erro), então ele etiquetava
 * dezenas de rolos com a tela dizendo "nada esperando impressão", cada linha voltava sem id
 * ("atualize a lista para poder remover") e o botão do arquivo respondia "não há nada esperando
 * impressão" com tudo na tela — sem arquivo, sem saída e com os números já queimados.
 */
export default async function EtiquetarRoloPage() {
  const sessao = await getSessao()

  const podeEtiquetar =
    !!sessao &&
    podeNoModulo(sessao.perfil, 'recebimento', 'gerar_etiqueta') &&
    podeNoModulo(sessao.perfil, 'recebimento', 'visualizar')

  if (!podeEtiquetar) {
    return (
      <SemPermissao descricao="Você não tem permissão para gerar etiquetas. Etiquetar rolo exige também poder visualizar o Recebimento — é a lista de etiquetas esperando impressão que a tela precisa ler." />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Etiquetar rolo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Para o material antigo, que nunca ganhou etiqueta. Com o rolo na mão, digite o código do
          componente e — quando o rolo tem — o número do pedido escrito nele. O código sai no
          formato <span className="font-mono">CÓDIGO-pedidoL0001</span>, e o número nunca reinicia:
          continua de onde o último rolo daquele componente parou.
        </p>
      </div>

      <EtiquetarRoloCliente />
    </div>
  )
}
