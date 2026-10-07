import { describe, expect, it } from "vitest";
import { frameAncestorsEmbed } from "../frame-ancestors";

const D = "https://dashboard.enterplak.com.br";

describe("frameAncestorsEmbed", () => {
  it("origem única", () => {
    expect(frameAncestorsEmbed({ EMBED_FRAME_ANCESTORS: D })).toBe(D);
  });
  it("duas origens", () => {
    expect(frameAncestorsEmbed({ EMBED_FRAME_ANCESTORS: `${D} https://preview.vercel.app` })).toBe(
      `${D} https://preview.vercel.app`,
    );
  });
  it("EMBED_FRAME_ANCESTORS vence DASHBOARD_ORIGIN", () => {
    expect(
      frameAncestorsEmbed({ EMBED_FRAME_ANCESTORS: "https://a.com", DASHBOARD_ORIGIN: D }),
    ).toBe("https://a.com");
  });
  it("só DASHBOARD_ORIGIN", () => {
    expect(frameAncestorsEmbed({ DASHBOARD_ORIGIN: D })).toBe(D);
  });
  it("EMBED vazio cai para DASHBOARD_ORIGIN", () => {
    expect(frameAncestorsEmbed({ EMBED_FRAME_ANCESTORS: "", DASHBOARD_ORIGIN: D })).toBe(D);
    expect(frameAncestorsEmbed({ EMBED_FRAME_ANCESTORS: "   ", DASHBOARD_ORIGIN: D })).toBe(D);
  });
  it("os dois vazios/ausentes → 'self' (fecha, não abre)", () => {
    expect(frameAncestorsEmbed({})).toBe("'self'");
    expect(frameAncestorsEmbed({ EMBED_FRAME_ANCESTORS: "", DASHBOARD_ORIGIN: "" })).toBe("'self'");
  });
  it("os dois só com espaços → 'self'", () => {
    expect(frameAncestorsEmbed({ EMBED_FRAME_ANCESTORS: "  ", DASHBOARD_ORIGIN: " \t " })).toBe("'self'");
  });
  it("apara e normaliza espaços", () => {
    expect(frameAncestorsEmbed({ EMBED_FRAME_ANCESTORS: `  ${D}   https://b.com  ` })).toBe(
      `${D} https://b.com`,
    );
  });
  it("nunca devolve curinga por omissão", () => {
    expect(frameAncestorsEmbed({})).not.toContain("*");
  });
});
