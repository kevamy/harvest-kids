import { describe, expect, it } from "vitest";
import { estMatricule, formatMatricule } from "@/lib/matricule";

describe("formatMatricule (RG-01)", () => {
  it("complète à 4 chiffres", () => {
    expect(formatMatricule(1)).toBe("HK-0001");
    expect(formatMatricule(427)).toBe("HK-0427");
    expect(formatMatricule(9999)).toBe("HK-9999");
  });

  it("passe à 5 chiffres au-delà de 9999", () => {
    expect(formatMatricule(10_000)).toBe("HK-10000");
  });

  it.each([0, -1, 1.5, 100_000, Number.NaN])("refuse %s", (n) => {
    expect(() => formatMatricule(n)).toThrow(RangeError);
  });
});

describe("estMatricule", () => {
  it.each(["HK-0001", "HK-9999", "HK-10000"])("accepte %s", (m) => {
    expect(estMatricule(m)).toBe(true);
  });

  it.each(["HK-001", "HK-01234", "hk-0001", "HK-0001 ", "HKF1.abc", ""])("refuse %s", (m) => {
    expect(estMatricule(m)).toBe(false);
  });
});
