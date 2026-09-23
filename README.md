# WhyProtesi

**A "mental prosthesis": every message sent to Claude is logged, an AI watchdog extracts the to-dos, deduplicates them and keeps one single list up to date.**

L'idea: la persona pensa solo a *cosa* fare. Tutto il resto (ricordare, mettere in lista, togliere i doppioni,
spostare quello che è finito) lo fanno questo programma e Claude.

## I pezzi
| File | Cosa fa |
|---|---|
| `registro.js` | hook di Claude Code (UserPromptSubmit): salva ogni messaggio in SQLite con l'ora |
| `guardiano.js` | ogni 10 minuti legge i messaggi nuovi con Groq (Gemini di riserva): c'è una cosa da fare? quanto è importante? è già in lista? |
| `rianalisi.js` | ogni mattina rilegge la giornata intera: cose sfuggite, decisioni, regole, orari |
| `segna.js` | l'unico modo di toccare la lista: `nuovo`, `fatto`, `ora`, `dopo`, `annulla`. Ogni modifica fa un backup e una riga di storico |
| `lista.js`, `orari.js`, `comune.js` | lettura della lista, quadro degli orari, funzioni in comune |
| `iwhy/` | iWhy: un agente che impara come la persona dà le istruzioni, per proporre il prossimo passo con le sue parole |

Dettagli tecnici, comandi e schema completo: [ARCHITETTURA.md](ARCHITETTURA.md).

## Regole di progetto
- **Una lista sola, sempre nello stesso posto.** Mai un file nuovo al posto suo.
- **Non si perde niente**: ogni cosa detta, anche di sfuggita, entra in lista.
- **Tutto si può annullare**: backup e storico a ogni modifica.
- Le chiavi API non stanno mai nel codice: si leggono al volo da un portachiavi locale.

## Stato
In uso dal 17/09/2026. Da fare: scrematura automatica dei doppioni più aggressiva, calendario in scrittura diretta.

---

Parte di **[WhyEcosystem 2023-2026](https://github.com/OfficialWhyEd/WhyEcosystem-2023-2026)**: il percorso di WhyEd, producer e sound engineer che costruisce sistemi AI dirigendo gli agenti.  
Costruito da WhyEd con Claude Code
