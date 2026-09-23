// segna.js - lo uso io (Claude) per tenere aggiornata la lista di Whyed.
// Whyed non deve toccare niente: lui dice cosa vuole, io segno.
// Ogni modifica fa un backup e lascia una riga nello storico, cosi' si torna indietro.
//
//   node segna.js lista
//   node segna.js fatto  <numero o pezzo di titolo>
//   node segna.js ora    <numero o pezzo di titolo>
//   node segna.js dopo   <numero o pezzo di titolo>
//   node segna.js no     <numero o pezzo di titolo>
//   node segna.js nuovo  "titolo" "nota" [ora|dopo|no|fatto]
//   node segna.js togli  <numero o pezzo di titolo> ["motivo"]
//   node segna.js ordina 70,65,104 ["motivo"]   (in cima a DA FARE ORA, in quest ordine)
//   node segna.js vedi   <numero>                     (tutta la voce, istruzione compresa)
//   node segna.js area   <numero> aphi|musica|podcast|ai|lavoro|pc|cervello|vita
//   node segna.js istr   <numero> "istruzione iWhy"   (come la darebbe lui: si parte da qui)
//   node segna.js annulla

const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const DATI = path.join(BASE, 'dati', 'lavori.json');
const BACKUP = path.join(BASE, 'dati', 'lavori.backup.json');
const STORICO = path.join(BASE, 'dati', 'storico.txt');
const USCITA = require('path').join(require('os').homedir(), '.claude', 'LAVORI.md');

const ETICHETTA = { ora: "DA FARE ORA", dopo: "PIU' AVANTI", no: 'LASCIA STARE', fatto: 'FATTO' };
const STATI = Object.keys(ETICHETTA);
const FASCE = { 1: 'ADESSO', 2: 'SUBITO DOPO', 3: 'IN CODA' };

function leggi() { return JSON.parse(fs.readFileSync(DATI, 'utf8')); }

function scriviMd(d) {
  let out = '# I lavori di Whyed\n\n';
  out += '_Lista comandata da lui dalla pagina `E:/Lavori` (APRI LAVORI.cmd). Aggiornata il ' +
         new Date().toLocaleString('it-IT') + '._\n';
  out += "_Regola: si lavora su DA FARE ORA. PIU' AVANTI non si propone. LASCIA STARE non si nomina piu'._\n";
  for (const s of STATI) {
    const v = d.voci.filter(x => x.s === s);
    if (!v.length) continue;
    out += '\n## ' + ETICHETTA[s] + '\n';
    let fascia = null;
    for (const x of v) {
      if (s === 'ora' && x.p && x.p !== fascia) { fascia = x.p; out += '\n### ' + FASCE[x.p] + '\n'; }
      out += '- **' + x.t + '**' + (x.st ? '  _(' + x.st + ')_' : '') + (x.n ? ' - ' + x.n : '') + '\n';
      // commento lasciato da Whyed sulla pagina: va in LAVORI.md, cosi' lo leggo da solo
      if (x.c) for (const riga of String(x.c).split(/\r?\n/))
        out += '  > ' + riga + '\n';
    }
  }
  fs.writeFileSync(USCITA, out, 'utf8');
}

function salva(d, riga) {
  fs.copyFileSync(DATI, BACKUP);
  fs.writeFileSync(DATI, JSON.stringify(d, null, 1), 'utf8');
  scriviMd(d);
  fs.appendFileSync(STORICO, new Date().toLocaleString('it-IT') + '  ' + riga + '\n', 'utf8');
  console.log('OK  ' + riga);
}

function trova(d, chiave) {
  if (/^\d+$/.test(chiave)) {
    const v = d.voci.find(x => x.id === Number(chiave));
    if (v) return v;
  }
  const k = chiave.toLowerCase();
  const c = d.voci.filter(x => x.t.toLowerCase().includes(k));
  if (c.length === 1) return c[0];
  if (c.length === 0) { console.log('non trovo niente con "' + chiave + '"'); process.exit(1); }
  console.log('piu\' di uno con "' + chiave + '":');
  c.forEach(x => console.log('  ' + x.id + '  ' + x.t));
  process.exit(1);
}

const [azione, a1, a2, a3] = process.argv.slice(2);

if (!azione || azione === 'lista') {
  const d = leggi();
  for (const s of STATI) {
    const v = d.voci.filter(x => x.s === s);
    if (!v.length) continue;
    console.log('\n' + ETICHETTA[s]);
    let fascia2 = null;
    v.forEach(x => {
      if (s === 'ora' && x.p && x.p !== fascia2) { fascia2 = x.p; console.log('\n  ' + FASCE[x.p]); }
      console.log('  ' + String(x.id).padStart(3) + '  ' + x.t + (x.st ? '   (' + x.st + ')' : ''));
      if (x.c) String(x.c).split(/\r?\n/).forEach(r => console.log('       > ' + r));
    });
  }
  console.log('');
  process.exit(0);
}

