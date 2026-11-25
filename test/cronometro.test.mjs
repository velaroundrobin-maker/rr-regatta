import test from "node:test";
import assert from "node:assert/strict";
import {avviaTimer, sincronizza, spostaMinuto, segnali, testoTimer, testoCronometro, nuovoCronometro, avviaFerma, tempoCronometro, distanzaTempo} from "../js/cronometro.mjs";
import {move} from "../js/engine.mjs";

test("timer: avvio, sincronizzazione al minuto più vicino, ±1 minuto", () => {
  const t = 1e9, z = avviaTimer(t);
  assert.equal(z - t, 300000);
  assert.equal(sincronizza(z, t + 25000) - (t + 25000), 300000, "a −4:35 sincronizza su −5:00");
  assert.equal(sincronizza(z, t + 35000) - (t + 35000), 240000, "a −4:25 sincronizza su −4:00");
  assert.equal(sincronizza(null, t) - t, 300000, "da fermo parte da −5:00");
  assert.equal(spostaMinuto(z, -1) - t, 240000);
});
test("timer: beep lungo da −5 a −1, raffica allo zero, nessun segnale vecchio", () => {
  const z = 1e9;
  const tutti = [];
  for (let t = z - 301000; t <= z + 2000; t += 200) tutti.push(...segnali(z, t, t + 200));
  assert.deepEqual(tutti.map(x => x.tipo + (x.minuto ?? "")), ["lungo5", "lungo4", "lungo3", "lungo2", "lungo1", "partenza"]);
  assert.equal(segnali(z, z - 61000, z - 59000).length, 1);
  assert.equal(segnali(z, z - 70000, z - 50000).length, 0, "telefono addormentato: il segnale di −1 è passato da 10 s");
  const dieci = [];
  for (let t = z - 12000; t < z; t += 250) dieci.push(...segnali(z, t, t + 250, {ultimi10: true}));
  assert.equal(dieci.filter(x => x.tipo === "breve").length, 10);
});
test("timer: testo prima e dopo la partenza", () => {
  const z = 1e9;
  assert.equal(testoTimer(z, z - 300000), "−5:00");
  assert.equal(testoTimer(z, z - 299001), "−5:00");
  assert.equal(testoTimer(z, z - 298900), "−4:59");
  assert.equal(testoTimer(z, z - 500), "−0:01");
  assert.equal(testoTimer(z, z), "+0:00");
  assert.equal(testoTimer(z, z + 65400), "+1:05");
  assert.equal(testoTimer(z, z + 3725000), "+1:02:05");
});
test("cronometro: avvio, pausa, ripresa", () => {
  let c = nuovoCronometro();
  c = avviaFerma(c, 1000); c = avviaFerma(c, 6000);
  assert.equal(tempoCronometro(c, 99999), 5000);
  c = avviaFerma(c, 10000);
  assert.equal(tempoCronometro(c, 12500), 7500);
  assert.equal(testoCronometro(83456), "1:23,4");
});
test("distanza-tempo: lato del percorso dal vento, anticipo, oltre la linea", () => {
  const centro = {lat: 44.15, lon: 8.3}, vento = 0;
  const cdr = move(centro, 90, 50), p = move(centro, 270, 50);
  const barca = move(centro, 180, 100);
  const r = distanzaTempo({barca, cog: 0, sog: 5, linea: [cdr, p], dirVento: vento, mancanoMs: 60000});
  assert.ok(Math.abs(r.distanza - 100) < 0.5);
  const vms = 5 / 1.943844;
  assert.ok(Math.abs(r.secondi - 100 / vms) < 0.3);
  assert.ok(r.scarto < -20, "arriva in anticipo: " + r.scarto);
  assert.equal(r.oltreLinea, false); assert.equal(r.fuori, null);
  const sopra = distanzaTempo({barca: move(centro, 0, 20), cog: 0, sog: 5, linea: [cdr, p], dirVento: vento, mancanoMs: 30000});
  assert.equal(sopra.oltreLinea, true);
  const via = distanzaTempo({barca, cog: 180, sog: 5, linea: [cdr, p], dirVento: vento});
  assert.equal(via.secondi, null); assert.ok(via.verso < 0);
  const lato = distanzaTempo({barca: move(move(centro, 90, 120), 180, 30), cog: 0, sog: 4, linea: [cdr, p], dirVento: vento});
  assert.equal(lato.fuori, "fuori dalla linea, lato comitato");
  const senzaVento = distanzaTempo({barca, cog: 0, sog: 5, linea: [cdr, p]});
  assert.ok(Math.abs(senzaVento.distanza - 100) < 0.5 && senzaVento.secondi > 0 && senzaVento.orientata === false);
});
