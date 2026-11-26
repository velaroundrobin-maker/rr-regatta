import test from "node:test";
import assert from "node:assert/strict";
import {uscite, statistiche, prove, veleUsate, eventiVento, modalita} from "../js/rapporto.mjs";

// Uscita finta: 1 ora a 5 nodi verso nord, con una punta isolata di 12 nodi e 2 minuti a 7 nodi.
const T = Date.UTC(2026, 10, 28, 9, 0, 0);
function registroFinto() {
  const r = [];
  let lat = 44.1;
  for (let i = 0; i <= 1800; i++) {
    const v = i === 300 ? 12 : i >= 900 && i < 960 ? 7 : 5;
    r.push([T + i * 2000, +lat.toFixed(6), 8.3, v, 0, 3, i < 600 ? 1 : 0]);
    lat += v * 1852 / 3600 * 2 / 111195;
  }
  return r;
}
test("uscite separate da pause di oltre 2 ore", () => {
  const u = uscite([T, T + 60000, T + 3 * 3600000, T + 3 * 3600000 + 5000, T - 1]);
  assert.equal(u.length, 2); assert.deepEqual(u[0], {da: T - 1, a: T + 60000}); assert.equal(u[1].a, T + 3 * 3600000 + 5000);
});
test("statistiche: distanza, movimento, velocità massima su 10 secondi", () => {
  const r = registroFinto(), st = statistiche(r, {da: T, a: T + 3600000});
  assert.ok(Math.abs(st.distanzaNm - (5 * 58 / 60 + 7 * 2 / 60 + 7 / 3600 * 2)) < 0.03, "distanza " + st.distanzaNm);
  assert.ok(Math.abs(st.movimentoMs - 3600000) < 3000);
  assert.ok(Math.abs(st.max.v - 7) < 1e-9, "la punta di 12 kn non conta: " + st.max.v);
  assert.ok(Math.abs(st.bolinaMs - 1200000) < 3000);
  assert.ok(st.serie.length >= 100 && st.serie.length <= 401);
  assert.ok(Math.abs(st.mediaKn - st.distanzaNm) < 0.05);
});
test("prove: tratti dalla partenza all'arrivo", () => {
  const r = registroFinto(), ev = [
    {t: T + 600000, testo: "PARTENZA dal timer alle 09:10:00"}, {t: T + 1800000, testo: "Passata 1"},
    {t: T + 2400000, testo: "Passata 2"}, {t: T + 3000000, testo: "ARRIVO 09:50:00"}, {t: T + 100, testo: "Modalità Regata"}].reverse();
  const [p] = prove(ev, r, {da: T, a: T + 3600000});
  assert.equal(p.tempo, 2400000); assert.deepEqual(p.passaggi.map(x => x.nome), ["Partenza", "Boa 1", "Boa 2", "Arrivo"]);
  assert.ok(Math.abs(p.passaggi[1].mediaKn - 5) < 0.05); assert.ok(Math.abs(p.passaggi[2].mediaKn - 5.4) < 0.05, "tratto con 2 minuti a 7 kn: " + p.passaggi[2].mediaKn);
  assert.deepEqual(modalita(ev, {da: T, a: T + 3600000}), ["Regata"]);
});
test("vele usate e eventi del vento", () => {
  const f = {da: T, a: T + 3600000};
  const ev = [{t: T - 86400000, testo: "Vele: J1 · randa piena"}, {t: T + 1200000, testo: "Vele: J2 · randa 1 mano"},
    {t: T + 300000, testo: "Vento a motore: 220°"}, {t: T + 400000, testo: "Bolina stretta mure a dritta · rotta 175° · vento da 220°"}];
  const v = veleUsate(ev, f, [[T + 5000, 50, 6, 10, 1], [T + 7000, 50, 6, 10, 1]], ["J1|Piena|Nessuna", "J2|1 mano|Nessuna"]);
  assert.deepEqual(v.aBordo, [{nome: "J1 · randa piena", ms: 1200000}, {nome: "J2 · randa 1 mano", ms: 2400000}]);
  assert.deepEqual(v.polari, [{nome: "J2|1 mano|Nessuna", ms: 4000}]);
  assert.equal(eventiVento(ev, f).length, 2);
});
