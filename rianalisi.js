// rianalisi.js - il secondo sguardo, una volta al giorno (task alle 06:00, quando lui dorme).
// Il guardiano legge i messaggi a pezzi di 12 e in fretta; qui si rilegge UNA GIORNATA INTERA
// con calma: le cose dette di sfuggita e ripetute, le decisioni prese, i temi e le ore, e come
// ragiona (per iWhy). Poi rifa' lo SCHEMA di tutto (dati/schema.md) e il quadro degli orari.
//
//   node rianalisi.js                 rianalizza i giorni non ancora fatti (fino a ieri, max 7)
//   node rianalisi.js --giorno 2026-09-17   un giorno preciso, anche oggi
//   node rianalisi.js --secco         non tocca lista, database e file
//   node rianalisi.js --solo-schema   rifa' solo schema.md e orari.md
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('./comune');
const L = require('./lista');

const args = process.argv.slice(2);
const SECCO = args.includes('--secco');
const SOLO_SCHEMA = args.includes('--solo-schema');
const gi = args.indexOf('--giorno');
const GIORNO = gi >= 0 ? args[gi + 1] : null;
const DIR_GIORNI = path.join(C.DATI, 'giorni');
const DIR_IWHY = path.join(__dirname, 'iwhy');
const LOCK = path.join(C.DATI, 'rianalisi.lock');

// giorno di Roma di un ISO UTC
function giornoRoma(iso) { return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }); }
function oraRoma(iso) { return new Date(iso).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }); }
function ieri() { return giornoRoma(new Date(Date.now() - 86400000).toISOString()); }

const SISTEMA_GIORNO = `Sei la parte lenta della protesi mentale di Whyed, produttore musicale e creatore di
progetti software con Claude Code. Scrive di getto con errori. Ricevi TUTTI i
messaggi che ha scritto a Claude in UNA giornata (in ordine, con l'ora), la LISTA dei lavori e i CANDIDATI che il
guardiano veloce ha tenuto da parte come "forse".

Fai quattro cose, senza inventare e citando le sue parole quando servono:
1. "temi": su cosa ha lavorato, con le ore (es. "14:00-16:30 widget"). Massimo 8.
2. "decisioni": regole, preferenze, scelte che ha espresso e che valgono anche domani ("mai X", "voglio sempre Y",
   "questo si fa cosi'"). Frase corta + citazione. Solo cose dette da lui, non da Claude. Massimo 10.
3. "sfuggite": COSE DA FARE che nella giornata sono uscite di sfuggita o ripetute e che NON sono in lista.
   Il guardiano veloce guarda 12 messaggi alla volta: tu vedi tutta la giornata, quindi noti le cose ripetute
   o dette in mezzo ad altro. Stessa scala: 5 importante/urgente/decisione sua; 4 da fare in un altro momento
   o progetto diverso; 3 idea di sfuggita; sotto non serve. Se e' gia' in lista: doppione_di = id. Massimo 8.
   ATTENZIONE: Claude risponde subito a ogni messaggio. Una richiesta fatta dentro il lavoro in corso ("fammi
   l'elenco", "fammi un html", "aggiungi un tasto", "prova", "cerca") e' gia' stata fatta in quella sessione:
   NON e' una cosa sfuggita, importanza 2. Sfuggita = detta per un altro momento ("dopo", "ricordati", "la
   prossima volta"), o ripetuta in sessioni diverse, o un progetto/problema diverso da quello su cui lavorava.
4. "come_decide": osservazioni su COME ragiona e decide, per costruire un agente che risponda come lui:
   cosa lo fa dire si', cosa lo fa arrabbiare, come reagisce a un errore, quando dice "fai tu", cosa chiede di
   vedere prima di fidarsi, il suo tono. Ogni osservazione con una citazione. Massimo 8.
5. "umore": una riga.

Rispondi SOLO con JSON:
{"temi":[{"ore":"...","tema":"..."}],"decisioni":[{"regola":"...","citazione":"..."}],
 "sfuggite":[{"msg_id":N,"titolo":"...","nota":"...","importanza":N,"doppione_di":N|null,"motivo":"...","citazione":"le sue parole esatte, almeno 6 parole"}],
 "come_decide":[{"osservazione":"...","citazione":"..."}],"umore":"..."}`;

