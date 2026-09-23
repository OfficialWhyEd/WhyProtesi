// registra.js - il registro di iWhy: ogni risposta che iWhy da' al posto di Whyed finisce qui,
// cosi' lui controlla "come Claude usa se stesso" e corregge. Le correzioni pesano piu' del profilo.
//
//   node registra.js "domanda che Claude avrebbe fatto" "risposta di iWhy" "punto del profilo"
//   node registra.js --chiedere "domanda"              cosa iWhy NON ha voluto decidere (per lui)
//   node registra.js --correzione N "cosa avrebbe detto lui"   lui corregge la risposta numero N
//   node registra.js lista                             le ultime 30 righe
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'risposte.md');
const ora = () => new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour12: false });
const args = process.argv.slice(2);

function leggi() { try { return fs.readFileSync(FILE, 'utf8'); } catch (_) { return '# Registro di iWhy\n\n_Ogni riga: cosa Claude avrebbe chiesto, cosa ha risposto iWhy al posto di Whyed, e perche\'. Lui corregge con `registra.js --correzione N "..."`._\n\n'; }
}
function prossimo(t) { const m = t.match(/^\d+(?=\.\s)/gm); return m ? Math.max(...m.map(Number)) + 1 : 1; }

let t = leggi();
if (args[0] === 'lista') { console.log(t.split('\n').slice(-30).join('\n')); process.exit(0); }

if (args[0] === '--chiedere') {
  const n = prossimo(t);
  t += n + '. [' + ora() + '] **DA CHIEDERE A LUI**: ' + (args[1] || '') + '\n';
} else if (args[0] === '--correzione') {
  const n = Number(args[1]); const testo = args[2] || '';
  if (!n || !testo) { console.log('serve: --correzione N "testo"'); process.exit(1); }
  const righe = t.split('\n');
  const i = righe.findIndex(r => r.startsWith(n + '. '));
  if (i < 0) { console.log('risposta ' + n + ' non trovata'); process.exit(1); }
  // la correzione va in fondo alla voce, non in mezzo: cerco la riga della voce dopo
  let j = i + 1; while (j < righe.length && !/^\d+\.\s/.test(righe[j])) j++;
  righe.splice(j, 0, '   -> **CORREZIONE DI WHYED** [' + ora() + ']: ' + testo);
  t = righe.join('\n');
} else {
  const [domanda, risposta, motivo] = args;
  if (!domanda || !risposta) { console.log('serve: "domanda" "risposta" ["motivo"]'); process.exit(1); }
  const n = prossimo(t);
  t += n + '. [' + ora() + '] **Claude avrebbe chiesto:** ' + domanda + '\n   **iWhy:** ' + risposta + (motivo ? '\n   _(' + motivo + ')_' : '') + '\n';
}
fs.writeFileSync(FILE, t, 'utf8');
console.log('OK registrato in ' + FILE);
