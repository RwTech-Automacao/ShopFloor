/**
 * Código de vínculo: `ALERTA-XXXX`. A pessoa gera em "Meu perfil" e manda pro bot; aceitamos o
 * código no meio de qualquer frase porque é assim que as pessoas escrevem no chat.
 * O alfabeto do banco evita I/O/0/1, mas aqui aceitamos qualquer letra/dígito e deixamos o banco
 * decidir (CODIGO_INVALIDO) — errar a letra não pode virar "não entendi".
 */
const RE_CODIGO = /ALERTA-([A-Z0-9]{4})(?![A-Z0-9])/i

export function extrairCodigoVinculo(texto: string | null | undefined): string | null {
  const m = RE_CODIGO.exec(texto ?? '')
  return m ? `ALERTA-${m[1]!.toUpperCase()}` : null
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Payload do botão. Curto de propósito: `callback_data` do Telegram tem limite de 64 bytes. */
export function montarCallbackResolver(ocorrenciaId: string): string {
  return `r:${ocorrenciaId}`
}

export function lerCallbackResolver(dado: string | null | undefined): string | null {
  if (!dado || !dado.startsWith('r:')) return null
  const id = dado.slice(2)
  return RE_UUID.test(id) ? id.toLowerCase() : null
}
