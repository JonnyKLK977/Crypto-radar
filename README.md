# Crypto Radar

Dashboard locale per osservare POL, ALGO, ADA e individuare altre crypto tramite uno score quantitativo trasparente.

## Avvio

Da PowerShell, nella cartella del progetto:

```powershell
.\start.ps1
```

Si apre automaticamente `http://127.0.0.1:8765`. Per arrestare il server premi `Ctrl+C` nella finestra PowerShell.

## Demo pubblica

Il progetto include `Dockerfile` e `render.yaml` per pubblicare una demo su Render. La configurazione pubblica imposta `CRYPTO_RADAR_DEMO=1`: portafoglio, piano e diario partono vuoti e tutte le operazioni di scrittura sono bloccate. Non inserire nella demo chiavi API, export personali o dati reali.

Procedura sintetica:

1. Pubblica il progetto in un repository GitHub privato o pubblico.
2. In Render scegli **New > Blueprint** e collega il repository.
3. Render rileva `render.yaml`, costruisce il container e assegna un indirizzo `onrender.com`.
4. Verifica `/api/health` e apri l'indirizzo generato.

La versione demo usa un filesystem temporaneo. Per una futura versione con utenti reali serviranno autenticazione, database separato per utente, cifratura e gestione sicura dei segreti.

## Importazione exchange

La pagina **Exchange & wallet** importa CSV di Coinbase, Kraken e Bitvavo in un registro locale normalizzato. Il flusso prevede anteprima, righe non riconosciute, conferma, deduplicazione tramite impronta del movimento e annullamento dell'intero lotto importato. I dati vengono salvati in `data/transactions.json`, escluso dal repository.

I formati CSV possono cambiare nel tempo: prima di usare il registro per calcoli contabili o fiscali, verifica sempre l'anteprima e confronta i totali con l'exchange.

## Centro operativo

Il **Centro operativo** riunisce quattro strumenti salvati localmente nel browser:

- alert configurabili per movimenti, concentrazione, scostamento dagli obiettivi, score e notizie;
- report settimanale con contributi delle posizioni, controlli del piano e fotografie storiche;
- portafoglio simulato con 10.000 € virtuali, commissioni, posizioni e diario delle operazioni;
- calendario personale con routine DCA/revisione, eventi verificati ed esportazione iCalendar `.ics`.

Le variazioni settimanali precedenti alla prima fotografia sono stime ricostruite dai rendimenti degli asset. Il simulatore non riproduce spread, slippage, profondità di mercato o fiscalità.

Non sono necessarie chiavi API o librerie Python aggiuntive. I dati arrivano dalla API pubblica CoinGecko e il portafoglio viene salvato esclusivamente in `data/portfolio.json`.

La pagina **News & trend** separa volutamente tre concetti diversi:

- qualità quantitativa, rappresentata dallo score;
- popolarità nelle ricerche CoinGecko;
- notizie recenti dal feed RSS CoinDesk.

Una crypto in trend o molto citata non riceve automaticamente un punteggio più alto.

Le notizie combinano il feed internazionale CoinDesk con una sezione italiana dedicata al feed RSS ufficiale di Criptovaluta.it. I titoli italiani vengono mostrati direttamente, senza traduzione automatica, e mantengono sempre fonte e collegamento all'articolo originale.

I titoli CoinDesk vengono tradotti automaticamente in italiano tramite MyMemory. Il titolo inglese originale resta visibile e le traduzioni vengono memorizzate localmente in `data/news_translations_it.json` per evitare richieste ripetute.

La pagina **Piano personale** permette di salvare limiti di rischio, orizzonte, budget mensile e allocazione obiettivo. I dati restano in `data/investment_plan.json`. Include inoltre:

- controllo della concentrazione rispetto ai limiti personali;
- proposta di distribuzione del prossimo versamento verso le posizioni sotto obiettivo;
- simulazione DCA storica su BTC, ETH, POL, ALGO e ADA;
- confronto fra acquisti mensili e investimento immediato dello stesso capitale.

Il **Decision Lab** aggiunge:

- controllo dell'impatto di un acquisto, vendita o ribilanciamento prima dell'esecuzione;
- confronto con limite per posizione e allocazione obiettivo;
- avvisi su concentrazione, FOMO e assenza di una tesi verificabile;
- stress test con scenari modificabili per BTC, ETH e altcoin;
- diario locale di tesi, invalidazione, stato emotivo e rispetto del piano.

Il diario viene salvato in `data/decision_journal.json`.

La pagina **Academy principianti** contiene un percorso educativo in sei moduli:

- basi di crypto, token, exchange e wallet;
- budget, rischio e piano personale;
- analisi di utilità, adozione, tokenomics, liquidità e sicurezza;
- lettura di candele, trend, timeframe, volumi e livelli;
- verifica delle fonti e difesa dall'hype;
- custodia, seed phrase, 2FA e sicurezza delle API.

Include un glossario ricercabile e una checklist pre-acquisto. L'avanzamento viene memorizzato nel browser e non viene inviato al server.

I moduli contengono anche esempi numerici, confronto fra pagamenti blockchain e tradizionali, differenza fra crypto e NFT, procedura di ricerca, rischi distinti per categoria, lettura delle notizie, custodia e controllo delle transazioni.

## Score 0–100

- Momentum: 30%
- Liquidità: 25%
- Tokenomics/diluizione: 20%
- Rischio quantitativo: 25%

Lo score serve a ordinare le crypto per approfondimenti. Non è una previsione né un'indicazione personalizzata di acquisto.

## 730 e fiscalità crypto

La pagina **730 & fiscalità crypto** raccoglie una guida burocratica aggiornata al 2026 con:

- scelta tra modello 730 e Redditi PF;
- procedura di preparazione, invio, pagamento e conservazione;
- checklist locale dei documenti generali e degli estratti crypto;
- spiegazione dei quadri W/RW e T/RT;
- trattamento generale di detenzione, vendite, permute, wallet propri, staking, DeFi e NFT;
- calendario ufficiale 2026, correzioni, ravvedimento e principali sanzioni;
- collegamenti diretti ad Agenzia delle Entrate, Normattiva e Giustizia tributaria.

Il contenuto è educativo e non sostituisce le istruzioni annuali, un CAF o un professionista abilitato. Nessun dato fiscale viene inviato o salvato sul server; lo stato della checklist resta nel browser.

## Limiti della prima versione

- La API pubblica CoinGecko può applicare limiti temporanei.
- Il rischio è una stima quantitativa basata su volatilità, dimensione e classifica, non un'analisi completa del progetto.
- Attività degli sviluppatori, token unlock e concentrazione dei wallet non sono ancora inclusi.
- Le notizie forniscono contesto, ma non vengono analizzate automaticamente come positive o negative.
- Le simulazioni DCA non includono commissioni, spread, staking o fiscalità.
