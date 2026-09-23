// orari.js - quando scrive Whyed, e quando no.
// Legge protesi.db e tira fuori le ore di punta, i giorni, i buchi lunghi e le sessioni,
// cosi' le cose da fare si possono mettere negli orari giusti per lui.
//
//   node orari.js            stampa il quadro e scrive dati/orari.md
//   node orari.js --giorni 14   solo gli ultimi 14 giorni
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./comune');

const args = process.argv.slice(2);
const gi = args.indexOf('--giorni');
const GIORNI = gi >= 0 ? Number(args[gi + 1]) || 30 : 0;

const db = C.apriDb();
const da = GIORNI ? new Date(Date.now() - GIORNI * 86400000).toISOString() : '0000';
const righe = db.prepare('SELECT ts, sessione FROM messaggi WHERE ts >= ? ORDER BY ts').all(da);
db.close();
if (!righe.length) { console.log('nessun messaggio'); process.exit(0); }

// tutto in ora di Roma
const loc = iso => new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
const GIORNO = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

const perOra = new Array(24).fill(0);
const perGiorno = new Array(7).fill(0);
const perData = {};
const sessioni = {};
let prev = null; const buchi = [];
for (const r of righe) {
  const d = loc(r.ts);
  perOra[d.getHours()]++;
  perGiorno[d.getDay()]++;
  const k = d.toISOString().slice(0, 10); perData[k] = (perData[k] || 0) + 1;
  const s = sessioni[r.sessione] || (sessioni[r.sessione] = { inizio: d, fine: d, n: 0 });
  s.fine = d; s.n++;
  if (prev) { const ore = (d - prev) / 3600000; if (ore >= 8) buchi.push({ da: prev, a: d, ore }); }
  prev = d;
}
const tot = righe.length;
const primo = loc(righe[0].ts), ultimo = loc(righe[tot - 1].ts);
const giorniAttivi = Object.keys(perData).length;
const giorniTot = Math.max(1, Math.round((ultimo - primo) / 86400000) + 1);

// fasce: notte 0-6, mattina 6-12, pomeriggio 12-18, sera 18-24
const fasce = { 'notte (0-6)': 0, 'mattina (6-12)': 0, 'pomeriggio (12-18)': 0, 'sera (18-24)': 0 };
perOra.forEach((n, h) => { fasce[h < 6 ? 'notte (0-6)' : h < 12 ? 'mattina (6-12)' : h < 18 ? 'pomeriggio (12-18)' : 'sera (18-24)'] += n; });

// ore di punta: le 5 ore con piu' messaggi
const punta = perOra.map((n, h) => ({ h, n })).sort((a, b) => b.n - a.n).slice(0, 5);
// ore morte: ore in cui non scrive quasi mai (sotto il 20% della media)
const media = tot / 24;
const morte = perOra.map((n, h) => ({ h, n })).filter(x => x.n < media * 0.2).map(x => x.h);
function intervalli(ore) { // [1,2,3,9,10] -> "1-3, 9-10"
  const out = []; let i = 0;
  while (i < ore.length) { let j = i; while (j + 1 < ore.length && ore[j + 1] === ore[j] + 1) j++; out.push(ore[i] === ore[j] ? String(ore[i]) : ore[i] + '-' + (ore[j] + 1)); i = j + 1; }
  return out.join(', ');
}

// blocchi di lavoro: messaggi a meno di 45 minuti l'uno dall'altro (la sessione di Claude
// puo' durare giorni, il blocco e' il tempo vero passato a scrivere)
const blocchi = []; let b = null;
for (const r of righe) {
  const d = loc(r.ts);
  if (!b || (d - b.fine) > 45 * 60000) { b = { inizio: d, fine: d, n: 1 }; blocchi.push(b); }
  else { b.fine = d; b.n++; }
}
const ss = blocchi.filter(s => s.n >= 2);
const durate = ss.map(s => (s.fine - s.inizio) / 60000);
const durMedia = durate.length ? durate.reduce((a, b) => a + b, 0) / durate.length : 0;
const durMax = durate.length ? Math.max(...durate) : 0;

const barra = (n, max, w = 30) => '#'.repeat(Math.round(n / max * w)).padEnd(w);
const maxOra = Math.max(...perOra), maxG = Math.max(...perGiorno);

let out = '# Gli orari di Whyed\n\n';
out += '_' + C.oraIt() + '. ' + tot + ' messaggi dal ' + primo.toLocaleDateString('it-IT') + ' al ' + ultimo.toLocaleDateString('it-IT') +
  ' (' + giorniAttivi + ' giorni su ' + giorniTot + ' in cui ha scritto)._\n\n';
out += '## In breve\n';
out += '- ore di punta: ' + punta.map(x => x.h + ':00 (' + x.n + ')').join(', ') + '\n';
out += '- ore in cui non scrive quasi mai: ' + (intervalli(morte) || 'nessuna') + '\n';
const fasceOrd = Object.entries(fasce).sort((a, b) => b[1] - a[1]);
out += '- fascia preferita: ' + fasceOrd[0][0] + ' (' + Math.round(fasceOrd[0][1] / tot * 100) + '%), poi ' + fasceOrd[1][0] + ' (' + Math.round(fasceOrd[1][1] / tot * 100) + '%)\n';
const gOrd = perGiorno.map((n, i) => ({ g: GIORNO[i], n })).sort((a, b) => b.n - a.n);
out += '- giorni piu' + "'" + ' attivi: ' + gOrd.slice(0, 3).map(x => x.g + ' (' + x.n + ')').join(', ') + '; meno: ' + gOrd.slice(-2).map(x => x.g + ' (' + x.n + ')').join(', ') + '\n';
out += '- blocchi di lavoro (pause sotto i 45 min): ' + ss.length + ', durata media ' + Math.round(durMedia) + ' min, la piu' + "'" + ' lunga ' + Math.round(durMax / 60) + ' h\n';
out += '- messaggi al giorno (quando scrive): ' + (tot / giorniAttivi).toFixed(1) + '\n';
out += '\n## Per ora del giorno\n```\n';
perOra.forEach((n, h) => { out += String(h).padStart(2, '0') + ':00 ' + barra(n, maxOra) + ' ' + n + '\n'; });
out += '```\n\n## Per giorno della settimana\n```\n';
[1, 2, 3, 4, 5, 6, 0].forEach(i => { out += GIORNO[i] + ' ' + barra(perGiorno[i], maxG) + ' ' + perGiorno[i] + '\n'; });
out += '```\n\n## Buchi lunghi (8 ore o piu' + "'" + ' senza scrivere), ultimi 15\n';
for (const b of buchi.slice(-15)) out += '- ' + b.da.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' -> ' + b.a.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '  (' + Math.round(b.ore) + ' h)\n';
out += '\n## Ultimi 14 giorni (messaggi al giorno)\n```\n';
Object.keys(perData).sort().slice(-14).forEach(k => { const d = new Date(k); out += k.slice(5) + ' ' + GIORNO[d.getDay()] + ' ' + barra(perData[k], Math.max(...Object.values(perData)), 40) + ' ' + perData[k] + '\n'; });
out += '```\n';

fs.writeFileSync(path.join(C.DATI, 'orari.md'), out, 'utf8');
console.log(out);
