'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CANAIS, NOME_CANAL, type Canal, type JanelaTipo, type TipoRegra } from '@/modules/alertas/domain/tipos'
import {
  PADROES_REGRA,
  PADROES_TIPO,
  destinatariosSemCanal,
  validarRegra,
  type DestinatarioDisponivel,
  type EntradaRegra,
  type RegraAlerta,
} from '@/modules/alertas/domain/regra'
import { HORA_RESUMO_MAX, HORA_RESUMO_MIN, HORA_RESUMO_PADRAO } from '@/modules/alertas/domain/resumo'
import { postosOferecidos, type PostoRegra } from '@/modules/alertas/domain/postos-regra'
import { formatarMmSs } from '@/modules/alertas/domain/tempo'
import type { Intervalo } from '@/modules/alertas/domain/intervalos'
import { textoPreviaPosto, type PreviaPosto } from '@/modules/alertas/domain/ocorrencia'
import { NOME_MODULO_ALERTA, type ModuloAlerta } from '@/modules/alertas/domain/modulo'
import { previaRegraAction, salvarRegraAction } from '@/modules/alertas/application/alertas-actions'
import { Explica } from './explica'
import { IntervalosEditor } from './intervalos-editor'
import { PmosSelecao } from './pmos-selecao'

const TOAST = { position: 'bottom-center' } as const
/** Mensagem do repositório quando a regra já foi excluída (exclusão lógica) por outro gestor. */
export const ERRO_REGRA_EXCLUIDA = 'Essa regra foi excluída.'

/** As janelas que cada tipo aceita (spec 2026-09-18, §2). */
const JANELAS: Record<TipoRegra, JanelaTipo[]> = {
  aprovacao: ['tempo', 'bipes', 'op', 'intervalos'],
  tempo: ['tempo', 'op'],
  defeito: ['tempo'],
  // O resumo não tem janela a escolher: sai sempre pelos intervalos (o "dia" de cada posto).
  resumo: ['intervalos'],
  // O fim de EMB não tem janela a escolher: o gatilho é a EMB fechar, e a seção inteira de Janela
  // some neste tipo (ver o render). O 'op' aqui é o valor de FACHADA que `validarRegra` força — está
  // escrito para o formulário mandar ao servidor a MESMA janela que ele vai gravar, e não os minutos
  // de um campo que não aparece. A coluna "Janela" da lista nunca mostra este valor (`JANELA_EMB`).
  emb: ['op'],
  // Mínimo para compilar; o formulário do parado é da Tarefa 4.
  parado: ['op'],
}

const TITULO_PREVIA: Record<TipoRegra, string> = {
  aprovacao: 'Taxa de agora',
  tempo: 'Tempo médio de agora',
  defeito: 'Defeitos repetidos agora',
  // Sem uso: a prévia não existe no resumo (não há janela a antecipar). A chave só fecha o Record.
  resumo: 'Resumo diário',
  // Sem uso, pelo mesmo motivo: não há janela a antecipar no fim de EMB, e o botão "Ver prévia" não
  // aparece neste tipo. A chave fecha o Record e dá um título honesto se a prévia um dia existir.
  emb: 'Fim de EMB',
  parado: 'Parado no Almoxarifado',
}

const EXPLICA_POSTOS: Record<TipoRegra, string> = {
  aprovacao:
    'A taxa é calculada separada para cada posto marcado. Cada posto que ficar abaixo da meta abre o seu próprio alerta.',
  tempo:
    'O tempo médio é calculado separado para cada posto marcado. Cada posto que passar do limite abre o seu próprio alerta.',
  defeito:
    'Os defeitos são contados separados para cada posto marcado. Cada defeito que se repetir num posto abre o seu próprio alerta.',
  resumo:
    'O resumo traz a taxa de aprovação do dia, separada para cada posto marcado.',
  // Sem uso: a seção de Postos NÃO É RENDERIZADA no fim de EMB (ver o render) — quem explica o
  // gatilho dele é o quadro de texto que entra no lugar da seção. A frase fica verdadeira de
  // propósito: se algum dia a seção voltar para este tipo, ela não mente.
  emb:
    'O aviso de fim de EMB não usa posto: ele sai quando todos os processos de uma EMB terminam.',
  parado: 'O aviso de parado olha os itens prontos que ainda não deram entrada no Almoxarifado.',
}

/** Por que a lista de postos é mais curta neste tipo. Tempo médio serve em qualquer posto. */
const EXPLICA_FILTRO: Partial<Record<TipoRegra, string>> = {
  aprovacao:
    'Só aparecem os postos que dão Aprovado ou Reprovado. Num posto que só registra a passagem da peça a taxa é sempre 100% e o alerta nunca sairia.',
  resumo:
    'Só aparecem os postos que dão Aprovado ou Reprovado. Posto que só registra a passagem da peça não tem taxa e ficaria fora do relatório, sem aviso.',
  defeito:
    'Só aparecem os postos que registram o código do defeito na reprova. Sem código não há defeito para se repetir, e o alerta nunca sairia.',
}

