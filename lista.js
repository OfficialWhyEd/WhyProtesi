// lista.js - come una cosa candidata entra (o non entra) nella lista dei lavori.
// Lo usano il guardiano (ogni 10 minuti) e la rianalisi (ogni mattina): stessa regola, stesso
// controllo doppioni, stesso backup. Nessun modello decide da solo: prima del "nuovo" c'e'
// sempre il secondo passaggio sulla lista completa.
'use strict';
const { execFileSync } = require('child_process');
const C = require('./comune');

const SOGLIA = 4; // da qui in su va in lista da solo

function ddmm(iso) { const d = new Date(iso); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); }

function parole(t) { return new Set(String(t || '').toLowerCase().replace(/[^a-z0-9àèéìòù ]+/g, ' ').split(' ').filter(w => w.length > 3)); }
function somiglia(a, b) {
  const A = parole(a), B = parole(b); if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}
// la voce piu' simile in lista, se somiglia abbastanza (titolo+nota contro titolo+nota)
function trovaDoppione(voci, titolo, nota) {
  let meglio = null, punt = 0;
  for (const v of voci) { const p = somiglia(titolo + ' ' + nota, v.t + ' ' + (v.n || '')); if (p > punt) { punt = p; meglio = v; } }
  return punt >= 0.5 ? meglio : null;
}

function listaCompatta(voci) {
  const st = { ora: 'ORA', dopo: 'DOPO', no: 'NO', fatto: 'FATTO' };
  return voci.map(v => v.id + ' [' + (st[v.s] || v.s) + '] ' + v.t).join('\n');
}

// Secondo passaggio, solo per le cose che stanno per entrare in lista: il modello rilegge la
// lista COMPLETA (con le note) e dice se la cosa e' gia' coperta da una voce.
const SISTEMA_DOPPIONE = `Ricevi la lista dei lavori di Whyed (id, stato, titolo, nota) e una COSA NUOVA da aggiungere.
Rispondi se la cosa nuova e' GIA' COPERTA da una voce esistente: stessa cosa detta con altre parole,
oppure un dettaglio che rientra in una voce piu' larga gia' presente (es. "widget: aggiungere un
pulsante" rientra in "Widget: rifinire il design generale"). Le voci FATTO contano solo se la cosa
nuova e' esattamente la stessa. Rispondi SOLO con JSON: {"coperta": true|false, "id": N|null, "motivo": "..."}`;

async function giaCoperta(voci, titolo, nota) {
  // le voci FATTO solo col titolo: tengono basso il conto dei token
  const lista = voci.map(v => v.id + ' [' + v.s.toUpperCase() + '] ' + v.t + (v.n && v.s !== 'fatto' ? ' - ' + String(v.n).slice(0, 140) : '')).join('\n');
  const { json } = await C.chiediJson(SISTEMA_DOPPIONE, 'LISTA:\n' + lista + '\n\nCOSA NUOVA:\n' + titolo + ' - ' + nota);
  const id = Number(json.id);
  return json.coperta && voci.some(v => v.id === id) ? { id, motivo: json.motivo || '' } : null;
}

// Applica i candidati usciti da un modello. Torna { aggiunti, righe, esiti (per msg_id) }.
// `origine` finisce nella nota ("guardiano" o "rianalisi").
// `soglia`: da che importanza entra da sola (4 il guardiano, 5 la rianalisi). `verifica(c)`: controllo in piu'
// deciso da chi chiama (es. la citazione deve esistere davvero); se torna false la cosa resta 'tenuto'.
async function applicaCandidati(db, voci, cand, msgs, modello, { secco = false, origine = 'guardiano', soglia = SOGLIA, verifica = null } = {}) {
  const idValidi = new Set(voci.map(v => v.id));
  let aggiunti = 0; const righe = []; const esiti = {};
  const insC = db.prepare('INSERT INTO candidati (ts, msg_id, titolo, nota, importanza, doppione_di, azione, lavoro_id, modello) VALUES (?,?,?,?,?,?,?,?,?)');

  for (const c of cand) {
    const imp = Math.max(1, Math.min(5, Number(c.importanza) || 1));
    const dop = idValidi.has(Number(c.doppione_di)) ? Number(c.doppione_di) : null;
    const titolo = String(c.titolo || '').trim().slice(0, 90);
    if (!titolo) continue;
    const msg = msgs.find(m => m.id === Number(c.msg_id));
    const nota = 'Detto il ' + ddmm(msg ? msg.ts : Date.now()) + ': ' + String(c.nota || '').trim().slice(0, 300) + ' (' + origine + ', importanza ' + imp + ')';
    let azione = 'ignorato', lavoroId = null;
    const simile = dop ? null : trovaDoppione(voci, titolo, String(c.nota || ''));
    let dopFinale = dop || (simile ? simile.id : null);
    if (dopFinale) azione = 'doppione';
    else if (imp >= soglia && verifica && !verifica(c)) { azione = 'tenuto'; c.motivo = (c.motivo || '') + ' | non verificata'; }
    else if (imp >= soglia) {
      const uguale = voci.find(v => v.t.toLowerCase() === titolo.toLowerCase());
      let cop = null;
      if (!uguale) { try { cop = await giaCoperta(voci, titolo, String(c.nota || '')); } catch (e) { C.log('giaCoperta: ' + e.message); } }
      if (uguale) { azione = 'doppione'; dopFinale = uguale.id; }
      else if (cop) { azione = 'doppione'; dopFinale = cop.id; c.motivo = (c.motivo || '') + ' | coperta: ' + cop.motivo; }
      else if (secco) azione = 'aggiunto(secco)';
      else {
        execFileSync('node', [C.SEGNA, 'nuovo', titolo, nota], { encoding: 'utf8', windowsHide: true });
        const nuovo = C.leggiLavori().find(v => v.t === titolo);
        lavoroId = nuovo ? nuovo.id : null; azione = 'aggiunto'; aggiunti++;
        C.storico('aggiunto da solo [' + imp + '/5] ' + titolo + (lavoroId ? ' (#' + lavoroId + ')' : '') + ' [' + origine + ']');
        voci.push({ id: lavoroId, t: titolo, s: 'ora', n: nota });
      }
    } else if (imp >= 3) azione = 'tenuto';
    if (!secco) insC.run(C.adesso(), c.msg_id || null, titolo, nota, imp, dopFinale, azione, lavoroId, modello);
    (esiti[c.msg_id] = esiti[c.msg_id] || []).push(azione + ' [' + imp + '] ' + titolo);
    righe.push((azione + ' ').padEnd(16) + imp + '/5  ' + titolo + (dopFinale ? '  (= #' + dopFinale + ')' : '') + '  <- ' + (c.motivo || ''));
  }
  return { aggiunti, righe, esiti };
}

module.exports = { SOGLIA, ddmm, parole, somiglia, trovaDoppione, listaCompatta, giaCoperta, applicaCandidati };
