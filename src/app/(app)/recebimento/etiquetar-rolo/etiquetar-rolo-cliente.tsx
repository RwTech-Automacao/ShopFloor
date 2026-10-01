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
  /** Sumidouro: engole o que for digitado enquanto a gravação está em voo (ver o efeito abaixo). */
  const bloqueioRef = useRef<HTMLInputElement>(null)
  /** Ligado enquanto uma ação trava os campos: o foco volta ao Código quando ela destrava. */
  const focarCodigo = useRef(false)
  const [codigo, setCodigo] = useState('')
  const [pedido, setPedido] = useState('')
  const [pendentes, setPendentes] = useState<RoloEtiquetado[]>([])
  const [cortada, setCortada] = useState(false)
  const [avisoArquivo, setAvisoArquivo] = useState<string | null>(null)
  const [erroPendentes, setErroPendentes] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const [desde, setDesde] = useState(hojeISO)
  const [ate, setAte] = useState(hojeISO)
  const [impressas, setImpressas] = useState<RoloEtiquetado[]>([])
  const [estadoImpressas, setEstadoImpressas] = useState<'inicio' | 'vazia' | 'erro'>('inicio')
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [ocupadoVia, setOcupadoVia] = useState(false)

  const noTeto = selecionadas.size >= LIMITE_LINHAS_LEGADO
  /** A busca já corta em 1.000 em silêncio: leva cheia quer dizer que o período pode ter mais. */
  const levaCheia = impressas.length >= LIMITE_LINHAS_LEGADO

  /**
   * A lista de pendentes vem do banco, sempre: é ela que traz os ids que o remover usa.
   *
   * Ela é carregada AQUI, no cliente, e não na página, porque é isso que dá ao botão "Atualizar
   * lista" o que recarregar sem recarregar a rota inteira. (Não é por medo de erro de permissão:
   * a policy de leitura da 0126 exige `recebimento:visualizar`, e RLS negando um `select` devolve
   * ZERO LINHAS, não erro — `tem_permissao` é `sql stable` e devolve boolean, nunca levanta. Quem
   * garante que esse perfil não chega até aqui é o gate da página, que exige as duas permissões.)
   */
  const recarregar = useCallback(async () => {
    const r = await listarPendentesAction()
    if (!r.ok) {
      toast.error(r.erro)
      // O toast passa em 4 s e a tabela continua na tela: sem isto ela afirmaria "Nada esperando
      // impressão" para quem na verdade não conseguiu carregar a lista.
      setErroPendentes(r.erro)
      return
    }
    setErroPendentes(null)
    setPendentes(r.linhas)
    setCortada(r.cortada)
  }, [])

  // Carga inicial da lista. O setState só acontece depois do await, quando a resposta do servidor
  // chega — nunca durante o render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState pós-await, fora do render
    void recarregar()
  }, [recarregar])

  /**
   * Enquanto GRAVA, os campos ficam travados e o foco vai para o campo-sumidouro — mesmo padrão do
   * Lançamento (`lancamento-form.tsx`), onde isto já foi bug de produção.
   *
   * Sem a trava, o rolo seguinte era digitado POR CIMA da gravação: o valor era anexado ao antigo
   * (`CAPA78` + `CAPB99`) e a resposta do rolo anterior limpava o campo, apagando o que ele acabara
   * de digitar. O rolo 2 ficava sem etiqueta — o problema que esta tela existe para resolver.
   *
   * Sem `setTimeout` (o Lançamento precisa dele por causa do overlay): o efeito roda depois do
   * commit, então os campos já estão `disabled` e o sumidouro já existe.
   */
  useEffect(() => {
    if (!ocupado) return
    bloqueioRef.current?.focus()
  }, [ocupado])

  /**
   * E o foco volta ao Código quando destrava, que é o que faz o gesto existir: ele não toca no
   * tablet entre um rolo e outro. Tem de ser num efeito — o `focus()` de dentro da ação não pega
   * enquanto o campo ainda está `disabled` (a resposta e o destravamento são o mesmo ciclo).
   */
  useEffect(() => {
    if (ocupado || !focarCodigo.current) return
    focarCodigo.current = false
    codigoRef.current?.focus()
  }, [ocupado])

  /** Trava a tela para uma ação e marca que o foco volta ao Código quando ela terminar. */
  function travar() {
    focarCodigo.current = true
    setOcupado(true)
  }

  async function adicionar() {
    // Trava síncrona: Enter repetido não emite duas etiquetas. Com os campos travados e o foco no
    // sumidouro nada deveria chegar aqui em voo — mas se chegar, ele fica SABENDO: engolir o Enter
    // em silêncio fazia ele ver a linha do rolo 1 entrar na lista, achar que era a do rolo 2 e ir
    // para a prateleira seguinte com o rolo 2 ainda sem etiqueta.
    if (ocupado) {
      toast.warning('Espere: o rolo anterior ainda está sendo gravado.')
      return
    }
    travar()
    try {
      const r = await etiquetarRoloAction(codigo, pedido)
      if (!r.ok) {
        toast.error(r.erro) // NÃO limpa nada: ele corrige o que digitou
        return
      }
      setPendentes((atual) => [r.linha, ...atual])
      setCodigo('') // o código limpa (e o efeito acima devolve o foco a ele)
      // o PEDIDO fica: vêm vários rolos seguidos do mesmo pedido
      toast.success(`Etiqueta ${r.linha.codigo} gerada.`)
    } finally {
      setOcupado(false)
    }
  }

  async function remover(linha: RoloEtiquetado) {
    if (ocupado) return
    travar()
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
    travar()
    setAvisoArquivo(null) // o aviso da leva anterior não vale para esta
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
      // O aviso sai INTEIRO e na TARJA, não em toast: ele pode juntar duas frases (alguém baixou ou
      // removeu junto · a leva foi cortada em 1.000) e CADA UMA diz o que fazer — são ~565
      // caracteres, um paredão de 14 linhas no toast estreito do tablet. É a mensagem que evita
      // colar o mesmo código em dois rolos, então fica na tarja larga, do lado da tabela em que ele
      // vai conferir, e não desaparece sozinha.
      setAvisoArquivo(r.aviso ?? null)
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
        // A busca que falhou não pode deixar a tabela dizendo "Escolha o período e toque em
        // Buscar", como se ele ainda não tivesse buscado.
        setImpressas([])
        setSelecionadas(new Set())
        setEstadoImpressas('erro')
        return
      }
      setImpressas(r.linhas)
      setSelecionadas(new Set())
      setEstadoImpressas(r.linhas.length === 0 ? 'vazia' : 'inicio')
      if (r.linhas.length === 0) {
        toast.info('Nenhuma etiqueta impressa nesse período. Confira as datas e busque de novo.')
      }
    } finally {
      setOcupadoVia(false)
    }
  }

  /**
   * O teto de 1.000 é fechado na CAIXA, que fica `disabled` quando a seleção enche — é lá que ele
   * descobre o limite antes de apertar, e é o contador do cabeçalho que diz o que fazer.
   *
   * Aqui a guarda se repete só como invariante: passar de 1.000 ids faz a 2ª via falhar com uma
   * mensagem que não chega ao usuário (o tratamento de erro não reconhece aquele código e mostra o
   * genérico "chame o desenvolvedor"). Sai sem aviso de propósito: no teto a caixa não responde ao
   * toque, então nenhum aviso daqui teria como aparecer.
   */
  function alternar(id: string, marcado: boolean) {
    if (marcado && noTeto) return
    setSelecionadas((atual) => {
      const proximo = new Set(atual)
      if (marcado) proximo.add(id)
      else proximo.delete(id)
      return proximo
    })
  }

  /**
   * A BUSCA já corta em 1.000 em silêncio, então a lista nunca vem com mais do que cabe no arquivo:
   * marcar todas nunca deixa uma linha da tela de fora. O que pode ter ficado de fora é do PERÍODO,
   * e o único jeito de alcançar o resto é estreitar as datas — "limpe a seleção e siga com o resto"
   * não funcionaria, porque o resto não está na tela para ser marcado.
   */
  function marcarTodas() {
    const cabem = impressas.slice(0, LIMITE_LINHAS_LEGADO)
    setSelecionadas(new Set(cabem.map((l) => l.id)))
    if (levaCheia) {
      toast.warning(
        `A busca traz até ${LIMITE_LINHAS_LEGADO} etiquetas por vez, e este período pode ter mais. Baixe esta leva e depois estreite as datas para ver o resto.`,
      )
    }
  }

  async function baixar2aVia() {
    if (ocupadoVia) return
    // A ordem é a da lista, não a dos cliques: as etiquetas saem do arquivo na ordem em que ele as
    // lê, e é nessa ordem que quem cola vai achá-las.
    const ids = impressas.filter((l) => selecionadas.has(l.id)).map((l) => l.id)
    // Seleção vazia não chega aqui: o botão fica `disabled`. A guarda continua como invariante (um
    // arquivo só com cabeçalho não ajuda ninguém), e por isso sai calada — um aviso daqui não
    // teria como aparecer.
    if (ids.length === 0) return
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
                disabled={ocupado}
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
                disabled={ocupado}
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
            {/* O campo-sumidouro: enquanto grava, é ELE quem tem o foco, e o que for digitado por
                cima não cai em campo nenhum (e não é apagado pela resposta do rolo anterior). Fora
                da gravação não existe para o usuário — nem foco por Tab, nem leitor de tela. */}
            <input
              ref={bloqueioRef}
              className="sr-only"
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              onKeyDown={(e) => e.preventDefault()}
            />
            {/* O rótulo troca porque `disabled` sozinho não diz que HÁ gravação em curso: ele
                precisa saber que o rolo anterior ainda está sendo gravado, senão acha que a tela
                travou. */}
            <Button
              onClick={() => void adicionar()}
              disabled={ocupado}
              className="bg-enterplak hover:bg-enterplak-700 sm:w-auto"
            >
              {ocupado ? 'Enviando…' : 'Adicionar'}
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

          {/* O aviso do arquivo vem PRIMEIRO e mais forte: é ele que evita colar o mesmo código em
              dois rolos. O de leva cortada é informativo. */}
          {avisoArquivo && (
            <p
              role="status"
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900"
            >
              {avisoArquivo}
            </p>
          )}

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
                    {/* Carga que falhou ≠ lista vazia: dizer "nada esperando impressão" a quem não
                        conseguiu carregar a lista é mentira, e o toast do erro já passou. */}
                    <TableCell
                      colSpan={5}
                      className={cn('text-sm', erroPendentes ? 'text-amber-800' : 'text-muted-foreground')}
                    >
                      {erroPendentes
                        ? 'Não deu para carregar a lista — toque em Atualizar lista.'
                        : 'Nada esperando impressão. Digite o código do rolo que está na sua mão.'}
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
            {/* O denominador é o que está na TELA, como na etiquetagem por planilha: "de 1.000"
                lia-se como "há 1.000 para marcar" com três linhas na tabela. O teto só entra na
                frase quando a leva veio cheia — e aí o caminho é estreitar as datas, porque o resto
                do período não está na tela para ser marcado depois. */}
            <span className={cn('text-sm', noTeto ? 'text-amber-700' : 'text-muted-foreground')}>
              {selecionadas.size} selecionada(s) de {impressas.length} linha(s)
              {levaCheia &&
                ` · a busca traz até ${LIMITE_LINHAS_LEGADO} por vez; para ver o resto do período, estreite as datas`}
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
                    {/* Três estados diferentes: ainda não buscou · buscou e não achou · a busca
                        falhou. Um texto só para os três faria a tela dizer "escolha o período"
                        depois de ele ter escolhido, e "não achei" quando o que houve foi falha. */}
                    <TableCell
                      colSpan={5}
                      className={cn(
                        'text-sm',
                        estadoImpressas === 'erro' ? 'text-amber-800' : 'text-muted-foreground',
                      )}
                    >
                      {estadoImpressas === 'erro'
                        ? 'Não deu para carregar a lista — toque em Buscar de novo.'
                        : estadoImpressas === 'vazia'
                          ? 'Nenhuma etiqueta impressa nesse período.'
                          : 'Escolha o período e toque em Buscar.'}
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
