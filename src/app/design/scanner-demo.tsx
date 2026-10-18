"use client";

import { useState } from "react";
import { Scanner } from "@/components/hk/scanner";

export function ScannerDemo() {
  const [dernier, setDernier] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      <Scanner onScan={setDernier} />
      <p role="status" className="text-label text-texte-doux">
        {dernier ? `Code lu : ${dernier}` : "Aucun code lu pour l'instant."}
      </p>
    </div>
  );
}
