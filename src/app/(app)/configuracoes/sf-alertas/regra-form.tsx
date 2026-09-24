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
import { postosOferecidos, type PostoRegra } from '@/modules/alertas/domain/postos-regra'
import { formatarMmSs } from '@/modules/alertas/domain/tempo'
import { textoPreviaPosto, type PreviaPosto } from '@/modules/alertas/domain/ocorrencia'
import { previaRegraAction, salvarRegraAction } from '@/modules/alertas/application/alertas-actions'
import { Explica } from './explica'
import { PmosSelecao } from './pmos-selecao'

const TOAST = { position: 'bottom-center' } as const
/** Mensagem do repositório quando a regra já foi excluída (exclusão lógica) por outro gestor. */
export const ERRO_REGRA_EXCLUIDA = 'Essa regra foi excluída.'

/** As janelas que cada tipo aceita (spec 2026-09-18, §2). */
const JANELAS: Record<TipoRegra, JanelaTipo[]> = {
  aprovacao: ['tempo', 'bipes', 'op'],
  tempo: ['tempo', 'op'],
  defeito: ['tempo'],
}

const TITULO_PREVIA: Record<TipoRegra, string> = {
  aprovacao: 'Taxa de agora',
  tempo: 'Tempo médio de agora',
  defeito: 'Defeitos repetidos agora',
}

const EXPLICA_POSTOS: Record<TipoRegra, string> = {
  aprovacao:
    'A taxa é calculada separada para cada posto marcado. Cada posto que ficar abaixo da meta abre o seu próprio alerta.',
  tempo:
    'O tempo médio é calculado separado para cada posto marcado. Cada posto que passar do limite abre o seu próprio alerta.',
  defeito:
    'Os defeitos são contados separados para cada posto marcado. Cada defeito que se repetir num posto abre o seu próprio alerta.',
}

/** Por que a lista de postos é mais curta neste tipo. Tempo médio serve em qualquer posto. */
const EXPLICA_FILTRO: Partial<Record<TipoRegra, string>> = {
  aprovacao:
    'Só aparecem os postos que dão Aprovado ou Reprovado. Num posto que só registra a passagem da peça a taxa é sempre 100% e o alerta nunca sairia.',
  defeito:
    'Só aparecem os postos que registram o código do defeito na reprova. Sem código não há defeito para se repetir, e o alerta nunca sairia.',
}

/**
 * O aviso do posto que a regra salva já trazia e que este tipo não avalia. Tempo médio não tem: lá
 * nenhum posto fica fora, então `foraDoTipo` é sempre vazio.
 */
const AVISO_FORA_DO_TIPO: Partial<Record<TipoRegra, string>> = {
  aprovacao: 'não dá Aprovado/Reprovado, então a taxa fica sempre em 100% e o alerta não sai',
  defeito: 'não registra código de defeito, então não há o que repetir e o alerta não sai',
}

