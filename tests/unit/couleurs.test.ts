import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COULEURS_HORS_CSS } from "@/lib/couleurs";

const tokens = readFileSync(join(process.cwd(), "design", "tokens.css"), "utf8");

describe("couleurs hors CSS", () => {
  it.each(Object.entries(COULEURS_HORS_CSS))("%s correspond à design/tokens.css", (nom, hex) => {
    const match = new RegExp(`--color-${nom}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
    expect(match?.[1]?.toLowerCase()).toBe(hex);
  });
});