async function rianalizzaGiorno(db, giorno) {
  const tutti = db.prepare("SELECT id, ts, sessione, testo FROM messaggi ORDER BY ts").all().filter(m => giornoRoma(m.ts) === giorno);
  if (!tutti.length) { console.log(giorno + ': nessun messaggio'); return null; }
  const voci = C.leggiLavori();
  const tenuti = db.prepare("SELECT titolo, nota, importanza FROM candidati WHERE azione = 'tenuto' AND ts LIKE ?").all(giorno + '%');

  // taglio per stare nei limiti: ogni messaggio max 700 caratteri, totale max 60k
  let tot = 0; const righe = [];
  for (const m of tutti) { const t = m.testo.replace(/\s+/g, ' ').slice(0, 700); if (tot + t.length > 60000) break; tot += t.length; righe.push('[msg_id ' + m.id + ' ' + oraRoma(m.ts) + '] ' + t); }
  const utente = 'GIORNO: ' + giorno + '\n\nLISTA:\n' + L.listaCompatta(voci) +
    (tenuti.length ? '\n\nCANDIDATI TENUTI DAL GUARDIANO (forse):\n' + tenuti.map(t => '- ' + t.titolo + ' (' + t.importanza + '/5): ' + t.nota).join('\n') : '') +
    '\n\nMESSAGGI DELLA GIORNATA (' + tutti.length + '):\n' + righe.join('\n');

  const { modello, json } = await C.chiediJson(SISTEMA_GIORNO, utente, { primo: 'gemini' });

  // 3. le cose sfuggite passano dalla stessa porta del guardiano (doppio controllo doppioni)
  const sfuggite = Array.isArray(json.sfuggite) ? json.sfuggite : [];
  // entra da sola solo con importanza 5 E citazione che esiste davvero in un suo messaggio del giorno; il resto resta tenuto
  const testi = tutti.map(m => m.testo.replace(/\s+/g, ' ').toLowerCase());
  const verifica = c => { const q = String(c.citazione || '').replace(/\s+/g, ' ').toLowerCase().split(' ').slice(0, 6).join(' '); return q.split(' ').length >= 5 && testi.some(t => t.includes(q)); };
  const { aggiunti, righe: esiti } = await L.applicaCandidati(db, voci, sfuggite, tutti, modello, { secco: SECCO, origine: 'rianalisi', soglia: 5, verifica });

  // il foglio della giornata
  let md = '# ' + giorno + '\n\n_Rianalisi del ' + C.oraIt() + ', ' + tutti.length + ' messaggi, modello ' + modello + '._\n';
  md += '\n## Su cosa ha lavorato\n' + ((json.temi || []).map(t => '- ' + t.ore + ': ' + t.tema).join('\n') || '- niente') + '\n';
  md += '\n## Decisioni e regole dette da lui\n' + ((json.decisioni || []).map(d => '- **' + d.regola + '**: "' + d.citazione + '"').join('\n') || '- nessuna') + '\n';
  md += '\n## Cose sfuggite al guardiano veloce\n' + (esiti.length ? esiti.map(r => '- ' + r).join('\n') : '- nessuna') + '\n';
  md += '\n## Umore\n- ' + (json.umore || '') + '\n';
  md += '\n## Come decide (per iWhy)\n' + ((json.come_decide || []).map(o => '- ' + o.osservazione + ' ("' + o.citazione + '")').join('\n') || '- niente') + '\n';

  if (!SECCO) {
    fs.mkdirSync(DIR_GIORNI, { recursive: true });
    fs.writeFileSync(path.join(DIR_GIORNI, giorno + '.md'), md, 'utf8');
    // osservazioni per iWhy, accumulate giorno per giorno
    fs.mkdirSync(DIR_IWHY, { recursive: true });
    const oss = (json.come_decide || []).map(o => '- [' + giorno + '] ' + o.osservazione + ' ("' + String(o.citazione).slice(0, 200) + '")').join('\n');
    const dec = (json.decisioni || []).map(d => '- [' + giorno + '] ' + d.regola + ' ("' + String(d.citazione).slice(0, 200) + '")').join('\n');
    if (oss) fs.appendFileSync(path.join(DIR_IWHY, 'osservazioni.md'), oss + '\n', 'utf8');
    if (dec) fs.appendFileSync(path.join(DIR_IWHY, 'decisioni.md'), dec + '\n', 'utf8');
    db.prepare('INSERT OR REPLACE INTO giorni (giorno, ts, modello, messaggi, aggiunti) VALUES (?,?,?,?,?)').run(giorno, C.adesso(), modello, tutti.length, aggiunti);
    if (aggiunti) C.storico('rianalisi di ' + giorno + ': ' + aggiunti + ' cose sfuggite messe in lista');
  }
  console.log(md);
  return { messaggi: tutti.length, aggiunti, modello };
}

