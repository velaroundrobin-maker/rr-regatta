# RR Regatta

Tattico di bordo basato sul GPS del telefono o del tablet, sviluppato per Round Robin A.S.D.

Sito: https://velaroundrobin-maker.github.io/rr-regatta/

## Versione 0.11.1

- Taratura possibile da 0,7 nodi: rotta = media vettoriale delle velocità GPS, su 20 s sotto i 2 nodi (10 s sopra), scarto ammesso che cresce al calare della velocità, controllo che la barca non stia girando.

## Versione 0.11

- Registrazione per modalità: entrando si sceglie «Registrare la traccia? Sì / No»; traccia, dati ogni 2 s e punti delle polari si salvano solo durante una registrazione («● REG» in alto, Stop in Navigazione/Polari o dalla pagina iniziale).
- «Parametri» in tutte le modalità (strumenti, preparazione, scheda Regata): a vela / a motore, vento vero dichiarato, taratura, vele. La taratura a motore mette «a motore»; le polari si registrano solo a vela.
- Polari in ogni modalità, per combinazione di vele; vento vero fino a 30 nodi; sessione = registrazione, confrontata con il record delle stesse vele.
- Rapporto PDF per registrazione, con le sole sezioni della modalità; polari della sessione e record per le vele usate; tempo a motore.
- Vento: riferimento = taratura appena fatta, poi media delle stime; vento attuale su 30 s; scarso da 4° (allarme 4° per 20 s); tipo di vento: prima stima dopo 4 minuti.
- Layout: comandi della mappa a tutta altezza, pulsanti in basso uguali, barra di Android sempre visibile a schermo intero, tasto Indietro dentro l'app, GPS acceso/spento nelle impostazioni.

## Versione 0.10

