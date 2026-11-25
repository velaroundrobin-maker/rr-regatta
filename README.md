# RR Regatta

Tattico di bordo basato sul GPS del telefono o del tablet, sviluppato per Round Robin A.S.D.

Sito: https://velaroundrobin-maker.github.io/rr-regatta/

## Versione 0.6 — timer di partenza, cronometro, campi d'allenamento disegnati

- Timer di partenza (Navigazione → Crono): da −5:00, beep lungo a −5, −4, −3, −2, −1, raffica allo zero, poi tempo di regata; Sincronizza al minuto più vicino, ±1 minuto; beep negli ultimi 10 secondi a scelta.
- Distanza-tempo dalla linea: metri, secondi alla velocità attuale, anticipo o ritardo sullo zero, avviso «oltre la linea», estremo superato.
- Cronometro: avvio, pausa, tempi parziali con metri percorsi e velocità media.
- Campi d'allenamento con boe virtuali intorno alla barca, orientati sul vento: solo partenza, partenza e bolina, bastone (1–3 giri), due boe.
- Disegno sulla mappa: tocca per mettere boe, CdR e P; trascina per spostarle; annulla; la sequenza si aggiorna mantenendo i giri.

## Versione 0.5 — polari apprese in allenamento

- Schede riordinate per momento d'uso: Navigazione (lo schermo da guardare navigando), Regata (percorso, boe, taratura, partenza, vento in regata, arrivo, allarmi, con indice in alto), Polari, Altro.
- Nuova scheda Polari: registrazione delle velocità della barca per angolo dal vento, separate per intensità del vento e per vele a riva (J1, J2, J3, Genoa 1–3; randa piena, 1 o 2 mani; spinnaker, gennaker, Code 0).
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