/**
 * O aviso do posto que a regra salva já trazia e que este tipo não avalia. Tempo médio não tem: lá
 * nenhum posto fica fora, então `foraDoTipo` é sempre vazio.
 */
const AVISO_FORA_DO_TIPO: Partial<Record<TipoRegra, string>> = {
  aprovacao: 'não dá Aprovado/Reprovado, então a taxa fica sempre em 100% e o alerta não sai',
  resumo: 'não dá Aprovado/Reprovado, então não tem taxa e fica fora do resumo',
  defeito: 'não registra código de defeito, então não há o que repetir e o alerta não sai',
}

/**
 * Responsáveis salvos que não estão mais entre os disponíveis (usuário desativado, removido ou que
 * perdeu a permissão — `alerta_destinatarios` só devolve ativos que administram o MÓDULO da regra,
 * desde a 0149). Saem da seleção ao abrir o formulário; o aviso pede para salvar e confirmar. Lista de
 * disponíveis vazia = nada carregou: não descarta ninguém.
 */
export function separarDestinatarios(
  salvos: string[],
  disponiveis: DestinatarioDisponivel[],
): { validos: string[]; descartados: number } {
  if (disponiveis.length === 0) return { validos: salvos, descartados: 0 }
  const ids = new Set(disponiveis.map((d) => d.usuarioId))
  const validos = salvos.filter((id) => ids.has(id))
  return { validos, descartados: salvos.length - validos.length }
}

function alterna<T>(lista: T[], item: T): T[] {
  return lista.includes(item) ? lista.filter((x) => x !== item) : [...lista, item]
}

function janelaInicial(tipo: TipoRegra, regra: RegraAlerta | null): JanelaTipo {
  if (tipo === 'resumo') return 'intervalos'
  // Fachada, a mesma da validação: o fim de EMB não tem campo de janela, e o estado começa já no
  // valor que vai ser gravado. Sem isto o estado nasceria em 'tempo' e o formulário mandaria minutos.
  if (tipo === 'emb') return 'op'
  const salva = regra?.janelaTipo ?? 'tempo'
  return JANELAS[tipo].includes(salva) ? salva : 'tempo'
}

function minutosIniciais(tipo: TipoRegra, regra: RegraAlerta | null): string {
  if (regra && regra.janelaTipo === 'tempo' && regra.janelaValor !== null) return String(regra.janelaValor)
  // Só `tempo` e `defeito` têm padrão próprio em PADROES_TIPO. Os outros (aprovação, resumo e fim
  // de EMB) caem no padrão geral — e no resumo e no fim de EMB o valor nem é usado, porque eles não
  // têm campo de janela em minutos. A lista é dos que TÊM entrada, para um tipo novo não quebrar aqui.
  const padrao =
    tipo === 'tempo' || tipo === 'defeito' ? PADROES_TIPO[tipo].janelaTempo : PADROES_REGRA.janelaTempo
  return String(padrao)
}

/** O passo do bloco na janela por blocos: 1 hora, a cadência que a fábrica já usa no turno. */
const PASSO_PADRAO_MIN = 60

function passoInicial(regra: RegraAlerta | null): string {
  if (regra && regra.janelaTipo === 'intervalos' && regra.janelaValor !== null) return String(regra.janelaValor)
  return String(PASSO_PADRAO_MIN)
}

/** Regra nova (ou de outra janela) abre com UMA linha vazia; regra salva, com os horários dela. */
function intervalosIniciais(regra: RegraAlerta | null): Intervalo[] {
  if (regra && regra.janelaTipo === 'intervalos' && regra.intervalos.length > 0) return regra.intervalos
  return [{ inicio: '', fim: '' }]
}

function minimoInicial(tipo: TipoRegra, regra: RegraAlerta | null): string {
  if (regra && regra.minimoBipes !== null) return String(regra.minimoBipes)
  return String(tipo === 'tempo' ? PADROES_TIPO.tempo.minimoBipes : PADROES_REGRA.minimoBipes)
}

/**
 * "Ignorar pausas acima de": vazia = não descarta nenhum intervalo. Regra NOVA de tempo abre com o
 * padrão (30) preenchido; regra EXISTENTE mostra o que está salvo (vazio quando a pausa é nula).
 */
function pausaInicial(regra: RegraAlerta | null): string {
  if (!regra) return String(PADROES_TIPO.tempo.pausaMaxMin)
  return regra.pausaMaxMin === null ? '' : String(regra.pausaMaxMin)
}

