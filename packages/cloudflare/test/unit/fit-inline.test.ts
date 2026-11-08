import { describe, expect, it } from "vitest";
import { fitInline } from "../../src/store";

const MAX = 1_500_000;
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("fitInline (bodies kept in D1 when R2 is off)", () => {
  it("keeps small bodies untouched", () => {
    expect(fitInline("привет", "<b>hi</b>", MAX)).toEqual(["привет", "<b>hi</b>"]);
  });

  it("trims a huge Cyrillic text and keeps a small html", () => {
    const html = "<p>x</p>";
    const [t, h] = fitInline("я".repeat(1_000_000), html, MAX);
    expect(h).toBe(html);
    expect(bytes(t) + bytes(h)).toBeLessThanOrEqual(MAX);
    expect(t).toContain("обрезан");
  });

  it("trims a huge html and keeps a small text", () => {
    const [t, h] = fitInline("short", "<p>" + "ж".repeat(2_000_000), MAX);
    expect(t).toBe("short");
    expect(bytes(t) + bytes(h)).toBeLessThanOrEqual(MAX);
  });

  it("trims both when both are big", () => {
    const [t, h] = fitInline("ф".repeat(900_000), "ц".repeat(900_000), MAX);
    expect(bytes(t) + bytes(h)).toBeLessThanOrEqual(MAX);
    expect(t.length).toBeGreaterThan(0);
    expect(h.length).toBeGreaterThan(0);
  });

  it("never leaves a broken multi-byte character at the cut", () => {
    const [t] = fitInline("😀".repeat(500_000), "", MAX);
    expect(t).not.toMatch(/�/);
    expect(bytes(t)).toBeLessThanOrEqual(MAX);
  });
});
