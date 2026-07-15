# Crypto Radar

Dashboard per seguire fino a cinque crypto personali e individuare altre opportunità tramite uno score quantitativo trasparente.

Nella Home, **Posizioni fissate** è personalizzabile per ciascun browser: l’utente può aggiungere e rimuovere fino a 5 crypto tra le 200 monitorate. La selezione è distinta dal portafoglio e non viene inviata al server. La stessa pagina include il cambio lingua rapido, i cinque maggiori rialzi e ribassi settimanali ricavati dall’API ufficiale CoinMarketCap tra le prime 100 crypto idonee e gli ultimi articoli di Criptovaluta.it.

La pagina **Il mio portafoglio** parte vuota: POL, ALGO, ADA o altre crypto non vengono assegnate automaticamente. L'utente può aggiungere e rimuovere liberamente fino a 30 asset dal catalogo di mercato, quindi compilare quantità e costo medio. Nella demo pubblica portafoglio e piano vengono salvati soltanto nel browser utilizzato.

## Avvio

Da PowerShell, nella cartella del progetto:

```powershell
.\start.ps1
```

Si apre automaticamente `http://127.0.0.1:8765`. Per arrestare il server premi `Ctrl+C` nella finestra PowerShell.

## Demo pubblica

Il progetto include `Dockerfile` e `render.yaml` per pubblicare una demo su Render. La configurazione pubblica imposta `CRYPTO_RADAR_DEMO=1`: portafoglio, piano e diario partono vuoti e le scritture sul server sono bloccate. Preferenze come posizioni fissate, progresso delle guide e strumenti del Centro operativo possono invece restare nel browser. Non inserire nella demo chiavi API, export personali o dati reali.

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

## Copilota 360

Il **Copilota 360** è un livello locale di controllo e documentazione, non un servizio di consulenza o esecuzione. Comprende:

- simulatore pre-azione con impatto su concentrazione, allocazione crypto, costi e stress della posizione;
- semaforo che misura la completezza del processo, senza prevedere il rendimento;
- Passaporti delle decisioni con tesi, invalidazione, fonti e fotografia dello score;
- Indicatore di preparazione fiscale con anomalie e checklist annuale;
- confronto tra fotografie dello score e relative componenti;
- Radar sicurezza guidato per URL, provider, wallet e contratti;
- report HTML redatto per familiare o commercialista;
- backup JSON, profilo locale, inventario e cancellazione dei dati del browser;
- Tutor contestuale disponibile in tutte le pagine;
- punteggio di disciplina basato su attività prudenti, non sul numero di operazioni.

I link condivisibili con scadenza e la sincronizzazione tra dispositivi non sono attivi: richiedono account reali, database persistente, isolamento per utente, gestione del consenso e verifica legale. La demo non simula queste garanzie.

Non sono necessarie chiavi API o librerie Python aggiuntive. I dati arrivano dalla API pubblica CoinGecko e il portafoglio viene salvato esclusivamente in `data/portfolio.json`.

Se CoinGecko applica temporaneamente un limite all’IP del server, `/api/markets` utilizza uno snapshot ridotto incluso nel progetto e lo segnala come `stale: true`. L’interfaccia mostra chiaramente “Dati di riserva” con la data dello snapshot; appena la fonte live torna disponibile, il server riprende automaticamente i dati correnti.

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

La pagina **Guide & Manuali** contiene un percorso educativo in quindici moduli:

- basi di crypto, token, exchange e wallet;
- budget, rischio e piano personale;
- analisi di utilità, adozione, tokenomics, liquidità e sicurezza;
- lettura di candele, trend, timeframe, volumi e livelli;
- verifica delle fonti e difesa dall'hype;
- custodia, seed phrase, 2FA e sicurezza delle API.
- scelta e apertura di wallet per reti EVM/POL, Algorand e Cardano;
- manuale di Panoramica, Opportunity screener e dettaglio crypto;
- uso guidato di portafoglio, import CSV e Piano personale;
- manuale completo di Decision Lab e Centro operativo;
- flusso di News, Metodo e guida fiscale.
- manuale completo del Copilota 360, della condivisione e del Centro privacy.
- manuale di Execution Lab, Risk Engine e verifica degli operatori nel registro MiCA.

Include un glossario ricercabile e una checklist pre-acquisto. L'avanzamento viene memorizzato nel browser e non viene inviato al server.

## Strumenti avanzati

La modalità Avanzata include tre strumenti con fonti e limiti dichiarati:

- **Execution Lab** confronta gli order book pubblici BTC/altcoin-EUR di Coinbase, Kraken e Bitvavo e mostra spread, VWAP, slippage, fill e profondità osservata;
- **Risk Engine** combina le posizioni del portafoglio usando serie orarie Kraken e calcola volatilità annualizzata, beta BTC, numero effettivo di posizioni, proxy storica di perdita, correlazioni e contributi al rischio;
- **Verifica MiCA** cerca nome, dominio o LEI nei CSV ufficiali ESMA dei CASP autorizzati e delle entità non conformi.

Sono strumenti informativi: non eseguono ordini, non certificano operatori e non stimano la perdita massima futura.

## Lingue

Il selettore nell'intestazione e quello dedicato nella Home permettono di usare l'interfaccia in **italiano, inglese o spagnolo**. I due controlli sono sincronizzati e la preferenza resta nel browser. I dizionari locali inclusi in `web/i18n-en.json` e `web/i18n-es.json` coprono pagine, guide, moduli, attributi accessibili e messaggi dinamici; il cambio lingua non invia dati personali a servizi di traduzione. Le notizie mantengono sempre il titolo originale e possono richiedere una traduzione automatica separata.

I moduli contengono anche esempi numerici, confronto fra pagamenti blockchain e tradizionali, differenza fra crypto e NFT, procedura di ricerca, rischi distinti per categoria, lettura delle notizie, custodia e controllo delle transazioni.

Le funzioni locali includono inoltre onboarding iniziale, modalità Principiante/Avanzata, pausa anti-FOMO, report mensile del comportamento, Centro qualità dati e installazione PWA quando supportata dal browser.

## Score 0–100

- Momentum: 30%
- Liquidità: 25%
- Tokenomics/diluizione: 20%
- Rischio quantitativo: 25%

Lo score serve a ordinare le crypto per approfondimenti. Non è una previsione né un'indicazione personalizzata di acquisto.

## 730 e fiscalità crypto

La pagina **730 & fiscalità crypto** raccoglie una guida burocratica aggiornata al 2026 con 15 capitoli, tra cui:

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
