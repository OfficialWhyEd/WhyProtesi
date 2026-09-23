// comune.js - la base della protesi mentale di Whyed.
// Tutto sta qui: percorsi, database SQLite, chiavi (lette dal loro posto, mai copiate),
// e le chiamate a Groq (primo) e Gemini (riserva).
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const LAVORI = process.env.PROTESI_LAVORI || path.join(__dirname, '..');  // cartella con segna.js e dati/
const DATI = path.join(LAVORI, 'dati');
const DB_FILE = path.join(DATI, 'protesi.db');
const STORICO = path.join(DATI, 'storico.txt');
const SEGNA = path.join(LAVORI, 'segna.js');
const LAVORI_JSON = path.join(DATI, 'lavori.json');
const QUOTE = path.join(require('os').homedir(), '.claude', 'quote.json');
const LOG = path.join(DATI, 'protesi.log');

const PORTACHIAVI = process.env.PROTESI_PORTACHIAVI || '';  // JSON con le chiavi Gemini, fuori dal repo
const ZSHRC = process.env.PROTESI_ZSHRC || '';              // file shell con GROQ_API_KEY, fuori dal repo

const MODELLO_GROQ = 'openai/gpt-oss-120b';                  // tetto: 8000 token al minuto
const MODELLI_GEMINI = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-2.5-flash']; // 18/09/2026: 3.5 risponde con tutte e 3 le chiavi buone
const CHIAVI_MORTE = path.join(DATI, 'chiavi-morte.json'); // chiavi che hanno risposto 400/403: escluse per 7 giorni

function adesso() { return new Date().toISOString(); }
function oraIt(iso) {
  return new Date(iso || Date.now()).toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour12: false });
}

function log(riga) {
  try { fs.appendFileSync(LOG, oraIt() + '  ' + riga + '\n', 'utf8'); } catch (_) {}
}
function storico(riga) {
  try { fs.appendFileSync(STORICO, new Date().toLocaleString('it-IT') + '  GUARDIANO  ' + riga + '\n', 'utf8'); } catch (_) {}
}

