'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { carregarResumoDefeitos } from '@/modules/shopfloor/application/pesquisa-actions'
import { capitalizarDescricaoDefeito, separarCodigoDefeito } from '@/modules/shopfloor/domain/defeito'

/** Cards por página do catálogo. Encaixa em 4 colunas × 3 linhas na largura de um tablet. */
const POR_PAGINA = 12
/** Quantos "mais usados" ficam em destaque no topo. */
const FAVORITOS = 5

/** Tira acento e caixa — procurar "solda fria" tem que achar "SOLDA FRIA" e "Solda Fría". */
const chave = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Escolha do defeito por MODAL, no lugar da lista suspensa.
 *
 * A lista suspensa obrigava a saber o código (ou reconhecê-lo numa lista longa e sem hierarquia).
 * Aqui o que a OP mais produz aparece primeiro — na prática, o operador resolve em um toque — e o
 * catálogo inteiro fica atrás de busca e paginação, em cards grandes o bastante pra dedo em tablet.
 *
 * O catálogo vem por prop (já está na memória da tela), então busca e paginação são locais: sem
 * espera de rede a cada tecla. Só os "mais usados" vêm do banco, porque dependem do que aconteceu
 * nesta OP.
 */
export function DefeitoModal({
  aberto, pmo, op, posto, catalogo, onEscolher, onFechar,
}: {
  aberto: boolean
  pmo: string
  op: string
  posto: string
  catalogo: { codigo: string; tipo: number }[]
  onEscolher: (codigo: string) => void
  onFechar: () => void
}) {
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(0)
  const [maisUsados, setMaisUsados] = useState<string[]>([])
  const [, start] = useTransition()

  // Ao abrir: zera busca/página e busca o ranking da OP. Sem o reset, o modal reabriria na página 3
  // com a busca do bipe anterior — e a pessoa acharia que o catálogo encolheu.
  useEffect(() => {
    if (!aberto) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset ao abrir
    setBusca(''); setPagina(0)
    if (!pmo || !op) return
    start(async () => {
      const r = await carregarResumoDefeitos(pmo, op, posto)
      // Falha aqui não atrapalha: sem os favoritos, o catálogo completo continua servindo.
      if (r.ok) setMaisUsados(r.resumo.slice(0, FAVORITOS).map((d) => d.codigo))
    })
  }, [aberto, pmo, op, posto])

  const filtrados = useMemo(() => {
    const q = chave(busca)
    if (q === '') return catalogo
    return catalogo.filter((d) => chave(d.codigo).includes(q))
  }, [catalogo, busca])

  // Os favoritos saem da lista de baixo enquanto não há busca: repetir o mesmo card em duas seções
  // faz a pessoa duvidar se são o mesmo defeito.
  const emDestaque = useMemo(
    () => (busca.trim() === '' ? maisUsados.filter((c) => catalogo.some((d) => d.codigo === c)) : []),
    [busca, maisUsados, catalogo],
  )
  const restante = useMemo(
    () => filtrados.filter((d) => !emDestaque.includes(d.codigo)),
    [filtrados, emDestaque],
  )

  const totalPaginas = Math.max(1, Math.ceil(restante.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas - 1)
  const visiveis = restante.slice(paginaAtual * POR_PAGINA, paginaAtual * POR_PAGINA + POR_PAGINA)

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Escolher defeito</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setPagina(0) }}
            placeholder="Buscar por código ou descrição"
            className="h-11 pl-9"
            autoFocus
          />
        </div>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {emDestaque.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Mais usados nesta OP
              </p>
              <Grade codigos={emDestaque} destaque onEscolher={onEscolher} />
            </section>
          )}

          <section className="flex flex-col gap-2">
            {emDestaque.length > 0 && (
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Todos os defeitos
              </p>
            )}
            {visiveis.length === 0
              ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhum defeito encontrado.</p>
              : <Grade codigos={visiveis.map((d) => d.codigo)} onEscolher={onEscolher} />}
          </section>
        </div>

        {totalPaginas > 1 && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {restante.length} defeitos · página {paginaAtual + 1} de {totalPaginas}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={paginaAtual === 0}
                onClick={() => setPagina((p) => Math.max(0, p - 1))}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={paginaAtual + 1 >= totalPaginas}
                onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Grade de cards quadrados. Alvo grande: a tela é operada de dedo, em tablet, com luva às vezes. */
function Grade({ codigos, destaque = false, onEscolher }: {
  codigos: string[]; destaque?: boolean; onEscolher: (codigo: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {codigos.map((codigo) => {
        const { numero, descricao } = separarCodigoDefeito(codigo)
        return (
          <button
            key={codigo}
            type="button"
            onClick={() => onEscolher(codigo)}
            title={codigo}
            className={`flex aspect-square flex-col justify-between rounded-xl border p-3 text-left transition-colors ${
              destaque
                ? 'border-enterplak/40 bg-enterplak/5 hover:bg-enterplak/10'
                : 'border-border bg-card hover:bg-accent'
            }`}
          >
            <span className="line-clamp-4 text-sm font-medium leading-snug text-foreground">
              {capitalizarDescricaoDefeito(descricao) || codigo}
            </span>
            {numero && <span className="text-xs text-muted-foreground">Cod.: {numero}</span>}
          </button>
        )
      })}
    </div>
  )
}
