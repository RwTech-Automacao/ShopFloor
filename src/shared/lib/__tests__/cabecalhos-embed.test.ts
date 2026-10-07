import { afterEach, describe, expect, it, vi } from "vitest";

// Regras do headers() do Next: a ÚLTIMA regra que casa a mesma chave vence (docs: Header Overriding).
async function cspDe(caminho: string): Promise<string[]> {
  vi.resetModules();
  const cfg = (await import("../../../../next.config")).default;
  const regras = await cfg.headers!();
  const casa = (src: string) => {
    if (src === "/:path*") return true;
    if (src === "/embed/:path*") return caminho === "/embed" || caminho.startsWith("/embed/");
    throw new Error(`regra inesperada: ${src}`);
  };
  const valores: string[] = [];
  for (const r of regras) {
    if (!casa(r.source)) continue;
    const h = r.headers.find((x) => x.key === "Content-Security-Policy");
    if (h) valores.push(h.value);
  }
  return valores;
}

afterEach(() => vi.unstubAllEnvs());

describe("headers() do next.config", () => {
  it("/embed: a última regra (efetiva) libera o dashboard", async () => {
    vi.stubEnv("DASHBOARD_ORIGIN", "https://dashboard.enterplak.com.br");
    vi.stubEnv("EMBED_FRAME_ANCESTORS", "");
    const v = await cspDe("/embed/fluxo/1/2");
    expect(v.at(-1)).toBe("frame-ancestors https://dashboard.enterplak.com.br");
  });
  it("EMBED_FRAME_ANCESTORS vence DASHBOARD_ORIGIN na regra", async () => {
    vi.stubEnv("DASHBOARD_ORIGIN", "https://dashboard.enterplak.com.br");
    vi.stubEnv("EMBED_FRAME_ANCESTORS", "https://preview.exemplo.app");
    expect((await cspDe("/embed/x")).at(-1)).toBe("frame-ancestors https://preview.exemplo.app");
  });
  it("sem env, /embed fecha em 'self'", async () => {
    vi.stubEnv("DASHBOARD_ORIGIN", "");
    vi.stubEnv("EMBED_FRAME_ANCESTORS", "");
    expect((await cspDe("/embed/x")).at(-1)).toBe("frame-ancestors 'self'");
  });
  it("resto do site: 'self' e nunca a origem do dashboard", async () => {
    vi.stubEnv("DASHBOARD_ORIGIN", "https://dashboard.enterplak.com.br");
    for (const p of ["/login", "/shopfloor/fluxo", "/embedx", "/"]) {
      expect(await cspDe(p)).toEqual(["frame-ancestors 'self'"]);
    }
  });
  it("a regra de /embed vem DEPOIS da geral (precedência: última vence)", async () => {
    vi.stubEnv("DASHBOARD_ORIGIN", "https://dashboard.enterplak.com.br");
    const v = await cspDe("/embed/a");
    expect(v).toHaveLength(2);
    expect(v[0]).toBe("frame-ancestors 'self'");
  });
});
