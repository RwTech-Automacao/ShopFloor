import { Fragment } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  TETO_TENTATIVAS,
  type GrupoEstoquePendente,
  type LinhaEstoquePendente,
  type SituacaoEstoque,
} from '@/modules/shopfloor/domain/estoque-pendente'
import { ReenviarBotao } from './reenviar-botao'

// Fuso fixo de Brasília (os timestamps vêm em UTC; a tela renderiza no servidor em UTC) — o mesmo
// formatador da tela de Cancelamentos.
const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'America/Sao_Paulo',
})
function formatarDataHora(valor: string): string {
  const d = new Date(valor)
  return Number.isNaN(d.getTime()) ? '—' : formatadorData.format(d)
}

/** Verde não aparece aqui de propósito: nada nesta tela chegou ao ERP. */
const CLASSE_SITUACAO: Record<SituacaoEstoque, string> = {
  enviando: 'border-blue-500 text-blue-700 dark:text-blue-300',
  fora_da_fila: 'border-red-500 text-red-700 dark:text-red-300',
  esperando_entrada: 'border-amber-500 text-amber-700 dark:text-amber-300',
  esperando_erp: 'border-amber-500 text-amber-700 dark:text-amber-300',
  vai_tentar: 'border-amber-500 text-amber-700 dark:text-amber-300',
  na_fila: 'border-border text-muted-foreground',
}

const COLUNAS = 7

/**
 * O QUE ESTA MOVIMENTAÇÃO VALE HOJE. Na entrada é o SALDO (`quantidade - estornado`): uma entrada de
 * 3 com 2 já estornados vale 1 peça, e mostrar só a quantidade faz o gestor ler 3 onde há 1. A conta
 * fica visível embaixo justamente para ele não precisar acreditar no número.
 */
function Pecas({ linha }: { linha: LinhaEstoquePendente }) {
  const revertida = linha.operacao === 'entrada' && linha.estornado > 0
  return (
    <div className="whitespace-nowrap">
      <span className={revertida ? 'font-semibold' : ''}>{linha.saldo}</span>
      {revertida && (
        <span className="block text-xs text-muted-foreground">
          {linha.quantidade} bipadas − {linha.estornado} já estornadas
        </span>
      )}
    </div>
  )
}

function LinhaDaFila({
  linha,
  podeAdministrar,
}: {
  linha: LinhaEstoquePendente
  podeAdministrar: boolean
}) {
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatarDataHora(linha.criadoEm)}
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={linha.operacao === 'estorno' ? 'border-purple-500 text-purple-700 dark:text-purple-300' : ''}
        >
          {linha.operacao === 'estorno' ? 'Saída (estorno)' : 'Entrada'}
        </Badge>
        {/* A chave é o que viaja ao ERP: é por ela que alguém reconcilia uma divergência de estoque. */}
        <span className="mt-1 block font-mono text-xs text-muted-foreground">{linha.chave}</span>
      </TableCell>
      <TableCell>
        <Pecas linha={linha} />
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={CLASSE_SITUACAO[linha.situacao]}>
          {linha.rotulo}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {linha.tentativas} de {TETO_TENTATIVAS}
      </TableCell>
      <TableCell className="min-w-[18rem] max-w-[34rem] whitespace-normal text-sm">
        {/*
          O MOTIVO DO ÚLTIMO ERRO É OBRIGATÓRIO NA LINHA: "falhou" não serve para quem abre a tela às
          7h. Quando não há erro, o texto diz POR QUE não há — uma linha nunca tentada e uma linha
          retida de propósito são coisas diferentes, e as duas têm `erro` nulo.
        */}
        {linha.erro
          ? <p className="break-words text-red-700 dark:text-red-300">{linha.erro}</p>
          : (
            <p className="text-muted-foreground">
              {linha.situacao === 'esperando_entrada'
                ? 'Sem erro: esta linha não falhou — está retida de propósito, esperando a entrada.'
                : 'Sem erro registrado — esta linha ainda não foi tentada.'}
            </p>
          )}
        <p className="mt-1 break-words text-xs text-muted-foreground">{linha.oQueFazer}</p>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {linha.podeReenviar && podeAdministrar
          ? <ReenviarBotao id={linha.id} chave={linha.chave} />
          : <span className="text-xs text-muted-foreground">—</span>}
      </TableCell>
    </TableRow>
  )
}

/**
 * A fila, agrupada POR BIPE. O agrupamento não é estética: uma entrada que estourou o teto segura o
 * estorno dela para sempre (a `sf_estoque_reservar` não entrega estorno antes de a entrada estar
 * `ok`), e só um Reenviar humano NA ENTRADA destrava os dois — então os dois têm de estar à vista um
 * do outro, senão a instrução "reenvie a entrada" não tem onde ser cumprida.
 *
 * Tablet: a tabela rola na horizontal dentro da moldura, como nas outras telas de Análise.
 */
export function EstoquePendenteTabela({
  grupos,
  podeAdministrar,
}: {
  grupos: GrupoEstoquePendente[]
  podeAdministrar: boolean
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {/*
              "Entrou na fila", e não "Bipado em": na linha de ESTORNO o `criado_em` é a hora do
              CANCELAMENTO, não a do bipe. O rótulo neutro é verdade nas duas linhas.
            */}
            <TableHead>Entrou na fila</TableHead>
            <TableHead>Movimentação</TableHead>
            <TableHead>Peças</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Tentativas</TableHead>
            <TableHead>Último erro e o que fazer</TableHead>
            <TableHead>Ação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grupos.length === 0 && (
            <TableRow>
              <TableCell colSpan={COLUNAS} className="py-8 text-center text-muted-foreground">
                Nenhuma movimentação esperando na fila.
              </TableCell>
            </TableRow>
          )}
          {grupos.map((g) => (
            // Um fragmento por bipe: a linha de cabeçalho do grupo e as movimentações dele.
            <Fragment key={g.id}>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={COLUNAS} className="py-2 text-sm font-medium">
                  {g.pmo}·{g.op} · {g.posto} ·{' '}
                  <span className="font-mono">{g.alvo}</span>
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({g.tipo === 'caixa' ? 'caixa' : 'peça'}
                    {g.linhas.length > 1 ? ` · ${g.linhas.length} movimentações deste bipe` : ''})
                  </span>
                </TableCell>
              </TableRow>
              {g.linhas.map((l) => (
                <LinhaDaFila key={l.id} linha={l} podeAdministrar={podeAdministrar} />
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
