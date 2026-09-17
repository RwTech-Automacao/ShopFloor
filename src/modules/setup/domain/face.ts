export type Face = 'TOP' | 'BOT' | 'TOP E BOT'
export const FACES: Face[] = ['TOP', 'BOT', 'TOP E BOT']

/** TOP, BOT ou TOP E BOT ("BOT E TOP" vira "TOP E BOT"). Outro texto → null. Espelha st_face (0112). */
export function normalizarFace(face: string): Face | null {
  const f = (face ?? '').toString().trim().toUpperCase().replace(/\s+/g, ' ')
  if (f === 'TOP' || f === 'BOT') return f
  if (f === 'TOP E BOT' || f === 'BOT E TOP') return 'TOP E BOT'
  return null
}

export function facesSobrepoem(a: Face, b: Face): boolean {
  return a === b || a === 'TOP E BOT' || b === 'TOP E BOT'
}
