// guardiano.js - il guardiano in entrata della protesi mentale.
// Ogni tot minuti (task pianificato, senza finestra) legge i messaggi nuovi che Whyed ha
// scritto, li confronta con la lista dei lavori e decide, con Groq (Gemini di riserva):
//   - c'e' una cosa da fare nuova? con che importanza (1..5)? e' gia' in lista?
// Importanza 4 o 5 e non in lista -> la aggiunge con segna.js (backup + storico, si annulla).
// Il resto lo tiene in protesi.db (tabella candidati) per quando Claude vuole guardare.
//
//   node guardiano.js               giro normale (solo messaggi piu' vecchi di 15 minuti)
//   node guardiano.js --forza       anche i messaggi appena scritti
//   node guardiano.js --secco       fa vedere cosa farebbe senza toccare niente
//   node guardiano.js --riordino    guarda tutta la lista e scrive dati/riordino.md (proposte)
//   node guardiano.js --riordino --applica   e applica: FATTO con prova verificata, ordine di DA FARE ORA
// Quando Claude e' fuori quota, il giro normale fa da solo il riordino CON applica (ogni 6 ore).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('./comune');
const L = require('./lista');

const args = process.argv.slice(2);
const FORZA = args.includes('--forza');
const SECCO = args.includes('--secco');
const RIORDINO = args.includes('--riordino');
const APPLICA = args.includes('--applica');   // riordino che tocca la lista davvero (uscita)
let applica = APPLICA;
const ATTESA_MIN = 15;          // lascio a Claude il tempo di aggiungere lui, cosi' niente doppioni
const LOTTO = 12;               // messaggi per giro (Groq ha 8000 token al minuto)
const LOCK = path.join(C.DATI, 'guardiano.lock');

const ddmm = L.ddmm;

const SISTEMA = `Sei il guardiano della lista dei lavori di Whyed, produttore musicale e
creatore di progetti software con l'aiuto di Claude Code. Preferisce frasi brevi:
scrive di getto, con errori di battitura, e ha bisogno che ogni cosa da fare che nomina venga
ricordata al posto suo. La lista e' tenuta da Claude; tu controlli che non si perda niente.

Ricevi: la LISTA attuale (id, stato, titolo) e alcuni MESSAGGI che lui ha scritto a Claude.
Per ogni messaggio decidi se contiene una o piu' COSE DA FARE (un lavoro, un'idea, una cosa da
sistemare, una decisione da ricordare) che NON sono gia' in lista.

Importanza, da 1 a 5:
5 = lo dice esplicitamente come importante, urgente, "non dimenticare", o e' una decisione sua
4 = una cosa da fare IN UN ALTRO MOMENTO ("dopo", "piu' avanti", "la prossima volta", "ricordati"), un progetto
    o un problema DIVERSO da quello su cui sta lavorando in quei messaggi, una cosa rotta da sistemare un altro giorno
3 = un'idea detta di sfuggita, una cosa che forse vorra'
2 = una richiesta per ADESSO, dentro il lavoro in corso: "fammi vedere", "elencami", "aggiungi", "prova", "cambia",
    "cerca". Claude risponde subito a ogni messaggio, quindi queste le sta gia' facendo: NON vanno in lista
1 = nessuna cosa da fare (domanda, risposta, commento, conferma, chiacchiera)

Attenzione: la maggior parte dei messaggi e' 1 o 2. Un 4 o un 5 e' raro: solo se e' chiaramente
una cosa separata dal lavoro di quel momento. Se hai un dubbio fra 2 e 4, e' 2.

Regole:
- Se la cosa e' gia' in lista (anche con parole diverse), metti doppione_di = id della voce e importanza 1.
- Se sta parlando del lavoro che Claude sta gia' facendo in quel momento, e' 2, non va in lista.
- Non inventare: se non e' chiaro cosa vuole, importanza 3 al massimo.
- Il titolo e' corto (max 8 parole), in italiano, come i titoli della lista: "Cosa: dettaglio".
- La nota e' una frase breve che spiega cosa vuole, con le sue parole quando aiutano.
- Rispondi SOLO con JSON: {"candidati":[{"msg_id":N,"titolo":"...","nota":"...","importanza":N,"doppione_di":N|null,"motivo":"..."}]}
- Un messaggio senza niente da fare non va nell'elenco.`;

