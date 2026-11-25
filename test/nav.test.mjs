import test from "node:test";
import assert from "node:assert/strict";
import {smoothNav, statoDato, angolo, coordinata, scalaGrafica, numero} from "../js/nav.mjs";

const f = (received, sog, cog) => ({received, sog, cog});

test("barca ferma: velocità mostrata, rotta assente", () => {
  const r = smoothNav([f(0, .14, null), f(1000, .1, null), f(2000, .12, 200)]);
  assert.ok(Math.abs(r.sog - .12) < 1e-9);
  assert.equal(r.cog, null);
});
test("in moto: media circolare della rotta attraverso il nord", () => {
  const r = smoothNav([f(0, 5, 358), f(1000, 5, 2), f(2000, 5, 0)]);
  assert.equal(angolo(r.cog), "000°");
  assert.equal(r.sog, 5);
});
test("la media considera solo gli ultimi 3 secondi", () => {
  const r = smoothNav([f(0, 1, 90), f(10000, 5, 180), f(11000, 5, 180)]);
  assert.equal(r.sog, 5);
  assert.equal(r.n, 2);
});
test("nessun punto: nessun valore inventato", () => {
  assert.deepEqual(smoothNav([]), {sog: null, cog: null, n: 0});
});
test("stato del dato in base all'età", () => {
  assert.equal(statoDato(1000), "vivo");
  assert.equal(statoDato(9000), "vecchio");
  assert.equal(statoDato(20000), "perso");
  assert.equal(statoDato(NaN), "assente");
});
test("formati italiani", () => {
  assert.equal(numero(5.25, 1), "5,3");
  assert.equal(angolo(359.7), "000°");
  assert.equal(angolo(47.2), "047°");
  assert.equal(coordinata(44.77, true), "44° 46,200′ N");
  assert.equal(coordinata(7.777, false), "007° 46,620′ E");
  assert.equal(coordinata(-0.5, true), "00° 30,000′ S");
});
test("scala grafica tonda", () => {
  assert.deepEqual(scalaGrafica(1, 90).metri, 100);
  assert.equal(scalaGrafica(30, 90).etichetta, "2 km");
});

import {derivaMoto} from "../js/nav.mjs";
import {move} from "../js/engine.mjs";
test("rotta e velocità calcolate a un punto al secondo (5 kn, 045°)", () => {
  let p = {lat: 44.166, lon: 8.346}; const storico = [];
  for (let i = 0; i <= 6; i++) { storico.push({...p, accuracy: 3, time: i * 1000}); p = move(p, 45, 2.572); }
  const fix = storico.pop();
  const r = derivaMoto(storico, fix);
  assert.ok(Math.abs(r.sog - 5) < 0.1, "sog " + r.sog);
  assert.ok(Math.abs(r.cog - 45) < 1, "cog " + r.cog);
});
test("barca ferma con rumore GPS: velocità zero, nessuna rotta inventata", () => {
  const storico = [0, 1, 2, 3, 4, 5].map(i => ({lat: 44.166 + (i % 2) * 0.00001, lon: 8.346, accuracy: 3, time: i * 1000}));
  const fix = storico.pop();
  assert.deepEqual(derivaMoto(storico, fix), {sog: 0, cog: null});
});
test("primi secondi: nessun dato sufficiente", () => {
  assert.deepEqual(derivaMoto([{lat: 44, lon: 8, accuracy: 3, time: 0}], {lat: 44, lon: 8, accuracy: 3, time: 1000}), {sog: null, cog: null});
});
