# RR Regatta

Tattico di bordo basato sul GPS del telefono o del tablet, sviluppato per Round Robin A.S.D.

Sito: https://velaroundrobin-maker.github.io/rr-regatta/

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
- `test/` — `node --test test/*.test.mjs`
