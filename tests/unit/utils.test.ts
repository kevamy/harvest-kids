import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("garde une taille et une couleur de texte du design system ensemble", () => {
    expect(cn("text-matricule", "text-nuit")).toBe("text-matricule text-nuit");
    expect(cn("text-body-lg text-texte-doux")).toBe("text-body-lg text-texte-doux");
  });

  it("résout les conflits entre tailles du design system", () => {
    expect(cn("text-body", "text-h2")).toBe("text-h2");
    expect(cn("bg-bleu", "bg-rose-fonce")).toBe("bg-rose-fonce");
  });
});