async function giroNormale(db) {
  const limite = FORZA ? C.adesso() : new Date(Date.now() - ATTESA_MIN * 60000).toISOString();
  const msgs = db.prepare('SELECT id, ts, sessione, testo FROM messaggi WHERE analizzato = 0 AND ts <= ? ORDER BY ts LIMIT ?').all(limite, LOTTO);
  if (!msgs.length) { console.log('niente di nuovo'); return { letti: 0, aggiunti: 0 }; }

  const voci = C.leggiLavori();
  const sess = {}; let ns = 0;
  const utente = 'LISTA:\n' + L.listaCompatta(voci) + '\n\nMESSAGGI (stessa lettera = stessa sessione di lavoro, quindi stesso lavoro in corso):\n' +
    msgs.map(m => { const k = m.sessione || '?'; if (!sess[k]) sess[k] = String.fromCharCode(65 + (ns++ % 26)); return '--- msg_id ' + m.id + ' sessione ' + sess[k] + ' (' + C.oraIt(m.ts) + ')\n' + m.testo.slice(0, 1500); }).join('\n');

  const { modello, json } = await C.chiediJson(SISTEMA, utente);
  const cand = Array.isArray(json.candidati) ? json.candidati : [];
  const { aggiunti, righe, esiti } = await L.applicaCandidati(db, voci, cand, msgs, modello, { secco: SECCO, origine: 'guardiano' });
  righe.forEach(r => console.log(r));

  if (!SECCO) {
    const upd = db.prepare('UPDATE messaggi SET analizzato = 1, esito = ? WHERE id = ?');
    for (const m of msgs) upd.run(esiti[m.id] ? esiti[m.id].join('; ') : 'niente', m.id);
  }
  console.log('letti ' + msgs.length + ', candidati ' + cand.length + ', aggiunti ' + aggiunti + ' (' + modello + ')');
  return { letti: msgs.length, aggiunti, modello };
}

// ---- riordino: quando Claude e' fuori quota (o su richiesta) guarda tutta la lista -------
const SISTEMA_RIORDINO = `Sei il guardiano della lista dei lavori di Whyed, produttore
musicale e creatore di progetti con Claude Code. Ricevi la LISTA (stato ORA = da fare adesso, DOPO =
rimandato da lui, NO = lasciare stare, FATTO) con le note, e i MESSAGGI degli ultimi giorni.
Proponi un riordino, senza inventare. Regole ferree:
- "sembra_fatto": SOLO voci ORA per cui c'e' una frase sua che dice chiaramente che la cosa e' conclusa; cita la frase esatta. Se non c'e', lista vuota.
- "urgenti": MASSIMO 5 voci, solo se lui ha detto "importante", "urgente", "non rimandare", "subito" o l'ha ripetuta in giorni diversi. Cita la frase. Niente riempitivi tipo "ripetuto 2 volte".
- "ordine": ESATTAMENTE 10 id ORA, dal primo da fare all'ultimo, un motivo concreto di una riga ciascuno (scadenza, dipendenza, cosa sblocca).
  Le voci "urgenti" vanno SEMPRE per prime. Le voci che hanno "importantissimo", "cambio radicale", "non rimandare"
  nella nota vengono prima delle altre. L'ordine attuale della lista e' la base: cambialo solo dove hai un motivo.
- "sospette": voci ORA che nei messaggi non compaiono mai e sembrano ferme: massimo 5.
- "quando": OBBLIGATORIO per i primi 5 dell'ordine: giorno della settimana e fascia oraria che rispettino gli IMPEGNI FISSI e le ORE MIGLIORI (es. "giovedi' 14-17").
Rispondi SOLO con JSON: {"sembra_fatto":[{"id":N,"prova":"..."}],"urgenti":[{"id":N,"motivo":"..."}],"ordine":[{"id":N,"motivo":"..."}],"sospette":[{"id":N,"motivo":"..."}],"quando":[{"id":N,"fascia":"..."}]}`;