// ---- lo schema: la mappa di tutto, raggruppata per progetto ------------------------------
const SISTEMA_SCHEMA = `Ricevi la lista dei lavori di Whyed (id, stato, titolo). Raggruppa le voci per PROGETTO o AREA
(es. "Aphi, la mascotte", "Widget", "Protesi mentale", "Candidature e lavoro", "PC e sistema", "Musica e clienti",
"Discord e amici", "Codex e strumenti AI", "Sicurezza e chiavi", "Video e grafica"...). Ogni voce in UN gruppo solo.
Nomi dei gruppi corti, in italiano. Massimo 14 gruppi. Rispondi SOLO con JSON: {"gruppi":[{"nome":"...","voci":[id,...]}]}`;

async function schema(db) {
  const voci = C.leggiLavori();
  const { modello, json } = await C.chiediJson(SISTEMA_SCHEMA, L.listaCompatta(voci), { primo: 'gemini' });
  const st = { ora: 'ORA', dopo: "PIU' AVANTI", no: 'LASCIA STARE', fatto: 'FATTO' };
  const messi = new Set();
  let md = '# Schema di tutto\n\n_Rifatto il ' + C.oraIt() + ' (' + modello + '). La lista vera e\' `E:/Lavori` (segna.js); questo e\' la mappa per capire dove sta ogni cosa._\n';
  const ora = voci.filter(v => v.s === 'ora').length, dopo = voci.filter(v => v.s === 'dopo').length, fatte = voci.filter(v => v.s === 'fatto').length;
  md += '\n**' + ora + ' da fare ora, ' + dopo + " piu' avanti, " + fatte + ' fatte.**\n';
  for (const g of (json.gruppi || [])) {
    const vs = (g.voci || []).map(id => voci.find(v => v.id === Number(id))).filter(v => v && !messi.has(v.id));
    if (!vs.length) continue;
    md += '\n## ' + g.nome + '\n';
    for (const s of ['ora', 'dopo', 'no', 'fatto']) {
      const x = vs.filter(v => v.s === s); if (!x.length) continue;
      if (s === 'fatto') { md += '- fatte: ' + x.map(v => '#' + v.id + ' ' + v.t).join('; ') + '\n'; x.forEach(v => messi.add(v.id)); continue; }
      for (const v of x) { md += '- [' + st[s] + '] **#' + v.id + ' ' + v.t + '**' + (v.n ? ': ' + v.n.slice(0, 140) : '') + '\n'; messi.add(v.id); }
    }
  }
  const fuori = voci.filter(v => !messi.has(v.id));
  if (fuori.length) md += '\n## Senza gruppo\n' + fuori.map(v => '- [' + st[v.s] + '] #' + v.id + ' ' + v.t).join('\n') + '\n';
  md += '\n## Gli altri fogli\n- `dati/riordino.md`: ordine consigliato e quando farle\n- `dati/orari.md`: quando scrive e quando no\n- `dati/calendario.json`: impegni fissi\n- `dati/giorni/`: un foglio per ogni giornata\n- `protesi/iwhy/`: come decide (per iWhy)\n';
  if (!SECCO) fs.writeFileSync(path.join(C.DATI, 'schema.md'), md, 'utf8');
  console.log(md.split('\n').slice(0, 12).join('\n') + '\n...');
  return modello;
}

(async () => {
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 20 * 60000) { console.log("gia' in corso"); return; }
  fs.writeFileSync(LOCK, String(process.pid));
  const db = C.apriDb();
  try {
    if (!SOLO_SCHEMA) {
      let giorni = [];
      if (GIORNO) giorni = [GIORNO];
      else {
        // tutti i giorni con messaggi, fino a ieri, non ancora fatti (max 7 per giro, dal piu' vecchio)
        const fatti = new Set(db.prepare('SELECT giorno FROM giorni').all().map(r => r.giorno));
        const tutti = new Set(db.prepare('SELECT ts FROM messaggi').all().map(r => giornoRoma(r.ts)));
        giorni = [...tutti].filter(g => g <= ieri() && !fatti.has(g)).sort().slice(-7);
      }
      for (const g of giorni) { try { await rianalizzaGiorno(db, g); } catch (e) { console.error('ERRORE ' + g + ': ' + e.message); C.log('rianalisi ' + g + ': ' + e.message); } }
    }
    try { await schema(db); } catch (e) { console.error('ERRORE schema: ' + e.message); C.log('schema: ' + e.message); }
    if (!SECCO) {
      try { execFileSync('node', [path.join(__dirname, 'orari.js')], { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
      // il corpus di iWhy (coppie azione -> reazione) si rinfresca ogni giorno, tutto in locale, zero token
      try { execFileSync('node', [path.join(DIR_IWHY, 'estrai-reazioni.js')], { windowsHide: true, stdio: 'ignore' }); } catch (e) { C.log('estrai-reazioni: ' + e.message); }
    }
  } finally { db.close(); try { fs.unlinkSync(LOCK); } catch (_) {} }
})();
