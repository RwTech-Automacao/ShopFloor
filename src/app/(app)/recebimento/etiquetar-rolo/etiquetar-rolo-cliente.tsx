'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DownloadIcon, RefreshCwIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  baixarDeNovoAction,
  etiquetarRoloAction,
  gerarCsvPendentesAction,
  listarImpressasAction,
  listarPendentesAction,
  removerPendenteAction,
} from '@/modules/etiquetas/application/etiquetar-rolo'
import {
  LIMITE_LINHAS_LEGADO,
  type RoloEtiquetado,
} from '@/modules/etiquetas/domain/partnumber-legado'

/**
 * A tela da etiquetagem junto ao inventário rotativo — a única parte que o almoxarife vê.
 *
 * Tela de DIGITAÇÃO com o tablet na mão, não de bipe: o resultado de cada ação sai em `toast`
 * (`Toaster` global em `bottom-center`), como nas telas de gestor. O painel fixo grande é dos
 * postos que bipam, onde a pessoa está a um metro do monitor.
 */

/** O período começa com o dia de hoje: 2ª via é quase sempre da etiqueta que rasgou agora. */
const HOJE_EM_BRASILIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })

const formatadorDataHora = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

function hojeISO(): string {
  return HOJE_EM_BRASILIA.format(new Date())
}

