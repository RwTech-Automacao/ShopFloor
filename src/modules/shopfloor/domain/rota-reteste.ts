/**
 * Rota de reteste: o posto que alguém escolheu em "Depois da Manutenção, passar por" (0102).
 *
 * A peça reprovada no posto A vai pra Manutenção, é reparada, e repassa por B antes de voltar.
 * Aqui a pergunta é a INVERSA — dado o posto onde o operador está bipando, alguém aponta pra ele?
 * Se sim, é ali que a confirmação dos consertos da Manutenção faz sentido.
 *
 * Função pura de propósito: quem monta o conjunto é o repositório, e essa separação é o que permite
 * decidir no CLIENTE se vale chamar o servidor — nos postos que não são destino, nenhuma chamada
 * a mais acontece.
 */
export function postoEhDestinoDeRota(posto: string, destinos: ReadonlySet<string>): boolean {
  if (posto === '') return false
  return destinos.has(posto)
}

/**
 * Um conserto registrado pela Manutenção, do jeito que o operador precisa ver pra confirmar.
 *
 * Mora no DOMÍNIO, e não na infra nem na ação, por um motivo prático: a tela precisa do tipo, e
 * `lancar-action.ts` é `'use server'` — um módulo assim só pode exportar funções async, e um tipo
 * exportado de lá derruba o `next build` sem que o tsc ou o eslint avisem. O domínio é puro e
 * seguro de importar de qualquer camada.
 */
export interface ConsertoConfirmavel {
  conserto: string
  posicao: string
}