async function riordino(db) {
  const voci = C.leggiLavori();
  const da = new Date(Date.now() - 3 * 86400000).toISOString();
  const msgs = db.prepare('SELECT id, ts, testo FROM messaggi WHERE ts >= ? ORDER BY ts DESC LIMIT 70').all(da).reverse();
  const lista = voci.filter(v => v.s === 'ora').map(v => v.id + ' [ORA] ' + v.t + (v.n ? ' - ' + v.n.slice(0, 120) : '')).join('\n')
    + '\n' + voci.filter(v => v.s === 'dopo').map(v => v.id + ' [DOPO] ' + v.t).join('\n');
  // impegni fissi dal calendario (fotografia tenuta da Claude in dati/calendario.json)
  let cal = '';
  try {
    const c = JSON.parse(fs.readFileSync(path.join(C.DATI, 'calendario.json'), 'utf8'));
    cal = '\n\nIMPEGNI FISSI (non proporre lavoro in queste ore):\n' + c.impegni_fissi.map(i => '- ' + i.cosa + ': ' + i.giorni.join('/') + ' ' + i.dalle + '-' + i.alle).join('\n') +
      '\nORE MIGLIORI PER LUI: ' + Object.entries(c.ore_libere_migliori).filter(([k]) => k[0] !== '_').map(([k, v]) => k + ' ' + v).join('; ');
  } catch (_) {}
  const utente = 'LISTA:\n' + lista + cal + '\n\nMESSAGGI ULTIMI 3 GIORNI:\n' + msgs.map(m => '(' + C.oraIt(m.ts) + ') ' + m.testo.slice(0, 350)).join('\n');
  const { modello, json } = await C.chiediJson(SISTEMA_RIORDINO, utente, { primo: 'gemini' });
  const nome = id => { const v = voci.find(x => x.id === id); return v ? v.t : '?'; };
  let md = '# Riordino proposto dal guardiano\n\n_' + C.oraIt() + ', modello ' + modello + '. Sono proposte: la lista la cambia Claude o Whyed._\n';
  const sez = (titolo, arr, campo) => { md += '\n## ' + titolo + '\n'; if (!arr || !arr.length) md += '- niente\n'; else for (const x of arr) md += '- **#' + x.id + ' ' + nome(x.id) + '**: ' + (x[campo] || '') + '\n'; };
  sez('Sembrano fatte', json.sembra_fatto, 'prova');
  sez("Urgenti (le ha chieste piu' volte)", json.urgenti, 'motivo');
  sez('Ordine consigliato', json.ordine, 'motivo');
  sez("Ferme da tanto, forse PIU' AVANTI", json.sospette, 'motivo');
  sez('Quando farle (rispettando il calendario)', json.quando, 'fascia');

  // ---- uscita: applica davvero (solo con --applica o quando Claude e' fuori quota) ----------
  // Sposta su FATTO solo con prova verificata due volte; mette in ordine DA FARE ORA.
  // Le "sospette" non le tocca mai: PIU' AVANTI lo decide Whyed. Tutto reversibile (backup + annulla).
  if (applica && !SECCO) {
    md += '\n## Applicato dal guardiano\n';
    let fatte = 0;
    for (const f of (json.sembra_fatto || [])) {
      const v = voci.find(x => x.id === Number(f.id) && x.s === 'ora'); if (!v) continue;
      const esito = await confermaFatta(db, v, String(f.prova || ''));
      if (esito.ok) {
        execFileSync('node', [C.SEGNA, 'fatto', String(v.id), (v.n ? v.n.slice(0, 200) + ' | ' : '') + 'Spostata dal guardiano il ' + ddmm(Date.now()) + ', prova: "' + esito.frase.slice(0, 120) + '"'], { encoding: 'utf8', windowsHide: true });
        C.storico('spostata su FATTO da solo #' + v.id + ' ' + v.t + ' (prova: ' + esito.frase.slice(0, 80) + ')');
        md += '- **#' + v.id + ' ' + v.t + '** -> FATTO. Prova: "' + esito.frase.slice(0, 160) + '"\n'; fatte++;
      } else md += '- #' + v.id + ' ' + v.t + ': NON spostata (' + esito.motivo + ')\n';
    }
    const ids = (json.ordine || []).map(o => Number(o.id)).filter(id => voci.some(v => v.id === id && v.s === 'ora'));
    if (ids.length >= 3) {
      execFileSync('node', [C.SEGNA, 'ordina', ids.join(','), 'riordino del guardiano'], { encoding: 'utf8', windowsHide: true });
      C.storico('ordine di DA FARE ORA rifatto da solo: ' + ids.map(i => '#' + i).join(' '));
      md += '- DA FARE ORA rimessa in ordine: ' + ids.map(i => '#' + i).join(', ') + '\n';
    }
    if (!fatte && ids.length < 3) md += '- niente da applicare\n';
  }

  const out = path.join(C.DATI, 'riordino.md');
  if (!SECCO) {
    fs.writeFileSync(out, md, 'utf8');
    // agenda: le fasce consigliate, pronte per finire nel Google Calendar (lo fa Claude in sessione)
    const agenda = (json.quando || []).map(q => ({ id: Number(q.id), titolo: nome(Number(q.id)), fascia: q.fascia })).filter(a => a.titolo !== '?');
    fs.writeFileSync(path.join(C.DATI, 'agenda.json'), JSON.stringify({ aggiornato: C.adesso(), settimana_di: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }), voci: agenda }, null, 1), 'utf8');
  }
  console.log(md);
  return { letti: msgs.length, aggiunti: 0, modello };
}