/** Igual ao da etiquetagem por planilha: o CSV é montado no servidor e baixado aqui. */
function dispararDownload(csv: string, fileName: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function EtiquetarRoloCliente() {
  const [aba, setAba] = useState<'etiquetar' | 'impressas'>('etiquetar')

  const codigoRef = useRef<HTMLInputElement>(null)
  const [codigo, setCodigo] = useState('')
  const [pedido, setPedido] = useState('')
  const [pendentes, setPendentes] = useState<RoloEtiquetado[]>([])
  const [cortada, setCortada] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const [desde, setDesde] = useState(hojeISO)
  const [ate, setAte] = useState(hojeISO)
  const [impressas, setImpressas] = useState<RoloEtiquetado[]>([])
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [ocupadoVia, setOcupadoVia] = useState(false)

  const noTeto = selecionadas.size >= LIMITE_LINHAS_LEGADO

  /** A lista de pendentes vem do banco, sempre: é ela que traz os ids que o remover usa. */
  const recarregar = useCallback(async () => {
    const r = await listarPendentesAction()
    if (!r.ok) {
      toast.error(r.erro)
      return
    }
    setPendentes(r.linhas)
    setCortada(r.cortada)
  }, [])

  // Carga inicial da lista. O setState só acontece depois do await, quando a resposta do servidor
  // chega — nunca durante o render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState pós-await, fora do render
    void recarregar()
  }, [recarregar])

  async function adicionar() {
    if (ocupado) return // trava síncrona: Enter repetido não emite duas etiquetas
    setOcupado(true)
    try {
      const r = await etiquetarRoloAction(codigo, pedido)
      if (!r.ok) {
        toast.error(r.erro) // NÃO limpa nada: ele corrige o que digitou
        return
      }
      setPendentes((atual) => [r.linha, ...atual])
      setCodigo('') // o código limpa...
      codigoRef.current?.focus() // ...e recebe o foco para o próximo rolo
      // o PEDIDO fica: vêm vários rolos seguidos do mesmo pedido
      toast.success(`Etiqueta ${r.linha.codigo} gerada.`)
    } finally {
      setOcupado(false)
    }
  }

  async function remover(linha: RoloEtiquetado) {
    if (ocupado) return
    setOcupado(true)
    try {
      const r = await removerPendenteAction(linha.id)
      if (!r.ok) {
        toast.error(r.erro)
        // A recusa quase sempre é "essa linha já não é pendente": a lista do banco é que manda.
        await recarregar()
        return
      }
      setPendentes((atual) => atual.filter((l) => l.id !== linha.id))
      toast.success(
        `Etiqueta ${linha.codigo} removida. O número dela fica queimado — o próximo rolo desse componente pega o seguinte.`,
      )
    } finally {
      setOcupado(false)
    }
  }

  async function baixarArquivo() {
    if (ocupado) return
    setOcupado(true)
    try {
      const r = await gerarCsvPendentesAction()
      if (!r.ok) {
        toast.error(r.erro)
        return
      }
      dispararDownload(r.csv, r.fileName)
      toast.success(
        `Arquivo ${r.fileName} baixado com ${r.quantidade} etiqueta(s). Imprima e cole cada etiqueta no rolo do código dela.`,
      )
      // O aviso sai INTEIRO e sem prazo para desaparecer: ele pode juntar duas frases (alguém
      // baixou ou removeu junto · a leva foi cortada em 1.000) e CADA UMA diz o que fazer. Cortar
      // uma delas tiraria do almoxarife a informação que evita colar o mesmo código em dois rolos.
      if (r.aviso) toast.warning(r.aviso, { duration: Infinity })
      await recarregar()
    } finally {
      setOcupado(false)
    }
  }

  async function buscarImpressas() {
    if (ocupadoVia) return
    setOcupadoVia(true)
    try {
      const r = await listarImpressasAction(desde, ate)
      if (!r.ok) {
        toast.error(r.erro)
        return
      }
      setImpressas(r.linhas)
      setSelecionadas(new Set())
      if (r.linhas.length === 0) {
        toast.info('Nenhuma etiqueta impressa nesse período. Confira as datas e busque de novo.')
      }
    } finally {
      setOcupadoVia(false)
    }
  }

  /**
   * O teto de 1.000 é fechado AQUI, na marcação.
   *
   * Passar de 1.000 ids faz a 2ª via falhar com uma mensagem que não chega ao usuário (o
   * tratamento de erro não reconhece aquele código e mostra o genérico "chame o desenvolvedor"), e
   * tentar de novo falha igual. Então a tela nem deixa marcar a 1.001ª: ele descobre o limite
   * antes de apertar, com a instrução do que fazer, em vez de depois.
   */
  function alternar(id: string, marcado: boolean) {
    if (marcado && noTeto) {
      toast.warning(
        `O arquivo de 2ª via sai com até ${LIMITE_LINHAS_LEGADO} etiquetas por vez. Baixe estas ${LIMITE_LINHAS_LEGADO}, limpe a seleção e siga com o resto.`,
      )
      return
    }
    setSelecionadas((atual) => {
      const proximo = new Set(atual)
      if (marcado) proximo.add(id)
      else proximo.delete(id)
      return proximo
    })
  }

  function marcarTodas() {
    const cabem = impressas.slice(0, LIMITE_LINHAS_LEGADO)
    setSelecionadas(new Set(cabem.map((l) => l.id)))
    if (impressas.length > cabem.length) {
      toast.warning(
        `Marquei as ${cabem.length} primeiras: o arquivo de 2ª via sai com até ${LIMITE_LINHAS_LEGADO} etiquetas por vez. Baixe esta leva, limpe a seleção e siga com o resto.`,
      )
    }
  }

  async function baixar2aVia() {
    if (ocupadoVia) return
    // A ordem é a da lista, não a dos cliques: as etiquetas saem do arquivo na ordem em que ele as
    // lê, e é nessa ordem que quem cola vai achá-las.
    const ids = impressas.filter((l) => selecionadas.has(l.id)).map((l) => l.id)
    if (ids.length === 0) {
      toast.error('Marque as etiquetas que você quer baixar de novo.')
      return
    }
    setOcupadoVia(true)
    try {
      const r = await baixarDeNovoAction(ids)
      if (!r.ok) {
        toast.error(r.erro)
        return
      }
      dispararDownload(r.csv, r.fileName)
      toast.success(
        `2ª via de ${ids.length} etiqueta(s) baixada. É o MESMO código de antes: ele não é gerado de novo.`,
      )
    } finally {
      setOcupadoVia(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-1 border-b border-border">
        <Aba rotulo="Etiquetar rolo" ativa={aba === 'etiquetar'} aoClicar={() => setAba('etiquetar')} />
        <Aba rotulo="Já impressas" ativa={aba === 'impressas'} aoClicar={() => setAba('impressas')} />
      </nav>

      {aba === 'etiquetar' ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1.5 sm:flex-1">
              <Label htmlFor="codigo-componente">Código do componente</Label>
              <Input
                id="codigo-componente"
                ref={codigoRef}
                value={codigo}
                autoFocus
                autoComplete="off"
                onChange={(e) => setCodigo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void adicionar()
                  }
                }}
                placeholder="CAPA78"
                className="font-mono uppercase"
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:flex-1">
              <Label htmlFor="pedido-rolo">Pedido (se o rolo tem)</Label>
              <Input
                id="pedido-rolo"
                value={pedido}
                autoComplete="off"
                onChange={(e) => setPedido(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void adicionar()
                  }
                }}
                placeholder="1234/25"
                className="font-mono"
              />
            </div>
            {/* Os campos NÃO ficam desabilitados durante o envio: desabilitar tira o foco do campo
                Código e o `focus()` do próximo rolo não teria onde pegar. Quem impede o Enter
                repetido de virar duas etiquetas é a trava síncrona de `adicionar`. */}
            <Button
              onClick={() => void adicionar()}
              disabled={ocupado}
              className="bg-enterplak hover:bg-enterplak-700 sm:w-auto"
            >
              Adicionar
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Um rolo por vez. O pedido fica no campo para o rolo seguinte — na recontagem vêm vários
            rolos do mesmo pedido. Deixe em branco o rolo que não tem pedido escrito.
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              <strong>{pendentes.length}</strong> etiqueta(s) esperando impressão
            </span>
            <Button variant="outline" size="sm" onClick={() => void recarregar()} disabled={ocupado}>
              <RefreshCwIcon className="size-4" />
              Atualizar lista
            </Button>
          </div>

          {cortada && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              A lista mostra as {LIMITE_LINHAS_LEGADO} etiquetas mais novas, e há mais esperando
              impressão. Baixe o arquivo para tirar esta leva da frente; o resto aparece depois.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código da etiqueta</TableHead>
                  <TableHead>Componente</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Digitada em</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendentes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      Nada esperando impressão. Digite o código do rolo que está na sua mão.
                    </TableCell>
                  </TableRow>
                ) : (
                  pendentes.map((l, i) => (
                    <TableRow key={l.id || `sem-id-${i}`}>
                      {/* O código por extenso é a ÚNICA conferência que existe: o que ele digitou
                          não é comparado com nada. */}
                      <TableCell className="font-mono font-medium">{l.codigo}</TableCell>
                      <TableCell>{l.item}</TableCell>
                      <TableCell className="font-mono text-xs">{l.pedido || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatadorDataHora.format(new Date(l.criadoEm))}
                        {l.usuarioNome && ` · ${l.usuarioNome}`}
                      </TableCell>
                      <TableCell>
                        {/* Sem id não há remover: a etiqueta EXISTE (o banco já gravou), só a
                            releitura que traz o id falhou. Mandar id vazio recusaria, e insistir
                            faria ele digitar de novo e queimar um segundo número. */}
                        {l.id ? (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Remover a etiqueta ${l.codigo}`}
                            onClick={() => void remover(l)}
                            disabled={ocupado}
                          >
                            <Trash2Icon className="size-4" />
                            Remover
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Atualize a lista para poder remover
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* O rótulo fala de ARQUIVO, e não de "baixar de novo": "Baixar de novo" é o nome da 2ª
                via, na outra aba, e o aviso de leva cortada manda "baixar o arquivo de novo para
                pegar a próxima leva" — com os dois rótulos parecidos, essa frase mandaria o
                almoxarife reimprimir o que já colou em vez de pegar o resto da fila. */}
            <Button
              onClick={() => void baixarArquivo()}
              disabled={ocupado || pendentes.length === 0}
              className="bg-enterplak hover:bg-enterplak-700"
            >
              <DownloadIcon className="size-4" />
              Baixar arquivo de etiquetas (CSV)
            </Button>
            <span className="text-xs text-muted-foreground">
              Leva tudo o que está na lista e marca como impresso. Depois disso, a 2ª via é pela aba
              &ldquo;Já impressas&rdquo;.
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="impressas-de">De</Label>
              <Input
                id="impressas-de"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="impressas-ate">Até</Label>
              <Input
                id="impressas-ate"
                type="date"
                value={ate}
                onChange={(e) => setAte(e.target.value)}
                className="w-44"
              />
            </div>
            <Button variant="outline" onClick={() => void buscarImpressas()} disabled={ocupadoVia}>
              <SearchIcon className="size-4" />
              Buscar
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Para a etiqueta que rasgou ou se perdeu. A 2ª via sai com o MESMO código: nenhum número
            novo é gerado, e nada muda na lista de quem espera impressão.
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={marcarTodas} disabled={impressas.length === 0}>
                Marcar todas
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelecionadas(new Set())}
                disabled={selecionadas.size === 0}
              >
                Limpar seleção
              </Button>
            </div>
            <span className={cn('text-sm', noTeto ? 'text-amber-700' : 'text-muted-foreground')}>
              {selecionadas.size} de {LIMITE_LINHAS_LEGADO} selecionada(s)
              {noTeto && ' — é o máximo por arquivo; baixe esta leva e siga com o resto'}
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Código da etiqueta</TableHead>
                  <TableHead>Componente</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Impressa em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {impressas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      Escolha o período e toque em Buscar.
                    </TableCell>
                  </TableRow>
                ) : (
                  impressas.map((l) => {
                    const marcada = selecionadas.has(l.id)
                    return (
                      <TableRow key={l.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={`Marcar a etiqueta ${l.codigo}`}
                            checked={marcada}
                            disabled={ocupadoVia || (noTeto && !marcada)}
                            onChange={(e) => alternar(l.id, e.target.checked)}
                            className="accent-enterplak"
                          />
                        </TableCell>
                        <TableCell className="font-mono font-medium">{l.codigo}</TableCell>
                        <TableCell>{l.item}</TableCell>
                        <TableCell className="font-mono text-xs">{l.pedido || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {l.impressaEm ? formatadorDataHora.format(new Date(l.impressaEm)) : '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div>
            <Button
              onClick={() => void baixar2aVia()}
              disabled={ocupadoVia || selecionadas.size === 0}
              className="bg-enterplak hover:bg-enterplak-700"
            >
              <DownloadIcon className="size-4" />
              Baixar 2ª via (CSV)
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Aba local (a tela é uma rota só): mesmo desenho da barra de abas do Fluxo. */
function Aba({
  rotulo,
  ativa,
  aoClicar,
}: {
  rotulo: string
  ativa: boolean
  aoClicar: () => void
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-pressed={ativa}
      className={cn(
        '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
        ativa
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {rotulo}
    </button>
  )
}