export function RegraForm({
  modulo,
  tipo,
  regra,
  postos,
  pmosDisponiveis,
  destinatarios,
  configurados,
  canalConfigurado,
  onSalvo,
  onCancelar,
  onVoltar,
  onRegraExcluida,
}: {
  /** O módulo da rota que montou a tela: vai na entrada validada e em cada action. */
  modulo: ModuloAlerta
  tipo: TipoRegra
  regra: RegraAlerta | null
  /** Todos os postos na ordem do fluxo, com o que o perfil de cada um faz. */
  postos: PostoRegra[]
  pmosDisponiveis: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
  /**
   * O aviso EM CANAL está pronto (token do bot + DISCORD_CANAL_ID). Separado de
   * `configurados.discord`, que só olha o token e vale para a mensagem direta.
   */
  canalConfigurado: boolean
  onSalvo: () => void
  onCancelar: () => void
  /** Só na regra nova: volta para a escolha do tipo. */
  onVoltar?: () => void
  /** A regra foi excluída por outro gestor enquanto o diálogo estava aberto. */
  onRegraExcluida?: () => void
}) {
  const [nome, setNome] = useState(regra?.nome ?? '')
  const [postosSel, setPostosSel] = useState<string[]>(regra?.postos ?? [])
  // Congelado na abertura, como o `inicioDest`: os postos que a regra SALVA trazia continuam na
  // lista mesmo que o filtro do tipo os esconda, e voltam a aparecer se o gestor desmarcar sem querer.
  const [postosDaRegra] = useState<string[]>(() => regra?.postos ?? [])
  const [taxa, setTaxa] = useState(String(regra?.taxaMinima ?? PADROES_REGRA.taxaMinima).replace('.', ','))
  const [limiteTempo, setLimiteTempo] = useState(
    regra && regra.limiteTempoSeg !== null ? formatarMmSs(regra.limiteTempoSeg) : PADROES_TIPO.tempo.limiteTempo,
  )
  const [pausa, setPausa] = useState(pausaInicial(regra))
  const [repeticoes, setRepeticoes] = useState(
    String(regra?.limiteOcorrencias ?? PADROES_TIPO.defeito.limiteOcorrencias),
  )
  const [janelaTipo, setJanelaTipo] = useState<JanelaTipo>(janelaInicial(tipo, regra))
  const [minutos, setMinutos] = useState(minutosIniciais(tipo, regra))
  const [bipes, setBipes] = useState(
    String(
      regra?.janelaTipo === 'bipes' ? (regra.janelaValor ?? PADROES_REGRA.janelaBipes) : PADROES_REGRA.janelaBipes,
    ),
  )
  const [passo, setPasso] = useState(passoInicial(regra))
  const [intervalos, setIntervalos] = useState<Intervalo[]>(() => intervalosIniciais(regra))
  const [horaResumo, setHoraResumo] = useState(regra?.horaResumo ?? HORA_RESUMO_PADRAO)
  const [minimo, setMinimo] = useState(minimoInicial(tipo, regra))
  const [lembrete, setLembrete] = useState(regra?.lembreteMin === null || regra === null ? '' : String(regra.lembreteMin))
  const [canaisSel, setCanaisSel] = useState<Canal[]>(regra?.canais ?? [])
  // Regra nova nasce como era antes do canal existir: avisa as pessoas, não avisa canal.
  const [avisarPessoas, setAvisarPessoas] = useState(regra?.avisarPessoas ?? true)
  const [avisarCanal, setAvisarCanal] = useState(regra?.avisarCanal ?? false)
  const [inicioDest] = useState(() => separarDestinatarios(regra?.destinatarios ?? [], destinatarios))
  const [destSel, setDestSel] = useState<string[]>(inicioDest.validos)
  const [pmosSel, setPmosSel] = useState<string[]>(regra?.pmos ?? [])
  const [previa, setPrevia] = useState<{ linhas: PreviaPosto[]; limite: number | null } | null>(null)
  const [pendente, startTransition] = useTransition()

  // "Fulano sem Telegram" só importa se a regra avisa no privado: no canal, quem vê não precisa de
  // conta vinculada nenhuma.
  const avisos = avisarPessoas ? destinatariosSemCanal(destinatarios, destSel, canaisSel) : []
  // Na janela por blocos o `janelaValor` é o PASSO em minutos (outra grandeza, mesmo campo do banco).
  // O fim de EMB sai com valor nulo, como o resumo: a janela dele é só fachada. (Hoje o `janelaTipo`
  // dele já é 'op' e cairia no `null` do fim da cadeia; a condição explícita é o que impede que um
  // valor de fachada diferente, amanhã, mande minutos ao servidor — e `validarRegra` RECUSA a regra
  // de EMB com `janelaValor` preenchido, então isto não é zelo: é a gravação funcionando.)
  const janelaValor =
    tipo === 'resumo' || tipo === 'emb' ? null : janelaTipo === 'tempo' ? minutos : janelaTipo === 'bipes' ? bipes : janelaTipo === 'intervalos' ? passo : null

  const oferecidos = postosOferecidos(tipo, postos, postosDaRegra)
  // Só avisa sobre o que está de fato MARCADO: desmarcado, o posto não atrapalha mais.
  const foraDoTipo = oferecidos.filter((p) => p.foraDoTipo && postosSel.includes(p.chave))

  function entrada(): EntradaRegra {
    return {
      // O módulo vai na entrada para a validação DO CLIENTE medir o mesmo que a do servidor
      // (tipo × módulo). Na gravação quem manda é o módulo da rota, que a action repõe.
      modulo,
      tipo,
      nome,
      // O fim de EMB não tem posto: o gatilho é a EMB fechar, e EMB não é posto. A seção nem
      // aparece, mas a entrada manda a lista vazia de forma EXPLÍCITA — uma regra salva antes com
      // posto, reaberta, não devolveria posto nenhum ao servidor.
      postos: tipo === 'emb' ? [] : postosSel,
      taxaMinima: tipo === 'aprovacao' ? taxa : '',
      janelaTipo,
      janelaValor,
      // A lista é dos tipos que TÊM mínimo de bipes, para um tipo novo não cair aqui por descuido:
      // o fim de EMB não mede bipe nenhum, e `validarRegra` RECUSA a regra de EMB com este campo
      // preenchido (o estado nasce com o padrão 20, não vazio).
      minimoBipes: tipo === 'aprovacao' || tipo === 'tempo' ? minimo : '',
      limiteTempo: tipo === 'tempo' ? limiteTempo : '',
      pausaMaxMin: tipo === 'tempo' ? pausa : '',
      limiteOcorrencias: tipo === 'defeito' ? repeticoes : '',
      // O campo do lembrete não aparece na janela por blocos (quem comanda a insistência é o bloco):
      // um campo escondido não manda valor nenhum.
      // O fim de EMB também não tem lembrete: o aviso de cada EMB sai UMA vez (a marca de "já
      // avisei" por (regra, EMB) na 0150), então não há o que insistir.
      lembreteMin: tipo === 'resumo' || tipo === 'emb' || janelaTipo === 'intervalos' ? '' : lembrete,
      canais: canaisSel,
      destinatarios: destSel,
      avisarPessoas,
      avisarCanal,
      // O fim de EMB não filtra por PMO: a EMB é do Recebimento e não pertence a uma PMO (a seção
      // de PMOs nem aparece neste tipo). O `verPrevia` abaixo manda `pmosSel` como sempre: o botão
      // "Ver prévia" não existe no fim de EMB, então aquele caminho não é alcançável aqui.
      pmos: tipo === 'emb' ? [] : pmosSel,
      // Só a janela que os usa manda os horários: nas outras a chave nem vai.
      ...(janelaTipo === 'intervalos' ? { intervalos } : {}),
      ...(tipo === 'resumo' ? { horaResumo } : {}),
      ativa: regra?.ativa ?? true,
    }
  }

  function salvar() {
    // Mesma validação do servidor, antes de ir ao banco: o gestor vê o erro na hora.
    const dados = entrada()
    const v = validarRegra(dados, { canalConfigurado, canaisConfigurados: configurados })
    if (!v.ok) {
      toast.error(v.erro, TOAST)
      return
    }
    startTransition(async () => {
      const r = await salvarRegraAction(modulo, regra?.id ?? null, dados)
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        if (r.erro === ERRO_REGRA_EXCLUIDA) onRegraExcluida?.()
        return
      }
      toast.success(regra ? 'Regra alterada' : 'Regra criada', TOAST)
      onSalvo()
    })
  }

  function verPrevia() {
    startTransition(async () => {
      const r = await previaRegraAction(modulo, {
        tipo,
        postos: postosSel,
        janelaTipo,
        janelaValor,
        minimoBipes: tipo === 'defeito' ? '' : minimo,
        pausaMaxMin: tipo === 'tempo' ? pausa : '',
        limiteOcorrencias: tipo === 'defeito' ? repeticoes : '',
        pmos: pmosSel,
      })
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      const limite = Number.parseInt(repeticoes, 10)
      setPrevia({ linhas: r.postos, limite: tipo === 'defeito' && Number.isFinite(limite) ? limite : null })
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="nome">Nome</Label>
        <Input
          id="nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={tipo === 'emb' ? 'Divergências de EMB' : tipo === 'resumo' ? 'Resumo do dia' : tipo === 'tempo' ? 'Teste lento' : tipo === 'defeito' ? 'Defeito repetido no Teste' : 'Teste abaixo de 90'}
          autoComplete="off"
        />
      </div>

      {/* O fim de EMB não tem posto: o gatilho é a EMB fechar, e EMB não é posto. Campo morto é
          pior que campo nenhum — a seção some, e no lugar dela entra o quadro que EXPLICA o gatilho. */}
      {tipo !== 'emb' && (
      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Postos
          <Explica titulo="Postos">
            <p>Os postos que esta regra acompanha.</p>
            <p>{EXPLICA_POSTOS[tipo]}</p>
            {EXPLICA_FILTRO[tipo] && <p>{EXPLICA_FILTRO[tipo]}</p>}
          </Explica>
        </legend>
        <div className="flex flex-wrap gap-3">
          {oferecidos.map((p) => (
            <label key={p.chave} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id={`posto-${p.chave}`}
                aria-label={p.chave}
                checked={postosSel.includes(p.chave)}
                onChange={() => setPostosSel((atual) => alterna(atual, p.chave))}
              />
              {p.chave}
              {p.foraDoTipo && <span className="text-xs text-amber-700 dark:text-amber-400">(não avalia)</span>}
            </label>
          ))}
        </div>
        {foraDoTipo.length > 0 && AVISO_FORA_DO_TIPO[tipo] && (
          <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
            {foraDoTipo.map((p) => p.chave).join(', ')} {foraDoTipo.length > 1 ? 'continuam' : 'continua'} na regra,
            mas {AVISO_FORA_DO_TIPO[tipo]}. Desmarque ou troque de posto.
          </p>
        )}
      </fieldset>
      )}

      {/* O gatilho do fim de EMB não se configura: ou todos os processos da EMB terminaram, ou não.
          Mas tem de estar ESCRITO na tela — senão o gestor salva a regra sem saber quando ela sai,
          o que ela traz e que cada EMB avisa uma vez só. Cada frase aqui foi conferida contra a
          0150: o terminal é `rec_etapa_por_status in ('almoxarifado','reprovado')`, o piso é o
          `criado_em` da regra, e a marca de "já avisei" é a `alerta_emb_avisada (regra_id, emb)`. */}
      {tipo === 'emb' && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          <p>
            O aviso sai quando <strong>todos os processos de uma EMB</strong> chegam ao fim do
            fluxo — Almoxarifado ou Reprovado na Qualidade. Item reprovado também terminou.
          </p>
          <p>
            A mensagem traz <strong>as divergências de quantidade</strong> daquela EMB, com a
            justificativa de cada uma (ou a marca de que ninguém justificou). A EMB que fecha sem
            nenhuma divergência <strong>também avisa</strong>, dizendo que terminou sem divergência.
          </p>
          <p>
            Cada EMB avisa <strong>uma vez só</strong>. A conferência é feita a cada 5 minutos, e
            EMBs que fecharam antes de a regra ser criada não são avisadas.
          </p>
        </div>
      )}

      {tipo === 'aprovacao' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="taxa">Taxa mínima de aprovação (%)</Label>
              <Explica titulo="Taxa mínima de aprovação (%)">
                <p>A meta de aprovação do posto. Se a taxa ficar <strong>abaixo</strong> dela, o alerta é enviado.</p>
                <p>Taxa = aprovados ÷ (aprovados + reprovados) × 100, contando só os bipes com resultado <strong>Aprovado</strong> ou <strong>Reprovado</strong> dentro da janela. Bipes só com Registrado ficam de fora.</p>
                <p>Ex.: 45 aprovados e 5 reprovados = 90%. Com meta 95, alerta; com meta 90, não.</p>
                <p>A conta é refeita a cada 5 minutos.</p>
              </Explica>
            </div>
            <Input id="taxa" value={taxa} onChange={(e) => setTaxa(e.target.value)} inputMode="decimal" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="minimo">Mínimo de bipes</Label>
              <Explica titulo="Mínimo de bipes">
                <p>Quantos bipes com resultado (aprovados + reprovados) a janela precisa ter para a regra avaliar.</p>
                <p>Evita alarme falso com poucas peças: com 1 reprova em 2 bipes a taxa seria 50%. Abaixo do mínimo, a regra não abre nem encerra alerta.</p>
              </Explica>
            </div>
            <Input id="minimo" value={minimo} onChange={(e) => setMinimo(e.target.value)} inputMode="numeric" />
          </div>
        </div>
      )}

      {tipo === 'tempo' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="limite-tempo">Tempo máximo por peça (mm:ss)</Label>
              <Explica titulo="Tempo máximo por peça (mm:ss)">
                <p>O tempo médio entre um bipe e o próximo no posto (a cadência). Se a média ficar <strong>acima</strong> deste tempo, o alerta é enviado.</p>
                <p>Conta todos os bipes do posto, com qualquer resultado. Um bipe com várias linhas de defeito conta como uma peça só.</p>
                <p>Ex.: 2:00 = até 2 minutos por peça. De 0:01 a 60:00.</p>
              </Explica>
            </div>
            <Input
              id="limite-tempo"
              value={limiteTempo}
              onChange={(e) => setLimiteTempo(e.target.value)}
              placeholder="2:00"
              inputMode="numeric"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="minimo">Mínimo de bipes</Label>
              <Explica titulo="Mínimo de bipes">
                <p>Quantas peças (bipes distintos do posto) a janela precisa ter para a regra avaliar, além de pelo menos 1 intervalo válido para calcular a média.</p>
                <p>Evita alarme falso com poucas peças. Abaixo do mínimo, a regra não abre nem encerra alerta.</p>
              </Explica>
            </div>
            <Input id="minimo" value={minimo} onChange={(e) => setMinimo(e.target.value)} inputMode="numeric" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="pausa">Ignorar pausas acima de (min)</Label>
              <Explica titulo="Ignorar pausas acima de (min)">
                <p>Intervalos maiores que isto (almoço, troca de turno, máquina parada) ficam <strong>fora</strong> da média e não contam como intervalo válido.</p>
                <p>Padrão 30 minutos; de 1 a 240. <strong>Vazio</strong> = não descarta nenhum intervalo: todas as pausas entram na média (ex.: o almoço entra na conta).</p>
              </Explica>
            </div>
            <Input
              id="pausa"
              value={pausa}
              onChange={(e) => setPausa(e.target.value)}
              inputMode="numeric"
              placeholder="vazio = conta todas as pausas"
            />
          </div>
        </div>
      )}

      {tipo === 'defeito' && (
        <div className="flex flex-col gap-2 sm:max-w-xs">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="repeticoes">Repetições para alertar</Label>
            <Explica titulo="Repetições para alertar">
              <p>Quantas vezes o <strong>mesmo</strong> código de defeito precisa aparecer em bipes <strong>reprovados</strong> do posto, dentro da janela, para alertar.</p>
              <p>Cada defeito que chegar a esse número abre o seu próprio alerta, e normaliza sozinho quando volta a ficar abaixo. Mínimo 2.</p>
            </Explica>
          </div>
          <Input id="repeticoes" value={repeticoes} onChange={(e) => setRepeticoes(e.target.value)} inputMode="numeric" />
        </div>
      )}

      {tipo === 'resumo' && (
        <fieldset className="flex flex-col gap-3">
          <legend className="flex items-center gap-1.5 text-sm font-medium">
            Horário do resumo
            <Explica titulo="Horário do resumo">
              <p>Os <strong>intervalos</strong> dizem o que é o dia de trabalho de cada posto (ex.: 07:00–12:00 e 13:00–17:00). O resumo conta só os bipes dentro deles.</p>
              <p>A <strong>hora do resumo</strong> é quando a mensagem sai, de {HORA_RESUMO_MIN} a {HORA_RESUMO_MAX}. Vale o horário da fábrica.</p>
            </Explica>
          </legend>
          <div className="flex flex-col gap-2 sm:max-w-xs">
            <Label htmlFor="hora-resumo">A mensagem sai às</Label>
            <Input
              id="hora-resumo"
              type="time"
              value={horaResumo}
              min={HORA_RESUMO_MIN}
              max={HORA_RESUMO_MAX}
              onChange={(e) => setHoraResumo(e.target.value)}
            />
          </div>
          {/* Sem rótulo, os dois campos de horário ficavam soltos embaixo da hora do envio e
              ninguém sabia o que eram (visto no smoke de 09/10). */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">O dia de trabalho dos postos</span>
            <IntervalosEditor intervalos={intervalos} passoMin={Number.NaN} onChange={setIntervalos} />
          </div>
        </fieldset>
      )}

      {/* O resumo não tem janela a escolher: o bloco acima já traz os intervalos. O fim de EMB não
          tem janela NENHUMA: o gatilho é a EMB fechar (o quadro acima explica). */}
      {tipo !== 'resumo' && tipo !== 'emb' && (
      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Janela
          <Explica titulo="Janela">
            {tipo === 'defeito' ? (
              <p>Os bipes <strong>reprovados</strong> do posto nos últimos X minutos, de todas as OPs (até 7 dias).</p>
            ) : (
              <>
                <p>{tipo === 'tempo' ? 'Quais bipes entram na média:' : 'Quais bipes entram na conta da taxa:'}</p>
                <p><strong>Últimos X minutos</strong>: os bipes do posto nesse período, de todas as OPs (até 7 dias).</p>
                {tipo === 'aprovacao' && (
                  <p><strong>Últimos N bipes</strong>: os N bipes com resultado mais recentes do posto, de todas as OPs, olhando no máximo 30 dias. Precisa ser maior ou igual ao mínimo de bipes.</p>
                )}
                <p><strong>OP em andamento</strong>: todos os bipes do posto na OP do último bipe dele. Se o posto está parado há mais de 2 horas, não avalia.</p>
                {JANELAS[tipo].includes('intervalos') && (
                  <p><strong>Por blocos de turno</strong>: os bipes de cada bloco do turno, medidos no fechamento do bloco. Ex.: 07:00–12:00 com passo de 1 hora = a taxa é conferida às 08:00, 09:00, e assim por diante.</p>
                )}
              </>
            )}
          </Explica>
        </legend>
        {tipo === 'defeito' ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Últimos</span>
            <Input
              aria-label="Últimos minutos"
              className="w-20"
              value={minutos}
              onChange={(e) => setMinutos(e.target.value)}
              inputMode="numeric"
            />
            <span>minutos</span>
          </div>
        ) : (
          <>
            {/* Rádio e campo ficam FORA de um <label> comum de propósito: um label envolvendo dois
                controles deixa "Últimos minutos" ambíguo (para o leitor de tela e para o teste). */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="radio"
                name="janela"
                aria-label="Janela por tempo"
                checked={janelaTipo === 'tempo'}
                onChange={() => setJanelaTipo('tempo')}
              />
              <span>Últimos</span>
              <Input
                aria-label="Últimos minutos"
                className="w-20"
                value={minutos}
                onChange={(e) => setMinutos(e.target.value)}
                inputMode="numeric"
                disabled={janelaTipo !== 'tempo'}
              />
              <span>minutos</span>
            </div>
            {JANELAS[tipo].includes('bipes') && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="janela"
                  aria-label="Janela por bipes"
                  checked={janelaTipo === 'bipes'}
                  onChange={() => setJanelaTipo('bipes')}
                />
                <span>Últimos</span>
                <Input
                  aria-label="Quantidade de bipes"
                  className="w-20"
                  value={bipes}
                  onChange={(e) => setBipes(e.target.value)}
                  inputMode="numeric"
                  disabled={janelaTipo !== 'bipes'}
                />
                <span>bipes</span>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="janela"
                aria-label="OP em andamento"
                checked={janelaTipo === 'op'}
                onChange={() => setJanelaTipo('op')}
              />
              OP em andamento
            </label>
            {JANELAS[tipo].includes('intervalos') && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="janela"
                    aria-label="Por blocos de turno"
                    checked={janelaTipo === 'intervalos'}
                    onChange={() => setJanelaTipo('intervalos')}
                  />
                  Por blocos de turno
                </label>
                {janelaTipo === 'intervalos' && (
                  <div className="ml-6 flex flex-col gap-3 border-l border-border pl-3">
                    <div className="flex flex-col gap-2 sm:max-w-xs">
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor="passo">Passo do bloco (min)</Label>
                        <Explica titulo="Passo do bloco (min)">
                          <p>De quanto em quanto tempo o turno é fatiado. A taxa é medida <strong>bloco a bloco</strong>, e o aviso sai no fechamento de cada bloco.</p>
                          <p>Padrão 1 hora (60 minutos); no mínimo 15. O passo precisa caber no menor intervalo cadastrado.</p>
                          <p>Nessa janela o <strong>lembrete</strong> não se aplica: quem comanda a insistência é o próximo bloco.</p>
                        </Explica>
                      </div>
                      <Input id="passo" value={passo} onChange={(e) => setPasso(e.target.value)} inputMode="numeric" />
                    </div>
                    <IntervalosEditor
                      intervalos={intervalos}
                      passoMin={Number.parseInt(passo, 10)}
                      onChange={setIntervalos}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </fieldset>
      )}

      {/* O lembrete é IGNORADO na janela por blocos (sai null na validação): quem comanda a
          insistência é o fechamento do próximo bloco. Campo que não faz nada é pior que campo
          nenhum, então ele some. No fim de EMB some pelo mesmo motivo: cada EMB avisa UMA vez (a
          marca de "já avisei" por (regra, EMB) na 0150), e não há alerta aberto para insistir. */}
      {tipo !== 'resumo' && tipo !== 'emb' && janelaTipo !== 'intervalos' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="lembrete">Lembrar a cada (min)</Label>
            <Explica titulo="Lembrar a cada (min)">
              <p>Enquanto o problema continuar e ninguém apertar <strong>Resolvido</strong>, o alerta é reenviado a cada X minutos.</p>
              <p>Vazio = só um alerta quando começa e um aviso quando normaliza.</p>
            </Explica>
          </div>
          <Input
            id="lembrete"
            value={lembrete}
            onChange={(e) => setLembrete(e.target.value)}
            inputMode="numeric"
            placeholder="vazio = sem lembrete"
          />
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Como avisar
          <Explica titulo="Como avisar">
            <p><strong>Mensagem direta ao responsável</strong>: é o comportamento de sempre — cada um recebe a mensagem. Marcando, escolha por onde: <strong>Telegram</strong>, <strong>Discord</strong>, <strong>E-mail</strong> ou os três.</p>
            <p>O <strong>E-mail</strong> vai para o endereço com que a pessoa entra no sistema. Não há cadastro de endereço, e quem não tem conta no sistema não pode ser avisado.</p>
            <p><strong>No canal do Discord</strong>: uma mensagem só, no canal do sistema, que todo mundo do canal vê.</p>
            <p>Dá para marcar os dois. Só no canal: ninguém recebe mensagem direta, e os responsáveis continuam podendo apertar <strong>Resolvido</strong> ali mesmo.</p>
            <p>A mensagem no canal <strong>não marca ninguém</strong> (@here/cargo): quem não estiver com o Discord aberto pode não notar.</p>
          </Explica>
        </legend>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label="Mensagem direta ao responsável"
              checked={avisarPessoas}
              onChange={() => setAvisarPessoas((a) => !a)}
            />
            Mensagem direta ao responsável
          </label>
          {/* Telegram, Discord e E-mail são sub-opções DA mensagem direta: fora dela não querem dizer nada
              (o aviso em canal é sempre do Discord). Some quando a mensagem direta é desmarcada. */}
          {avisarPessoas && (
            <div className="ml-6 flex flex-wrap gap-4 border-l border-border pl-3">
              {CANAIS.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={NOME_CANAL[c]}
                    checked={canaisSel.includes(c)}
                    onChange={() => setCanaisSel((atual) => alterna(atual, c))}
                  />
                  {NOME_CANAL[c]}
                  {!configurados[c] && <span className="text-xs text-muted-foreground">(não configurado)</span>}
                </label>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label="No canal do Discord"
              checked={avisarCanal}
              onChange={() => setAvisarCanal((a) => !a)}
            />
            No canal do Discord
            {/* O canal precisa do token E do DISCORD_CANAL_ID: `configurados.discord` só olha o token. */}
            {!canalConfigurado && <span className="text-xs text-muted-foreground">(não configurado)</span>}
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Responsáveis
          <Explica titulo="Responsáveis">
            <p>Quem responde por este alerta. São eles que podem apertar <strong>Resolvido</strong> — junto com quem administra o {NOME_MODULO_ALERTA[modulo]} pela tela.</p>
            {/* ⚠️ A permissão é POR MÓDULO desde a 0149: `alerta_destinatarios(p_modulo)` só devolve
                quem tem `usuario_tem_permissao(usuário, <módulo da regra>, 'administrar')`. O texto
                dizia "o ShopFloor" fixo — numa regra do Recebimento isso afirmava a permissão errada. */}
            <p>Só aparecem usuários ativos que podem <strong>administrar o {NOME_MODULO_ALERTA[modulo]}</strong>. Quem perder essa permissão para de receber e de poder encerrar, mesmo continuando na regra.</p>
          </Explica>
        </legend>
        <div className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
          {destinatarios.map((d) => (
            <label key={d.usuarioId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={d.nome}
                checked={destSel.includes(d.usuarioId)}
                onChange={() => setDestSel((atual) => alterna(atual, d.usuarioId))}
              />
              {d.nome}
              <span className="text-xs text-muted-foreground">
                Telegram {d.telegram ? '✓' : '—'} · Discord {d.discord ? '✓' : '—'} ·
                E-mail {d.emailOk ? '✓' : '—'}
              </span>
            </label>
          ))}
        </div>
        {inicioDest.descartados > 0 && (
          <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
            {inicioDest.descartados} responsável(is) inativo(s) ou sem permissão de administrar o{' '}
            {NOME_MODULO_ALERTA[modulo]} removido(s) da regra — salve para confirmar.
          </p>
        )}
        {avisos.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-xs text-amber-700 dark:text-amber-400">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </fieldset>

      {/* A EMB é do Recebimento e não pertence a uma PMO: não há o que filtrar. */}
      {tipo !== 'emb' && (
        <PmosSelecao disponiveis={pmosDisponiveis} selecionadas={pmosSel} onChange={setPmosSel} />
      )}

      {tipo !== 'resumo' && tipo !== 'emb' && previa && (
        <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm">
          <span className="font-medium">{TITULO_PREVIA[tipo]}</span>
          {previa.linhas.map((p) => (
            <span key={`${p.posto}|${p.defeito ?? ''}`} className="text-muted-foreground">
              {textoPreviaPosto(tipo, p, previa.limite)}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {onVoltar && (
          <Button variant="ghost" onClick={onVoltar} disabled={pendente} className="mr-auto">
            Trocar tipo
          </Button>
        )}
        <Button variant="ghost" onClick={onCancelar} disabled={pendente}>
          Cancelar
        </Button>
        {/* A prévia NÃO aparece na janela por blocos, e isso não é esquecimento: a `alerta_previa`
            do banco levanta JANELA_INVALIDA em qualquer janela fora de tempo/bipes/op, então o
            botão quebraria. É decisão consciente e REVERSÍVEL — ensinar a `alerta_previa` a receber
            o bloco é tarefa própria, e o botão volta. No fim de EMB não há prévia por outro
            motivo: não há janela a antecipar, nem medida a mostrar — só o gatilho. */}
        {tipo !== 'resumo' && tipo !== 'emb' && janelaTipo !== 'intervalos' && (
          <Button variant="outline" onClick={verPrevia} disabled={pendente}>
            Ver prévia
          </Button>
        )}
        <Button onClick={salvar} disabled={pendente} className="bg-enterplak hover:bg-enterplak-700">
          {pendente ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