// La prova deve esistere davvero fra i suoi messaggi (non inventata dal modello) e un secondo
// passaggio, col messaggio intero davanti, deve confermare che la cosa e' conclusa.
async function confermaFatta(db, voce, prova) {
  const pezzo = prova.replace(/\s+/g, ' ').trim();
  if (pezzo.length < 15) return { ok: false, motivo: 'prova troppo corta' };
  // cerco un pezzo della prova (le prime 6 parole) nei messaggi veri
  const chiave = pezzo.split(' ').slice(0, 6).join(' ');
  const m = db.prepare("SELECT ts, testo FROM messaggi WHERE testo LIKE ? ORDER BY ts DESC LIMIT 1").get('%' + chiave + '%');
  if (!m) return { ok: false, motivo: 'la frase non esiste nei messaggi' };
  const { json } = await C.chiediJson(
    `Rispondi solo con JSON {"conclusa": true|false, "motivo": "..."}. Whyed ha scritto questo messaggio a Claude. La voce
della lista e' davvero CONCLUSA secondo il messaggio? Vale solo se dice che la cosa e' fatta, finita, risolta, non se ne
parla soltanto o se chiede di farla.`,
    'VOCE: ' + voce.t + (voce.n ? ' - ' + voce.n.slice(0, 200) : '') + '\n\nMESSAGGIO (' + C.oraIt(m.ts) + '):\n' + m.testo.slice(0, 1500),
    { primo: 'gemini' });
  return json.conclusa ? { ok: true, frase: pezzo } : { ok: false, motivo: 'secondo controllo: ' + (json.motivo || 'non conclusa') };
}

(async () => {
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 10 * 60000) { console.log("gia' in corso"); return; }
  fs.writeFileSync(LOCK, String(process.pid));
  const db = C.apriDb();
  const modo = RIORDINO ? 'riordino' : 'entrata';
  let r = { letti: 0, aggiunti: 0 }, errore = null;
  try {
    r = RIORDINO ? await riordino(db) : await giroNormale(db);
    // se Claude e' fuori quota, il guardiano fa anche il riordino da solo (una volta ogni 6 ore)
    if (!RIORDINO && !SECCO && C.claudeFuoriQuota()) {
      const ultimo = db.prepare("SELECT ts FROM giri WHERE modo = 'riordino' ORDER BY ts DESC LIMIT 1").get();
      if (!ultimo || Date.now() - new Date(ultimo.ts).getTime() > 6 * 3600000) {
        applica = true;   // Claude non c'e': il guardiano riorganizza da solo
        const rr = await riordino(db);
        db.prepare('INSERT INTO giri (ts, modo, modello, letti, aggiunti) VALUES (?,?,?,?,?)').run(C.adesso(), 'riordino', rr.modello, rr.letti, 0);
        C.storico('Claude fuori quota: riordino applicato, vedi dati/riordino.md');
      }
    }
  } catch (e) { errore = e.message; console.error('ERRORE ' + e.message); C.log('guardiano ' + modo + ': ' + e.message); }
  if (!SECCO) db.prepare('INSERT INTO giri (ts, modo, modello, letti, aggiunti, errore) VALUES (?,?,?,?,?,?)').run(C.adesso(), modo, r.modello || null, r.letti, r.aggiunti, errore);

  // la rianalisi della giornata di ieri: una volta al giorno, dalle 6 del mattino in poi (lui dorme),
  // lanciata da qui cosi' c'e' un solo task pianificato per tutta la protesi
  if (!RIORDINO && !SECCO) {
    try {
      const oraRoma = Number(new Date().toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).slice(0, 2));
      const ieri = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
      const fatta = db.prepare('SELECT 1 FROM giorni WHERE giorno = ?').get(ieri);
      if (oraRoma >= 6 && !fatta) {
        const { spawn } = require('child_process');
        spawn('node', [path.join(__dirname, 'rianalisi.js')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        C.log('rianalisi di ' + ieri + ' lanciata dal guardiano');
      }
    } catch (e) { C.log('lancio rianalisi: ' + e.message); }
  }
  db.close();
  try { fs.unlinkSync(LOCK); } catch (_) {}
})();