- Taratura del vento in due modi: prua al vento a motore o bolina stretta (mure a sinistra o a dritta); con le due mure il vento è la bisettrice e l'angolo di virata è misurato. Le altre andature sono indicazioni dell'equipaggio. Tolto il vento «a mano».
- Polari record (media più alta tenuta per 30 s, tutte le uscite) e polari della sessione (l'ultima uscita), con confronto e ★ per i record nuovi; «% del record» sugli strumenti. Per le polari valgono la taratura a motore e la bolina sulle due mure.
- Diagramma polare più leggero: cerchi ogni 2 nodi (4 sopra i 10), raggi ogni 30°.
- Rapporto PDF dell'uscita (File, registro e impostazioni; scheda Polari): riepilogo, traccia, velocità nel tempo, prove con tempi dei tratti, vento, vele, polari della sessione e record, registro. Libreria jsPDF 2.5.2 (MIT) in `lib/`.
- Guida riscritta: che cosa fa l'app, sviluppi futuri (sensori nostri), Navigazione, Regata, Allenamento, Polari, timer, rapporto, dati e impostazioni.

## Versione 0.9.2

- Mappa senza sovrapposizioni: colonna dei comandi a destra e posizione sotto la mappa, fuori dal disegno.
- Freccia del vento sul bordo da cui arriva, con la scritta accanto; si scosta se lì c'è una boa.
- Sigle delle boe che evitano bussola, scritte, boe e barca; i gradi della bussola sotto una boa si nascondono.
- Tempo del timer sul pulsante Timer (bordato di rosso).
- Mentre si disegna la mappa prende il posto degli strumenti; con «Fine» inquadra barca e boe.
- Avvisi in alto, che non bloccano i tocchi.
- Telefoni piccoli (360×640): comandi della mappa che si accorciano, intestazione su una riga, vele colorate leggibili.

## Versione 0.9.1

- Reset nell'intestazione, in ogni schermata delle modalità.
- Tocco su una boa: selezione, spostamento trascinando, Cancella (nei campi di regata cancella solo la posizione).
- Preparazione senza i passi GPS e schermo (il GPS compare solo se c'è un problema).
- Navigazione: mappa sempre centrata sulla barca, senza «Barca» e «Tutto».
- Bussola sui bordi della mappa: tacche ogni 10°, gradi ogni 30°, N E S O.
- Richiesta dell'andatura anche appena l'andatura cambia (20 s); «Giusta» su bolina stretta avvia le stime; niente richieste durante la partenza.
- Dichiarazione dell'andatura con rotta stabile entro ±15° (bolina stretta ±8°); selezione di una boa col tocco chiusa da sola dopo 20 s; audio del timer riattivato prima di ogni beep.

## Versione 0.9 — reset, schermo intero, solo verticale

- Reset in fondo alla Preparazione di ogni modalità e Reset generale nelle impostazioni, con «Annulla l'ultimo reset» (copia salvata prima di ogni reset).
- Schermo intero entrando in una modalità (pulsante ⛶ per riattivarlo; si disattiva nelle impostazioni); manifest per l'installazione a schermo intero e in verticale.
- Solo verticale: in orizzontale compare «Gira il telefono in verticale»; a schermo intero l'orientamento è bloccato.
- Andatura e timer si chiudono da soli premendo un altro pulsante.
- Pagina iniziale in maiuscolo; marchio «Round Robin Labs™» nell'intestazione; testi più asciutti.

## Versione 0.8 — andatura dichiarata, pagina iniziale essenziale, disegno dalla mappa

- Pagina iniziale con le sole quattro modalità; toccandone una compare la spiegazione con «Conferma».
- Pulsante «Andatura» (al posto di «Bolina stretta»): l'equipaggio dichiara andatura e mure, l'app ricava il vento dalla rotta; se il vento gira si dichiara la nuova andatura. «Bolina stretta» avvia le stime continue dei salti. Il vento dall'andatura non vale per le polari.
- Richiesta di conferma dell'andatura ogni 3 minuti (5, 10 o mai, nelle impostazioni).
- Freccia del vento girata: indica dove va il vento.
- Boe disegnate in modo sobrio (punto rosso con un anello, anello rosso per la prossima boa); barca comitato disegnata come una barchetta con la prua al vento.
- Pulsante «Disegna» sulla mappa (Allenamento e Regata): barca comitato, pin e boe, col dito o con la pennina, anche senza GPS; su un campo di regata chiede se disegnarne uno nuovo.

## Versione 0.7.3 — testi rivisti e guida

- Tutti i testi riletti e corretti; si usa sempre il «tu». Navigazione: «Strumentazione di bordo»; Regata: «Strumentazione per la regata».
- In Navigazione non compare più il pulsante della bolina stretta; la scheda «Schermo» si chiama «Strumenti».
- Guida completa per i soci: https://velaroundrobin-maker.github.io/rr-regatta/guida/ (collegata dalla pagina iniziale).

## Versione 0.7 — pagina iniziale e preparazione guidata

- All'apertura: Navigazione, Allenamento, Regata, Polari (più file, registro e impostazioni).
- Ogni modalità ha una preparazione guidata: passi spiegati, spunta quando fatti, pulsanti per farli subito, passi facoltativi.
- Navigazione: rotta, velocità, vento medio e andatura (bolina stretta, bolina larga, traverso, lasco, gran lasco, poppa), senza campo.
- Allenamento e Regata: striscia verso la boa, campo sulla mappa, timer. Polari: angolo dal vento, polare e % in tempo reale, pulsante Registra.
- Il GPS si accende da solo all'apertura; entrando in una modalità lo schermo resta acceso.
- Cronometro e timer: pulsante «Stop».

## Versione 0.6 — timer di partenza, cronometro, campi d'allenamento disegnati

- Timer di partenza (Navigazione → Crono): da −5:00, beep lungo a −5, −4, −3, −2, −1, raffica allo zero, poi tempo di regata; Sincronizza al minuto più vicino, ±1 minuto; beep negli ultimi 10 secondi a scelta.
- Distanza-tempo dalla linea: metri, secondi alla velocità attuale, anticipo o ritardo sullo zero, avviso «oltre la linea», estremo superato.
- Cronometro: avvio, pausa, tempi parziali con metri percorsi e velocità media.
- Campi d'allenamento con boe virtuali intorno alla barca, orientati sul vento: solo partenza, partenza e bolina, bastone (1–3 giri), due boe.
- Disegno sulla mappa: tocca per mettere boe, CdR e P; trascina per spostarle; annulla; la sequenza si aggiorna mantenendo i giri.

## Versione 0.5 — polari apprese in allenamento

- Schede riordinate per momento d'uso: Navigazione (lo schermo da guardare navigando), Regata (percorso, boe, taratura, partenza, vento in regata, arrivo, allarmi, con indice in alto), Polari, Altro.
- Nuova scheda Polari: registrazione delle velocità della barca per angolo dal vento, separate per intensità del vento e per vele a riva (J1, J2, J3, tormentina; randa piena, 1 o 2 mani; vele colorate: nessuna, spinnaker, gennaker, Code 0).
- Direzione del vento dalla taratura più recente (prua al vento a motore o coppia di boline); intensità inserita dall'equipaggio con l'anemometro (a barca ferma, oppure a motore prua al vento togliendo la velocità della barca).
- Si registra solo con rotta e velocità stabili da 20 secondi, taratura e vento aggiornati (limite regolabile), un minuto dopo ogni cambio di vele.
- Polare: 80° percentile per casella, punti per mura, angoli migliori di bolina e poppa con la VMC, «% della polare» in tempo reale, diagramma e tabella; esporta, tabella per foglio di calcolo, importa e unisci.
- Taratura: vale sempre la più recente; una coppia di boline registrata dopo più di 20 minuti dal vento a motore diventa il nuovo riferimento.

## Versione 0.4 — vento e tattica di bolina

- Nuova scheda Vento. Taratura del vento in tre modi: a motore con la prua al vento, con le boline sulle due mure (misura l'angolo di virata reale), oppure a mano.
- Pulsante BOLINA in navigazione: le stime del vento si raccolgono solo in bolina stretta confermata, con rotta stabile, lontano dalle virate; si spegne da solo se la barca poggia a lungo.
- Vento medio (3/5/10 minuti), vento degli ultimi 20 secondi, salto e indicazione BUONO/SCARSO per la mura attuale.
- Tipo di vento: oscillante (ampiezza e periodo), persistente (verso e velocità di rotazione) o stabile, con il consiglio strategico dei manuali.
- Allarme SCARSO (soglia e durata regolabili, suono e vibrazione) e allarme di rotazione del vento medio.
- Tattica: bordo favorevole verso la boa, distanza dalla lay-line, «IN LAY-LINE: VIRA», «oltre la lay-line»; lato favorito della linea di partenza in metri e lunghezze. Lay-line e freccia del vento sulla mappa.
- Registro dati (un punto ogni 2 secondi) incluso nel file esportato, per l'analisi dopo le uscite.
- Regole tattiche da: «Regole tattiche per l'app RR Regatta» (cartella Manuali Addestramento AI).

## Versione 0.3 — campo di regata

- Tre schede: Navigazione, Campo, Altro.
- Modelli dalle istruzioni di regata: Loano (bastone 1 e 2 giri, costiere 3, 4, 5) e Alassio 2026 (percorsi 1, 2, 3 per entrambi i raggruppamenti), più campo personalizzato. Le coordinate delle boe 4 e 5 di Loano vengono dalle istruzioni e sono marcate come indicative.
- Striscia «Verso»: prossima tappa con rilevamento, distanza e VMC. Pulsanti «Segna GPS», «Rileva» e «Boa passata»; all'ultima tappa «Taglia il traguardo» (annullabile).
- Rilevamento angolare rispetto alla rotta GPS; con due rilevamenti da punti diversi la boa viene triangolata. Un solo rilevamento dà solo la direzione, valida entro 200 m dal punto d'osservazione.
- Cancello (G) e arrivo puntano al centro della linea quando i due estremi sono noti; linea di partenza in rosso, d'arrivo in bianco.
- Salvataggio automatico sul telefono, esportazione e importazione del file della sessione, registro degli eventi.

## Versione 0.2 — schermata di navigazione

- Rotta (COG) e velocità (SOG) in caratteri grandi, media degli ultimi 3 secondi. Se il telefono non le fornisce, sono calcolate dagli spostamenti degli ultimi secondi; la nota sotto il valore dice da dove arrivano.
- Rotta nascosta sotto 0,5 nodi (a barca ferma è solo rumore GPS).
- Dati segnalati come vecchi dopo 5 s senza punti e nascosti dopo 15 s.
- Mappa con nord in alto: barca, cerchio della precisione, reticolo, scala, traccia facoltativa. Zoom con +/− o due dita, trascinamento, pulsante «Barca» per centrare e seguire.
- «Schermo acceso» impedisce che il telefono si spenga (a schermo spento il browser smette di ricevere il GPS).
- Pagina diagnostica: `diagnostica/`.

Nessun dato viene inviato a server esterni.

## Struttura

- `index.html`, `app.css`, `js/app.mjs` — interfaccia
- `js/engine.mjs` — geometria (rilevamenti, distanze, media circolare, VMG/VMC)
- `js/gps.mjs` — validazione dei punti del browser
- `js/nav.mjs` — smorzamento, moto calcolato, formati italiani
- `js/campo.mjs` — modelli di campo, sequenza, obiettivo della tappa, triangolazione
- `js/stato.mjs` — sessione, cambio modello, salvataggio e verifica dei file
- `js/cronometro.mjs` — timer di partenza, segnali, cronometro, distanza-tempo dalla linea
- `js/polari.mjs` — raccolta dei punti, calcolo della polare, angoli ottimi, tabella, unione di file
- `js/vento.mjs` — taratura, stima del vento in bolina, salto, buono/scarso, tipo di vento, allarmi, bordo favorevole, lay-line, lato favorito della linea
- `test/` — `node --test test/*.test.mjs`
