import { Cpu, Factory, Inbox, Workflow, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HISTORICO_VERSOES, VERSAO } from '@/shared/lib/versao'

type Modulo = { icone: LucideIcon; nome: string; descricao: string }

const MODULOS: Modulo[] = [
  { icone: Inbox, nome: 'Recebimento', descricao: 'Importação, processos e conferência' },
  { icone: Workflow, nome: 'Fluxo de Processos', descricao: 'Operação, análise e rastreio da produção' },
  { icone: Cpu, nome: 'Setup', descricao: 'Estrutura de componentes por PMO, montagem de setup das máquinas SMT/PTH e conferência da troca de rolos.' },
]

const INFORMACOES: { rotulo: string; valor: string }[] = [
  { rotulo: 'Sistema', valor: 'ShopFloor — Enterplak MES' },
  { rotulo: 'Versão', valor: VERSAO },
  { rotulo: 'Empresa', valor: 'Enterplak Indústria Eletrônica Ltda.' },
]

export default function SobrePage() {
  return (
    // Largura cheia, como as telas operacionais (Registros, Processos): o `<main>` do app-shell já
    // dá o respiro nas laterais. O `max-w-3xl` sem `mx-auto` que estava aqui grudava tudo na
    // esquerda e deixava um vazio à direita. Quem ganha teto agora é só o texto corrido, logo
    // abaixo — grade e lista ficam com a largura toda.
    <div className="flex flex-col gap-4">
      {/* Identidade */}
      <Card>
        <CardContent className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Factory className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">ShopFloor</h2>
              <Badge variant="secondary">v{VERSAO}</Badge>
            </div>
            {/* Teto no próprio parágrafo, como em `sem-permissao`: texto corrido esticado até a
                borda de um monitor largo vira uma linha de leitura ruim. */}
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Sistema de gestão de chão de fábrica (MES) da Enterplak — controle, registro e
              rastreio das operações de produção em um só lugar.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Informações */}
      <Card>
        <CardHeader>
          <CardTitle>Informações</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Grade: fica com a largura toda. Os três itens cabem numa linha no desktop, no mesmo
              escalonamento de colunas da Home. */}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {INFORMACOES.map((info) => (
              <div key={info.rotulo} className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {info.rotulo}
                </dt>
                <dd className="text-foreground">{info.valor}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* Módulos */}
      <Card>
        <CardHeader>
          <CardTitle>Módulos</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Três módulos, três colunas — é o mesmo desenho da Home. Mais colunas não faz sentido
              com três itens, então o espaço extra vira card maior, não coluna nova. */}
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {MODULOS.map((modulo) => (
              <li
                key={modulo.nome}
                className="flex flex-col gap-2 rounded-lg border border-border p-4"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <modulo.icone className="size-[18px]" />
                </div>
                <div>
                  <p className="text-sm font-medium">{modulo.nome}</p>
                  <p className="text-xs text-muted-foreground">{modulo.descricao}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Histórico de versões */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico de versões</CardTitle>
        </CardHeader>
        <CardContent>
          {/* A lista cresce a cada deploy e esticaria a página sem fim. Teto em rem (não em vh), no
              mesmo padrão dos quadros do Setup e do Lançamento: a caixa ocupa o mesmo espaço no
              celular e no desktop, e as primeiras entradas cabem inteiras com a seguinte aparecendo
              em parte — é o que sinaliza que há mais histórico abaixo. A lista continua completa.
              Só de ALTURA: a largura é cheia, como o resto da tela. Cada resumo é uma frase de
              changelog, não parágrafo — na largura toda a entrada cabe em uma ou duas linhas, o que
              lê melhor do que quebrar em três. O teto de leitura fica no texto corrido do cabeçalho.

              12rem foi CALIBRADO três vezes; não arredonde sem medir de novo:
                20rem  não disparava nem na largura antiga (o histórico cabia por pouco);
                16rem  disparava na largura antiga, com os resumos quebrando em 2-3 linhas;
                12rem  é o de agora — na largura cheia cada entrada encolhe para 1-2 linhas e a
                       lista inteira mede ~248px num monitor de 1920px, ou seja, 16rem deixaria de
                       disparar de novo.
              A conta: cada entrada = 16px da data (text-xs) + 20px por linha do resumo (text-sm),
              mais 12px de gap. Com as 5 entradas de hoje o PISO é 228px (todas em uma linha só, num
              monitor bem largo), então o teto tem de ficar abaixo disso — 192px deixa uma entrada
              inteira de margem. O histórico só cresce, então esse piso nunca baixa. */}
          <ol className="flex max-h-48 flex-col gap-3 overflow-y-auto text-sm">
            {HISTORICO_VERSOES.map((v) => (
              <li key={v.versao} className="flex gap-3">
                <span className="w-14 shrink-0 font-medium tabular-nums">{v.versao}</span>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground tabular-nums">{v.data}</p>
                  <p>{v.resumo}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