if (azione === 'annulla') {
  if (!fs.existsSync(BACKUP)) { console.log('niente da annullare'); process.exit(1); }
  fs.copyFileSync(BACKUP, DATI);
  scriviMd(leggi());
  fs.appendFileSync(STORICO, new Date().toLocaleString('it-IT') + '  ANNULLATA ultima modifica\n', 'utf8');
  console.log('OK  tornata indietro di un passo');
  process.exit(0);
}

if (azione === 'nuovo') {
  if (!a1) { console.log('serve il titolo'); process.exit(1); }
  const d = leggi();
  const stato = STATI.includes(a3) ? a3 : 'ora';
  const id = Math.max(0, ...d.voci.map(x => x.id)) + 1;
  d.voci.push({ id, t: a1, n: a2 || '', s: stato });
  salva(d, 'aggiunto [' + ETICHETTA[stato] + '] ' + a1);
  process.exit(0);
}

if (azione === 'ordina') {
  // mette le voci indicate in cima a DA FARE ORA, in quest'ordine: node segna.js ordina 70,65,104 ["motivo"]
  const ids = String(a1 || '').split(',').map(x => Number(x.trim())).filter(Boolean);
  if (!ids.length) { console.log('serve un elenco di numeri: 70,65,104'); process.exit(1); }
  const d = leggi();
  const prime = ids.map(id => d.voci.find(x => x.id === id && x.s === 'ora')).filter(Boolean);
  const resto = d.voci.filter(x => !prime.includes(x));
  // le voci scelte vanno davanti alla prima voce ORA, il resto resta com'e'
  const i = resto.findIndex(x => x.s === 'ora');
  d.voci = i < 0 ? resto.concat(prime) : resto.slice(0, i).concat(prime, resto.slice(i));
  salva(d, 'ORDINE di DA FARE ORA: ' + prime.map(x => '#' + x.id).join(' ') + (a2 ? '  (' + a2 + ')' : ''));
  process.exit(0);
}

if (azione === 'togli') {
  // toglie una voce del tutto (per gli errori del guardiano o i doppioni); backup + storico come sempre
  if (!a1) { console.log('serve numero o titolo'); process.exit(1); }
  const d = leggi();
  const v = trova(d, a1);
  d.voci = d.voci.filter(x => x.id !== v.id);
  salva(d, 'TOLTA #' + v.id + ' ' + v.t + (a2 ? '  (' + a2 + ')' : ''));
  process.exit(0);
}

if (azione === 'vedi') {
  const v = trova(leggi(), a1 || '');
  console.log('#' + v.id + '  ' + v.t + '\nstato: ' + ETICHETTA[v.s] + (v.st ? '  (' + v.st + ')' : '') +
    '\nnota: ' + (v.n || '-') + (v.c ? '\ncommento suo: ' + v.c : '') +
    '\n\nISTRUZIONE iWhy (parti da qui):\n' + (v.i || 'manca: scrivila tu con  node segna.js istr ' + v.id + ' "..."'));
  process.exit(0);
}

if (azione === 'area') {
  // l'area dell'ottagono nel quadro
  const AREE = ['aphi', 'musica', 'podcast', 'ai', 'lavoro', 'pc', 'cervello', 'vita'];
  if (!AREE.includes(a2)) { console.log('area: ' + AREE.join(' | ')); process.exit(1); }
  const d = leggi();
  const v = trova(d, a1 || '');
  v.a = a2;
  salva(d, v.t + '  area -> ' + a2);
  process.exit(0);
}

if (azione === 'istr') {
  // l'istruzione iWhy della voce: il primo messaggio della sessione, scritto come lo scriverebbe lui
  if (!a1 || !a2) { console.log('serve numero e istruzione'); process.exit(1); }
  const d = leggi();
  const v = trova(d, a1);
  v.i = a2;
  salva(d, v.t + '  istruzione iWhy aggiornata');
  process.exit(0);
}

if (STATI.includes(azione)) {
  if (!a1) { console.log('serve numero o titolo'); process.exit(1); }
  const d = leggi();
  const v = trova(d, a1);
  const prima = v.s;
  if (prima === azione) {
    // stesso stato ma nota nuova: aggiorno solo la nota
    if (a2 && a2 !== v.n) { v.n = a2; salva(d, v.t + '  nota aggiornata'); process.exit(0); }
    console.log('era gia\' in ' + ETICHETTA[azione] + ': ' + v.t); process.exit(0);
  }
  v.s = azione;
  if (a2) v.n = a2;
  salva(d, v.t + '  ' + ETICHETTA[prima] + ' -> ' + ETICHETTA[azione]);
  process.exit(0);
}

console.log('azione sconosciuta. usa: lista | ora | dopo | no | fatto | nuovo | vedi | istr | area | togli | ordina | annulla');
process.exit(1);
