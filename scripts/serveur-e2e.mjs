// Starts the e2e web server and copies its output to HK_JOURNAL_SERVEUR, so that
// tests can check that no secret ever reaches the server logs.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

const journal = process.env.HK_JOURNAL_SERVEUR;
if (!journal) throw new Error("HK_JOURNAL_SERVEUR est obligatoire.");

const fichier = createWriteStream(journal, { flags: "w" });
// stdin is passed through untouched, exactly as when Playwright runs the command itself.
const serveur = spawn(process.argv.slice(2).join(" "), {
  shell: true,
  stdio: ["inherit", "pipe", "pipe"],
});
for (const [source, sortie] of [
  [serveur.stdout, process.stdout],
  [serveur.stderr, process.stderr],
]) {
  source.on("data", (morceau) => {
    sortie.write(morceau);
    fichier.write(morceau);
  });
}
serveur.on("exit", (code) => {
  fichier.end();
  process.exit(code ?? 0);
});
