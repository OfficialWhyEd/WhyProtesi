# WhyProtesi

**A "mental prosthesis" for working with Claude Code: every message is logged, an AI watchdog extracts the to-dos, removes duplicates and keeps one single list up to date. Plus iWhy, an agent that learns how its owner gives instructions.**

`Node.js 22+` · `node:sqlite` · `Groq` · `Gemini` · `Claude Code hooks` · stato: **in uso**

L'idea: la persona pensa solo a *cosa* fare. Ricordare, mettere in lista, togliere i doppioni, spostare quello
che è finito, trovare l'orario giusto: lo fanno questo programma e Claude.

## Cosa fa
- **registra ogni messaggio** scritto a Claude Code, con l'ora, grazie a un hook;
- **ogni 10 minuti** un guardiano legge i messaggi nuovi: c'è una cosa da fare? quanto è importante? è già in
  lista? Se sì, la aggiunge da solo, dopo un secondo controllo sui doppioni;
- **ogni mattina** rilegge la giornata intera: cose sfuggite, decisioni, regole dette, temi, orari;
- **una lista sola**, che si tocca solo con `segna.js`: ogni modifica fa un backup e una riga di storico, e
  `annulla` torna indietro di un passo;
- **orari**: impara quando la persona scrive e quando no, per mettere le cose negli orari giusti;
- **iWhy**: raccoglie le coppie "cosa ha fatto Claude, come ha reagito lui" e costruisce un agente che propone
  il prossimo passo con le sue parole; ogni risposta finisce in un registro che lui può correggere.

## Come funziona
```
la persona scrive a Claude
      │
      ▼
registro.js (hook UserPromptSubmit) ─► dati/protesi.db (SQLite)
                                            │
                     ogni 10 minuti         ▼
guardiano.js ─► Groq (Gemini di riserva) ─► candidato ─► lista.js: doppioni? ─► segna.js nuovo
                                            │
                     ogni mattina           ▼
rianalisi.js ─► Gemini ─► giorni/*.md · schema.md · orari.md · iwhy/osservazioni.md
```
Nessun modello decide da solo: prima di ogni aggiunta c'è sempre il secondo passaggio sulla lista completa.
Il dettaglio di ogni foglio è in [ARCHITETTURA.md](ARCHITETTURA.md).

## Struttura
| File | Cosa fa |
|---|---|
| `registro.js` | l'hook: salva ogni messaggio in SQLite |
| `guardiano.js` | il giro ogni 10 minuti |
| `rianalisi.js` | la rilettura della giornata |
| `lista.js` | come un candidato entra (o non entra) in lista |
| `segna.js` | `lista`, `nuovo`, `fatto`, `ora`, `dopo`, `vedi`, `istr`, `annulla` |
| `orari.js` | ore di punta, giorni, buchi lunghi, sessioni |
| `importa-sessioni.js` | importa le sessioni passate di Claude Code, per non partire da zero |
| `comune.js` | database e funzioni in comune |
| `iwhy/estrai-reazioni.js` | il materiale per addestrare iWhy, tutto in locale |
| `iwhy/registra.js` | il registro delle risposte di iWhy e delle correzioni |
| `iwhy/COME-SI-USA.md` | come si attiva e come si corregge iWhy |

## Come si avvia
```
node segna.js lista
node segna.js nuovo "titolo" "nota breve"
node orari.js
node guardiano.js          # un giro a mano
```
In Claude Code, `/hooks` > `UserPromptSubmit` > `node percorso/registro.js`. Il guardiano gira come attività
pianificata ogni 10 minuti. Serve Node 22 o più recente. Le chiavi Groq e Gemini non stanno mai nel codice:
si leggono al volo da un portachiavi locale. La cartella `dati/` è esclusa da git.

## Stato
In uso ogni giorno. Da fare: scrematura dei doppioni più aggressiva, calendario in scrittura diretta,
addestramento di iWhy sulle correzioni.

## Perché è nato
Con tante idee al giorno, le liste a mano si perdono, si duplicano e smettono di essere aggiornate. Qui la regola
è rovesciata: la persona parla, il sistema tiene la penna. Una lista sola, sempre nello stesso posto, e niente
si perde.

---

Parte di **[WhyEcosystem 2023-2026](https://github.com/OfficialWhyEd/WhyEcosystem-2023-2026)**: il percorso di WhyEd, producer e sound engineer che costruisce sistemi AI dirigendo gli agenti.  
Costruito da WhyEd con Claude Code
