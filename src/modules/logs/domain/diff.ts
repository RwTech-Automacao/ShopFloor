export type CampoDiff = { campo: string; de: unknown; para: unknown }

export function calcularDiff(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
  campos: string[],
): CampoDiff[] {
  const diffs: CampoDiff[] = []
  for (const campo of campos) {
    if (antes[campo] !== depois[campo]) {
      diffs.push({ campo, de: antes[campo], para: depois[campo] })
    }
  }
  return diffs
}
