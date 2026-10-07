/**
 * FONTE ÚNICA das mensagens que a tela embutida manda pro Dashboard (spec A6).
 *
 * A tela do Fluxo vive dentro de um iframe no Dashboard Enterplak. O pai precisa saber se o
 * iframe carregou, se a sessão caiu ou se o acesso foi recusado — e descobre isso por
 * `window.parent.postMessage`.
 *
 * ⚠️ O `targetOrigin` é SEMPRE a origem do dashboard, lida do ambiente, e NUNCA `'*'`: com `'*'`
 * qualquer página que nos embutisse receberia o aviso (e saberia, por exemplo, que existe sessão).
 * Sem a variável configurada não existe alvo seguro → não se manda mensagem nenhuma.
 *
 * Duas implementações do mesmo contrato é a família de defeito que este arquivo existe pra evitar:
 * a forma da mensagem, a origem e a regra do "sem origem, nada" ficam SÓ aqui. Quem renderiza em
 * React usa `EmbedPonte` (`src/app/embed/embed-ponte.tsx`); a página de erro do `/embed/sso` é HTML
 * cru montado num Route Handler (não tem React pra montar) e usa `scriptPonteEmbed` daqui.
 */

export type TipoMensagemEmbed = 'sf-embed:ready' | 'sf-embed:login-required' | 'sf-embed:error'

/**
 * Códigos de `sf-embed:error`. A spec A6 lista `forbidden`, `op-not-found` e `inactive`;
 * `expirado` é o do `/embed/sso` quando o token do dashboard venceu (`CodigoSsoDashboard`).
 */
export type CodigoErroEmbed = 'forbidden' | 'op-not-found' | 'inactive' | 'expirado'

export interface MensagemEmbed {
  type: TipoMensagemEmbed
  code?: CodigoErroEmbed
}

/** Origem do dashboard (env). Vazio = não configurada = não existe alvo seguro pro postMessage. */
export function origemDashboard(): string {
  return process.env.DASHBOARD_ORIGIN ?? ''
}

/** A mensagem em si. Sem código, a chave `code` nem aparece (o pai só a lê nos erros). */
export function mensagemEmbed(tipo: TipoMensagemEmbed, codigo?: CodigoErroEmbed | null): MensagemEmbed {
  return codigo ? { type: tipo, code: codigo } : { type: tipo }
}

/** JSON dentro de `<script>`: o `<` escapado impede que um valor com `</script>` feche a tag. */
const paraScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

/**
 * A ponte como `<script>` inline, pra quem responde HTML cru (a página de erro do `/embed/sso`).
 * Devolve string VAZIA quando não há origem configurada — mesma regra do componente.
 */
export function scriptPonteEmbed(
  tipo: TipoMensagemEmbed,
  codigo: CodigoErroEmbed | null,
  origem: string = origemDashboard(),
): string {
  if (origem === '') return ''
  return `<script>try{window.parent.postMessage(${paraScript(mensagemEmbed(tipo, codigo))},${paraScript(origem)})}catch(e){}</script>`
}
