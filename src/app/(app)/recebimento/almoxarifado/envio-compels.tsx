import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import {
  ROTA_ESTOQUE_PENDENTE,
  agruparEstoquePendente,
  type GrupoEstoquePendente,
  type LinhaEstoquePendente,
  type SituacaoEstoque,
} from '@/modules/shopfloor/domain/estoque-pendente'
import { listarEstoquePendente } from '@/modules/shopfloor/infra/estoque-pendente-repository'
import { AtualizarSozinho } from './atualizar-sozinho'

/** Quantos bipes o quadro lista; o resto vai para "ver a fila completa". */
const MAXIMO_NO_QUADRO = 5

const CLASSE_SITUACAO: Record<SituacaoEstoque, string> = {
  enviando: 'border-blue-500 text-blue-700 dark:text-blue-300',
  fora_da_fila: 'border-red-500 text-red-700 dark:text-red-300',
  esperando_entrada: 'border-amber-500 text-amber-700 dark:text-amber-300',
  esperando_erp: 'border-amber-500 text-amber-700 dark:text-amber-300',
  vai_tentar: 'border-amber-500 text-amber-700 dark:text-amber-300',
  na_fila: 'border-border text-muted-foreground',
}

const plural = (n: number) => (n === 1 ? '' : 's')

const formatadorHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

/**
 * A frase de baixo de cada lançamento. A da tela de Estoque pendente fala de "motivo ao lado" e do cron, porque lá
 * o motivo é outra coluna e quem lê é gestor; aqui o motivo está logo acima e quem lê é o Almoxarifado.
 */
function fraseDeEstado(l: LinhaEstoquePendente): string {
  if (l.situacao === 'na_fila' && !l.erro) return 'Aguardando a próxima rodada de envio ao Compels.'
  if (l.situacao === 'esperando_erp') {
    const quando = l.adiadoAte ? new Date(l.adiadoAte) : null
    const hora = quando && !Number.isNaN(quando.getTime()) ? formatadorHora.format(quando) : null
    return `Nada foi gravado no Compels. A integração tenta de novo sozinha${hora ? `, por volta das ${hora}` : ' em poucos minutos'}.`
  }
  return l.oQueFazer
}

/** A linha que representa o bipe na tela: a entrada (as saídas dela só existem depois de um estorno). */
function linhaDoGrupo(g: GrupoEstoquePendente) {
  return g.linhas.find((l) => l.operacao === 'entrada') ?? g.linhas[0]!
}

/**
 * O QUE AINDA NÃO CHEGOU AO COMPELS, para quem dá a entrada no Almoxarifado.
 *
 * A entrada no ShopFloor (o "✓ N peças" do cartão) e o envio ao ERP são etapas separadas: a fila
 * entrega depois, e o Compels pode recusar ou pedir espera (OP aberta por alguém, sem empenho, OP não
 * liberada). Sem este quadro a tela só mostra o primeiro passo e parece que tudo foi gravado. Usa a
 * mesma leitura da tela de Estoque pendente, então os motivos são os mesmos; some quando a fila esvazia.
 * Nunca derruba a página: se a leitura falhar, o quadro simplesmente não aparece.
 */
export async function EnvioCompels() {
  let grupos: GrupoEstoquePendente[] = []
  try {
    const { linhas, entradas } = await listarEstoquePendente(100)
    grupos = agruparEstoquePendente(linhas, entradas)
  } catch {
    return <AtualizarSozinho />
  }
  if (grupos.length === 0) return <AtualizarSozinho />

  const pecas = grupos.reduce((soma, g) => soma + linhaDoGrupo(g).saldo, 0)
  const visiveis = grupos.slice(0, MAXIMO_NO_QUADRO)

  return (
    <section
      aria-label="Envio ao Compels"
      className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40"
    >
      <AtualizarSozinho />
      <p className="font-medium">
        {grupos.length} lançamento{plural(grupos.length)} ({pecas} peça{plural(pecas)}) ainda não chegou
        {grupos.length === 1 ? '' : 'ram'} ao Compels
      </p>
      <p className="text-muted-foreground">
        A entrada aqui já está registrada no ShopFloor. O envio ao Compels é feito logo em seguida e pode esperar por um motivo, listado abaixo.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {visiveis.map((g) => {
          const l = linhaDoGrupo(g)
          return (
            <li key={g.id} className="rounded-md border border-border bg-card p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">OP {g.op}</span>
                <span className="text-muted-foreground">{g.pmo} · {l.saldo} peça{plural(l.saldo)}</span>
                <Badge variant="outline" className={CLASSE_SITUACAO[l.situacao]}>{l.rotulo}</Badge>
              </div>
              {l.erro && <p className="mt-1">Motivo: {l.erro}</p>}
              <p className="mt-1 text-muted-foreground">{fraseDeEstado(l)}</p>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-muted-foreground">
        {grupos.length > visiveis.length && `Mais ${grupos.length - visiveis.length} na fila. `}
        <Link href={ROTA_ESTOQUE_PENDENTE} className="underline">Ver a fila completa</Link>
      </p>
    </section>
  )
}