/**
 * Responsáveis salvos que não estão mais entre os disponíveis (usuário desativado, removido ou que
 * perdeu shopfloor.administrar — `alerta_destinatarios` só devolve ativos que administram o
 * ShopFloor). Saem da seleção ao abrir o formulário; o aviso pede para salvar e confirmar. Lista de
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
  const salva = regra?.janelaTipo ?? 'tempo'
  return JANELAS[tipo].includes(salva) ? salva : 'tempo'
}

function minutosIniciais(tipo: TipoRegra, regra: RegraAlerta | null): string {
  if (regra && regra.janelaTipo === 'tempo' && regra.janelaValor !== null) return String(regra.janelaValor)
  return String(tipo === 'aprovacao' ? PADROES_REGRA.janelaTempo : PADROES_TIPO[tipo].janelaTempo)
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
  tipo: TipoRegra
  regra: RegraAlerta | null
  /** Todos os postos na ordem do fluxo, com o que o perfil de cada um faz. */
  postos: PostoRegra[]
  pmosDisponiveis: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
  /**
   * O aviso EM CANAL está pronto (token do bot + DISCORD_CANAL_ID). Separado de
   * `configurados.discord`, que só olha o token e vale para a conversa privada.
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
  const janelaValor = janelaTipo === 'tempo' ? minutos : janelaTipo === 'bipes' ? bipes : null

  const oferecidos = postosOferecidos(tipo, postos, postosDaRegra)
  // Só avisa sobre o que está de fato MARCADO: desmarcado, o posto não atrapalha mais.
  const foraDoTipo = oferecidos.filter((p) => p.foraDoTipo && postosSel.includes(p.chave))

  function entrada(): EntradaRegra {
    return {
      tipo,
      nome,
      postos: postosSel,
      taxaMinima: tipo === 'aprovacao' ? taxa : '',
      janelaTipo,
      janelaValor,
      minimoBipes: tipo === 'defeito' ? '' : minimo,
      limiteTempo: tipo === 'tempo' ? limiteTempo : '',
      pausaMaxMin: tipo === 'tempo' ? pausa : '',
      limiteOcorrencias: tipo === 'defeito' ? repeticoes : '',
      lembreteMin: lembrete,
      canais: canaisSel,
      destinatarios: destSel,
      avisarPessoas,
      avisarCanal,
      pmos: pmosSel,
      ativa: regra?.ativa ?? true,
    }
  }

  function salvar() {
    // Mesma validação do servidor, antes de ir ao banco: o gestor vê o erro na hora.
    const dados = entrada()
    const v = validarRegra(dados, { canalConfigurado })
    if (!v.ok) {
      toast.error(v.erro, TOAST)
      return
    }
    startTransition(async () => {
      const r = await salvarRegraAction(regra?.id ?? null, dados)
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
      const r = await previaRegraAction({
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
          placeholder={tipo === 'tempo' ? 'Teste lento' : tipo === 'defeito' ? 'Defeito repetido no Teste' : 'Teste abaixo de 90'}
          autoComplete="off"
        />
      </div>

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
          </>
        )}
      </fieldset>

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

      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Como avisar
          <Explica titulo="Como avisar">
            <p><strong>Conversa privada do responsável</strong>: é o comportamento de sempre — cada um recebe a mensagem na conversa dele. Marcando, escolha por onde: <strong>Telegram</strong>, <strong>Discord</strong> ou os dois.</p>
            <p><strong>No canal do Discord</strong>: uma mensagem só, no canal do sistema, que todo mundo do canal vê.</p>
            <p>Dá para marcar os dois. Só no canal: ninguém recebe no privado, e os responsáveis continuam podendo apertar <strong>Resolvido</strong> ali mesmo.</p>
            <p>A mensagem no canal <strong>não marca ninguém</strong> (@here/cargo): quem não estiver com o Discord aberto pode não notar.</p>
          </Explica>
        </legend>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label="Conversa privada do responsável"
              checked={avisarPessoas}
              onChange={() => setAvisarPessoas((a) => !a)}
            />
            Conversa privada do responsável
          </label>
          {/* Telegram e Discord são sub-opções DA conversa privada: fora dela não querem dizer nada
              (o aviso em canal é sempre do Discord). Some quando a conversa privada é desmarcada. */}
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
            <p>Quem responde por este alerta. São eles que podem apertar <strong>Resolvido</strong> — junto com quem administra o ShopFloor pela tela.</p>
            <p>Só aparecem usuários ativos que podem <strong>administrar o ShopFloor</strong>. Quem perder essa permissão para de receber e de poder encerrar, mesmo continuando na regra.</p>
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
                Telegram {d.telegram ? '✓' : '—'} · Discord {d.discord ? '✓' : '—'}
              </span>
            </label>
          ))}
        </div>
        {inicioDest.descartados > 0 && (
          <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
            {inicioDest.descartados} responsável(is) inativo(s) ou sem permissão de administrar o ShopFloor removido(s)
            da regra — salve para confirmar.
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

      <PmosSelecao disponiveis={pmosDisponiveis} selecionadas={pmosSel} onChange={setPmosSel} />

      {previa && (
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
        <Button variant="outline" onClick={verPrevia} disabled={pendente}>
          Ver prévia
        </Button>
        <Button onClick={salvar} disabled={pendente} className="bg-enterplak hover:bg-enterplak-700">
          {pendente ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
