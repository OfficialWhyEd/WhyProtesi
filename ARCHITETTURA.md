# Architettura

Nata il 17/09/2026. La persona pensa a COSA fare. Tutto il resto lo fa questo programma, insieme a Claude.

## Come gira

```
la persona scrive a Claude
      |
      v
registro.js  (hook di Claude Code)  ->  dati/protesi.db  (SQLite: ogni messaggio, con l'ora)
                                              |
        ogni 10 minuti (task "WhyEd Protesi Guardiano", nascosto)
                                              v
guardiano.js  --------------------->  Groq (gpt-oss-120b) / Gemini di riserva
   entrata: c'e' una cosa da fare? importanza 1-5? e' gia' in lista?
            importanza 4-5 + doppio controllo doppioni -> segna.js nuovo (backup + storico)
   uscita:  quando Claude e' fuori quota, riordino applicato: FATTO con prova verificata due
            volte, DA FARE ORA rimesso in ordine. Le "sospette" restano proposte (decide lui).
                                              |
        ogni mattina dalle 6 (lanciata dal guardiano)
                                              v
rianalisi.js  -> rilegge TUTTA la giornata di ieri con Gemini 3.5 flash
   cose sfuggite (in lista da sole solo con importanza 5 e citazione verificata)
   decisioni e regole dette da lui, come decide (per iWhy), temi con le ore, umore
   -> dati/giorni/AAAA-MM-GG.md, iwhy/osservazioni.md, iwhy/decisioni.md
   -> dati/schema.md (la mappa di tutto per progetto), dati/orari.md (quando scrive)
```

## I fogli (in `dati/`)

| File | Cosa c'e' |
|---|---|
| `lavori.json` | LA LISTA. Si tocca solo con `segna.js` |
| `protesi.db` | tutti i suoi messaggi (`messaggi`), i candidati (`candidati`), i giri (`giri`), i giorni riletti (`giorni`) |
| `riordino.md` | ordine consigliato, urgenti, sembra fatto, quando farle |
| `agenda.json` | le fasce consigliate: Claude le mette nel Google Calendar come "Lista: ..." |
| `calendario.json` | fotografia del Google Calendar (impegni fissi, ore migliori), aggiornata da Claude |
| `schema.md` | la mappa di tutto, per progetto |
| `orari.md` | quando scrive e quando no |
| `giorni/` | un foglio per ogni giornata riletta |
| `storico.txt` | ogni modifica alla lista, di chiunque (righe `GUARDIANO` = fatte dal programma) |
| `protesi.log` | errori e tentativi dei modelli |
| `chiavi-morte.json` | chiavi API che hanno risposto 400/403, escluse per 7 giorni |

## I comandi

```
node guardiano.js                      giro normale (messaggi piu' vecchi di 15 min)
node guardiano.js --secco --forza      prova su tutto senza toccare niente
node guardiano.js --riordino           proposte in dati/riordino.md + agenda.json
node guardiano.js --riordino --applica applica davvero (FATTO con prova, ordine)
node rianalisi.js                      rilegge i giorni non ancora fatti (fino a ieri)
node rianalisi.js --giorno 2026-09-17 --secco
node rianalisi.js --solo-schema        rifa' schema.md e orari.md
node orari.js                          il quadro degli orari
node importa-sessioni.js               importa dalle sessioni salvate (finche' l'hook non c'e')
node iwhy/registra.js ...              il registro di iWhy (vedi iwhy/COME-SI-USA.md)
```

## Le chiavi

Lette al volo dai file indicati in `PROTESI_PORTACHIAVI` (Gemini) e `PROTESI_ZSHRC` (Groq), fuori dal repo. Mai copiate qui. Groq ha un tetto di 8000 token al minuto: per questo i lotti sono piccoli.

## Cosa manca ancora

- l'hook in `~/.claude/settings.json` (si attiva da `/hooks`: UserPromptSubmit -> `node registro.js`)
- il calendario in scrittura diretta dal programma (oggi lo scrive Claude in sessione da `agenda.json`)
- lo slash `/iwhy` (auto mode blocca la skill; si attiva scrivendo "attiva iWhy")
