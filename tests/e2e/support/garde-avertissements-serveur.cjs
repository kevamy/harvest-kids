// Preloaded in the e2e web server (NODE_OPTIONS=--require, scripts/serveur-e2e.mjs). A query
// sent on a pg connection already busy with another one is queued by pg 8 and refused by
// pg 9: the warning is marked in the server log, and the run fails at its end
// (garde-avertissements.ts). pg emits it once per process.
process.on("warning", (avertissement) => {
  if (/client is already executing a query/.test(avertissement.message)) {
    process.stderr.write(`HK-GARDE-PG ${avertissement.stack}\n`);
  }
});
