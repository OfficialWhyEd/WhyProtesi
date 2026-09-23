// importa-sessioni.js - legge tutte le sessioni salvate di Claude Code e mette nel database
// ogni messaggio scritto da Whyed, con l'orario. Serve per l'analisi degli orari e per non
// partire da zero. I messaggi importati sono segnati "analizzato": la lista di quei giorni
// e' gia' stata fatta a mano, non va rifatta.
'use strict';
const fs = require('fs');
const path = require('path');
const { apriDb, log } = require('./comune');

const CARTELLE = [require('path').join(require('os').homedir(), '.claude', 'projects')];

function testoUtente(j) {
  if (j.type !== 'user' || j.isMeta) return null;
  const c = j.message && j.message.content;
  const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('\n') : '';
  const s = t.trim();
  if (!s || s.startsWith('<') || s.startsWith('/') || s.startsWith('This session is being continued')) return null; // tool_result, comandi, riassunti automatici
  return s;
}

const db = apriDb();
const ins = db.prepare('INSERT OR IGNORE INTO messaggi (ts, sessione, cwd, fonte, testo, analizzato) VALUES (?, ?, ?, ?, ?, 1)');
let file = 0, nuovi = 0;
for (const base of CARTELLE) {
  if (!fs.existsSync(base)) continue;
  for (const prog of fs.readdirSync(base)) {
    const dir = path.join(base, prog);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.jsonl'))) {
      file++;
      for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        if (!l.includes('"type":"user"')) continue;
        let j; try { j = JSON.parse(l); } catch { continue; }
        const t = testoUtente(j); if (!t) continue;
        const r = ins.run(j.timestamp, j.sessionId || f.replace('.jsonl', ''), j.cwd || null, 'import', t);
        nuovi += r.changes;
      }
    }
  }
}
const tot = db.prepare('SELECT COUNT(*) n FROM messaggi').get().n;
db.close();
console.log('file letti ' + file + ', messaggi nuovi ' + nuovi + ', totale nel database ' + tot);
log('importa-sessioni: file ' + file + ', nuovi ' + nuovi + ', totale ' + tot);
