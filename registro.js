// registro.js - l'orecchio della protesi mentale.
// Claude Code lo chiama a ogni messaggio che Whyed scrive (hook UserPromptSubmit).
// Riceve il JSON sullo stdin e salva testo e orario in protesi.db. Non parla mai,
// non blocca mai: qualunque cosa succeda esce con 0, cosi' la sessione non si accorge di niente.
'use strict';
const { apriDb, adesso, log } = require('./comune');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => raw += d);
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(raw || '{}');
    const testo = String(j.prompt || '').trim();
    // comandi slash e roba vuota non sono cose che pensa lui
    if (!testo || testo.startsWith('/') || testo.startsWith('This session is being continued')) return process.exit(0);
    const db = apriDb();
    db.prepare('INSERT OR IGNORE INTO messaggi (ts, sessione, cwd, fonte, testo) VALUES (?, ?, ?, ?, ?)')
      .run(adesso(), j.session_id || null, j.cwd || null, 'hook', testo);
    db.close();
  } catch (e) { log('registro: ' + e.message); }
  process.exit(0);
});
setTimeout(() => process.exit(0), 4000); // mai restare appesi
