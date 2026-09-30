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
 */
export default async function EtiquetarRoloPage() {
  const sessao = await getSessao()

  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'gerar_etiqueta')) {
    return <SemPermissao descricao="Você não tem permissão para gerar etiquetas." />
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
