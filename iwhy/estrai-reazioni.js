// estrai-reazioni.js - il materiale per addestrare iWhy, tutto in locale.
// Legge le sessioni salvate di Claude Code in ordine di tempo e tira fuori le coppie
//   [cosa aveva appena fatto/detto Claude]  ->  [come ha reagito Whyed]
// Quello e' il rinforzo: dove ha detto si', dove si e' arrabbiato, dove ha corretto.
// Scrive iwhy/corpus/reazioni.md (tutte) e iwhy/corpus/segnali-forti.md (solo quelle con un segnale
// chiaro: rabbia, approvazione, correzione). Nessun modello: le legge Claude quando lo allena.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = require('path').join(require('os').homedir(), '.claude', 'projects', 'C--Users-' + require('os').userInfo().username);
const OUT = path.join(__dirname, 'corpus');
const NEG = /\b(fanculo|cazzo|merda|porc|dio\s?c|mannaggia|sbagliat|non funziona|non va|tutto sbagliato|non mi convince|ma ti muovi|stanco|lazy|di testa tua|brutto|schifo|terrificante|perdi|bruciat|token)\b/i;
const POS = /\b(perfetto|bravo|grazie|wow|top|fighissim|bellissim|esatto|ottimo|mi piace|si perfetto|ci sei quasi|scusa se ti ho sottovalutato)\b/i;
const CORR = /\b(no,? |no non|non cosi|non e' quello|non era quello|ti ho detto|te l'ho detto|avevo detto|intendevo|volevo dire|rifai|rimetti|torna)\b/i;

function testo(c) { return typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('\n') : ''; }
function it(iso) { return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour12: false }).slice(0, 17); }

const file = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).map(f => ({ f, t: fs.statSync(path.join(DIR, f)).birthtimeMs })).sort((a, b) => a.t - b.t);
let tutte = '', forti = '', nTot = 0, nForti = 0;
for (const { f } of file) {
  let ultimaClaude = ''; let intestato = false;
  for (const l of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
    if (!l.includes('"type":"assistant"') && !l.includes('"type":"user"')) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type === 'assistant') { const t = testo(j.message && j.message.content).trim(); if (t) ultimaClaude = t; continue; }
    if (j.type !== 'user' || j.isMeta) continue;
    const u = testo(j.message && j.message.content).trim();
    if (!u || u.startsWith('<') || u.startsWith('/') || u.startsWith('This session is being continued') || u.startsWith('[Request interrupted')) continue;
    if (!ultimaClaude) continue; // primo messaggio della sessione: niente reazione
    const coppia = '### ' + it(j.timestamp) + '\n**Claude:** ' + ultimaClaude.replace(/\s+/g, ' ').slice(0, 350) + '\n**Whyed:** ' + u.replace(/\s+/g, ' ').slice(0, 500) + '\n\n';
    if (!intestato) { tutte += '\n## Sessione ' + f.slice(0, 8) + '\n\n'; intestato = true; }
    tutte += coppia; nTot++;
    const seg = NEG.test(u) ? 'RABBIA/NO' : CORR.test(u) ? 'CORREZIONE' : POS.test(u) ? 'SI/APPROVA' : null;
    if (seg) { forti += '### [' + seg + '] ' + coppia.slice(4); nForti++; }
    ultimaClaude = '';
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'reazioni.md'), '# Reazioni: cosa ha fatto Claude -> come ha reagito Whyed\n' + tutte, 'utf8');
fs.writeFileSync(path.join(OUT, 'segnali-forti.md'), '# Segnali forti (rabbia, correzioni, approvazioni)\n\n' + forti, 'utf8');
console.log('coppie: ' + nTot + ', con segnale forte: ' + nForti + ' -> ' + OUT);
