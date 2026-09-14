/**
 * Bipe de erro para a tela de Lançamento.
 *
 * Toca quando a peça NÃO foi gravada. No chão de fábrica o operador olha a peça e o coletor, não a
 * tela — um lançamento recusado passa despercebido e a peça segue para o próximo posto sem
 * registro. O som é o que alcança quem não está olhando.
 *
 * Sintetizado com Web Audio em vez de um arquivo: não tem asset pra baixar (nem falhar de baixar),
 * funciona com a rede caindo, e não entra binário no repositório.
 *
 * Só toca depois de o operador ter interagido com a página — o que sempre acontece, porque bipar é
 * a interação. Navegador que bloqueie ou não suporte simplesmente não toca; o aviso na tela continua.
 */

let contexto: AudioContext | null = null

/** Um AudioContext por aba, criado no primeiro uso. Criar um por bipe vaza — o navegador tem teto. */
function obterContexto(): AudioContext | null {
  if (contexto) return contexto
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    contexto = new Ctor()
    return contexto
  } catch {
    return null
  }
}

/** Dois tons graves curtos — leitura imediata de "deu errado", sem parecer alarme de incêndio. */
export function tocarErro(): void {
  const ctx = obterContexto()
  if (!ctx) return
  try {
    // A aba pode ter suspendido o contexto (segundo plano). Retomar é barato e falha em silêncio.
    if (ctx.state === 'suspended') void ctx.resume()
    const agora = ctx.currentTime
    for (const [i, hz] of [220, 165].entries()) {
      const osc = ctx.createOscillator()
      const vol = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = hz
      const ini = agora + i * 0.16
      // Rampa em vez de liga/desliga: corte seco vira um "clique" audível no alto-falante.
      vol.gain.setValueAtTime(0, ini)
      vol.gain.linearRampToValueAtTime(0.18, ini + 0.01)
      vol.gain.linearRampToValueAtTime(0, ini + 0.14)
      osc.connect(vol).connect(ctx.destination)
      osc.start(ini)
      osc.stop(ini + 0.15)
    }
  } catch {
    // Som é acessório: nunca pode derrubar o lançamento, que é o que realmente importa.
  }
}