// ---- database -------------------------------------------------------------
function apriDb() {
  fs.mkdirSync(DATI, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messaggi (
      id INTEGER PRIMARY KEY,
      ts TEXT NOT NULL,            -- ISO UTC
      sessione TEXT,
      cwd TEXT,
      fonte TEXT NOT NULL,         -- 'hook' (vivo) | 'import' (dalle sessioni salvate)
      testo TEXT NOT NULL,
      analizzato INTEGER NOT NULL DEFAULT 0,
      esito TEXT,                  -- riassunto di cosa ha deciso il guardiano
      UNIQUE(sessione, ts)
    );
    CREATE INDEX IF NOT EXISTS idx_msg_ts ON messaggi(ts);
    CREATE INDEX IF NOT EXISTS idx_msg_analizzato ON messaggi(analizzato);
    CREATE TABLE IF NOT EXISTS candidati (
      id INTEGER PRIMARY KEY,
      ts TEXT NOT NULL,
      msg_id INTEGER,
      titolo TEXT NOT NULL,
      nota TEXT,
      importanza INTEGER NOT NULL, -- 1..5
      doppione_di INTEGER,         -- id in lavori.json se e' gia' in lista
      azione TEXT NOT NULL,        -- 'aggiunto' | 'tenuto' | 'doppione' | 'ignorato'
      lavoro_id INTEGER,           -- id in lavori.json se aggiunto
      modello TEXT
    );
    CREATE TABLE IF NOT EXISTS giorni (
      giorno TEXT PRIMARY KEY,     -- YYYY-MM-DD, ora di Roma
      ts TEXT NOT NULL,            -- quando e' stata fatta la rianalisi
      modello TEXT,
      messaggi INTEGER,
      aggiunti INTEGER
    );
    CREATE TABLE IF NOT EXISTS giri (
      id INTEGER PRIMARY KEY,
      ts TEXT NOT NULL,
      modo TEXT NOT NULL,
      modello TEXT,
      letti INTEGER DEFAULT 0,
      aggiunti INTEGER DEFAULT 0,
      errore TEXT
    );
  `);
  return db;
}

// ---- chiavi (lette al volo, mai salvate altrove) ---------------------------
function chiaviMorte() { try { return JSON.parse(fs.readFileSync(CHIAVI_MORTE, 'utf8')); } catch (_) { return {}; } }
function segnaChiaveMorta(key, motivo) {
  const m = chiaviMorte(); m[key.slice(0, 12)] = { fino: new Date(Date.now() + 7 * 86400000).toISOString(), motivo };
  try { fs.writeFileSync(CHIAVI_MORTE, JSON.stringify(m, null, 1)); } catch (_) {}
}
function chiaveGemini() {
  const j = JSON.parse(fs.readFileSync(PORTACHIAVI, 'utf8'));
  const morte = chiaviMorte();
  return j.filter(e => e.tipo === 'Google/Gemini' && /^AIza/.test(e.valore || '')).map(e => e.valore)
    .filter(k => !(morte[k.slice(0, 12)] && morte[k.slice(0, 12)].fino > new Date().toISOString()));
}
function chiaveGroq() {
  const m = fs.readFileSync(ZSHRC, 'utf8').match(/GROQ_API_KEY="?([^"\n]+)/);
  return m ? m[1].trim() : null;
}

// ---- modelli --------------------------------------------------------------
async function chiediGroq(sistema, utente, { timeoutMs = 60000, secondoTentativo = false, senzaJson = false } = {}) {
  const key = chiaveGroq();
  if (!key) throw new Error('chiave Groq non trovata');
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: MODELLO_GROQ, temperature: 0.1,
        ...(senzaJson ? {} : { response_format: { type: 'json_object' } }),
        messages: [{ role: 'system', content: sistema }, { role: 'user', content: utente }],
      }),
    });
    const txt = await r.text();
    // troppi token al minuto: aspetto e riprovo una volta sola
    if ((r.status === 413 || r.status === 429) && !secondoTentativo) {
      clearTimeout(t);
      log('Groq ' + r.status + ', aspetto 25 s e riprovo');
      await new Promise(ok => setTimeout(ok, 25000));
      return chiediGroq(sistema, utente, { timeoutMs, secondoTentativo: true });
    }
    // il JSON forzato a volte fallisce sulle risposte lunghe: riprovo lasciandolo libero
    if (r.status === 400 && !senzaJson && /json/i.test(txt)) {
      clearTimeout(t);
      log('Groq 400 sul JSON forzato, riprovo senza');
      return chiediGroq(sistema, utente, { timeoutMs, secondoTentativo, senzaJson: true });
    }
    if (!r.ok) throw new Error('Groq ' + r.status + ': ' + txt.slice(0, 160).replace(/\s+/g, ' '));
    const j = JSON.parse(txt);
    return { modello: MODELLO_GROQ, testo: j.choices[0].message.content };
  } finally { clearTimeout(t); }
}

async function chiediGemini(sistema, utente, { timeoutMs = 90000 } = {}) {
  const chiavi = chiaveGemini();
  if (!chiavi.length) throw new Error('nessuna chiave Gemini viva');
  let ultimo = null; const riprovato = new Set(); const errori = [];
  for (const modello of MODELLI_GEMINI) for (let i = 0; i < chiavi.length; i++) { const key = chiavi[i];
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modello + ':generateContent?key=' + key, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sistema }] },
          contents: [{ role: 'user', parts: [{ text: utente }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      });
      const txt = await r.text();
      // 503 = troppa richiesta sul modello: aspetto 5 s e riprovo la stessa chiave una volta
      if (r.status === 503 && !riprovato.has(modello + key)) { riprovato.add(modello + key); errori.push(modello + ' #' + i + ' 503'); await new Promise(ok => setTimeout(ok, 5000)); i--; continue; }
      if (!r.ok) {
        let msg = ''; try { msg = JSON.parse(txt).error.message; } catch (_) { msg = txt.slice(0, 100); }
        // chiave non valida o bloccata: la segno morta cosi' non spreca piu' tentativi
        if (r.status === 400 && /API key not valid/i.test(msg)) segnaChiaveMorta(key, 'non valida');
        if (r.status === 403 && /blocked/i.test(msg)) segnaChiaveMorta(key, 'bloccata per generateContent');
        errori.push(modello + ' #' + i + ' ' + r.status + ' ' + msg.slice(0, 60).replace(/\s+/g, ' '));
        continue;
      }
      const j = JSON.parse(txt);
      return { modello, testo: j.candidates[0].content.parts.map(p => p.text).join('') };
    } catch (e) { errori.push(modello + ' #' + i + ' ' + e.message.slice(0, 40)); }
    finally { clearTimeout(t); }
  }
  throw new Error('Gemini: ' + errori.join(' | '));
}

// Groq prima, Gemini se Groq non risponde. Torna { modello, json }.
async function chiediJson(sistema, utente, { primo = 'groq' } = {}) {
  const errori = [];
  const ordine = primo === 'gemini' ? [chiediGemini, chiediGroq] : [chiediGroq, chiediGemini];
  for (const f of ordine) {
    try {
      const r = await f(sistema, utente);
      // lettura tollerante: dal primo { all'ultimo }, cosi' il testo intorno non rompe niente
      const t = r.testo; const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a < 0 || b <= a) throw new Error(r.modello + ': niente JSON nella risposta');
      return { modello: r.modello, json: JSON.parse(t.slice(a, b + 1)) };
    } catch (e) { errori.push(e.message); log('modello fallito: ' + e.message.slice(0, 200)); }
  }
  throw new Error('tutti i modelli falliti: ' + errori.join(' | '));
}

// ---- lista dei lavori -----------------------------------------------------
function leggiLavori() { return JSON.parse(fs.readFileSync(LAVORI_JSON, 'utf8')).voci; }

// Claude e' fuori quota? (dal guardiano delle quote in ~/.claude/quote.json)
function claudeFuoriQuota() {
  try {
    const q = JSON.parse(fs.readFileSync(QUOTE, 'utf8'));
    const c = q.claude || {};
    return (c.h5 != null && c.h5 >= 92) || (c.g7 != null && c.g7 >= 95);
  } catch (_) { return false; }
}

module.exports = {
  LAVORI, DATI, DB_FILE, STORICO, SEGNA, LAVORI_JSON, LOG,
  adesso, oraIt, log, storico, apriDb, chiediJson, chiediGroq, chiediGemini, leggiLavori, claudeFuoriQuota,
};
