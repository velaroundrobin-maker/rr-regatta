import test from "node:test";
import assert from "node:assert/strict";
import {nuovePolari, verificaPolari, chiaveVele, nomeVele, indiceVele, ventoVero, classeVento, valutaPunto, polare, ottimi,
  velocitaPolare, tabellaCsv, unisciPolari, MIN_PUNTI, migliorTenuta, classiConDati} from "../js/polari.mjs";

test("nomi delle vele", () => {
  assert.equal(nomeVele(chiaveVele({prua: "J2", randa: "1 mano", portante: "Nessuna"})), "J2 · randa 1 mano");
  assert.equal(nomeVele("Nessuna|Piena|Gennaker"), "randa piena · Gennaker");
  assert.equal(nomeVele("Genoa 1|Piena|Code 0"), "Genoa 1 · randa piena · Code 0");
  const p = nuovePolari();
  assert.equal(indiceVele(p, {prua: "J1", randa: "Piena", portante: "Nessuna"}), 0);
  assert.equal(indiceVele(p, {prua: "J2", randa: "Piena", portante: "Nessuna"}), 1);
  assert.equal(indiceVele(p, {prua: "J1", randa: "Piena", portante: "Nessuna"}), 0);
});
test("vento vero dall'anemometro", () => {
  assert.equal(ventoVero(12, "fermo", 5), 12);
  assert.equal(ventoVero(16.5, "motore", 4.5), 12);
  assert.equal(ventoVero(3, "motore", 5), 0);
  assert.equal(ventoVero(NaN, "fermo", 0), null);
  assert.equal(classeVento(11.2), 12); assert.equal(classeVento(10.9), 10); assert.equal(classeVento(2), null); assert.equal(classeVento(30), 25);
});
test("punto accettato solo con rotta e velocità stabili da 20 secondi", () => {
  const adesso = 100000, rif = {dir: 0, t: adesso - 60000}, vento = {tws: 10, t: adesso - 60000};
  const fx = (cog, sog) => Array.from({length: 21}, (_, i) => ({received: adesso - 20000 + i * 1000, cog: cog(i), sog: sog(i), accuracy: 3}));
  const base = {adesso, rif, vento, validitaMs: 20 * 60000};
  const ok = valutaPunto({...base, fixes: fx(i => 45 + (i % 3), () => 6)});
  assert.equal(ok.ok, true); assert.ok(Math.abs(ok.twa - 46) < 1.5); assert.equal(ok.sog, 6);
  assert.equal(valutaPunto({...base, fixes: fx(i => i < 8 ? 315 : 45, () => 6)}).motivo, "rotta non ancora stabile da 20 secondi");
  assert.equal(valutaPunto({...base, fixes: fx(() => 90, i => 4 + i * 0.15)}).motivo, "velocità non ancora stabile");
  assert.equal(valutaPunto({...base, fixes: fx(() => 10, () => 3)}).motivo, "prua quasi al vento");
  assert.match(valutaPunto({...base, rif: {dir: 0, t: adesso - 25 * 60000}, fixes: fx(() => 90, () => 6)}).motivo, /la taratura del vento ha 25 minuti/);
  assert.match(valutaPunto({...base, vento: null, fixes: fx(() => 90, () => 6)}).motivo, /intensità/);
  assert.match(valutaPunto({...base, ultimoCambioVele: adesso - 10000, fixes: fx(() => 90, () => 6)}).motivo, /vele appena cambiate/);
  assert.match(valutaPunto({...base, rif: {dir: 0, t: adesso, fonte: "andatura"}, fixes: fx(() => 90, () => 6)}).motivo, /taratura a motore/);
  assert.match(valutaPunto({...base, rif: {dir: 0, t: adesso, fonte: "bolina"}, fixes: fx(() => 90, () => 6)}).motivo, /due mure/);
  assert.equal(valutaPunto({...base, rif: {dir: 0, t: adesso, fonte: "boline"}, fixes: fx(() => 90, () => 6)}).ok, true);
});

// Barca di prova con una polare nota: v = 7·sin(...) semplificata.
const vera = (twa) => twa < 35 ? 3 : 4 + 3.5 * Math.sin(Math.min(twa, 110) * Math.PI / 180) - (twa > 110 ? (twa - 110) / 70 * 1.2 : 0);
function polariFinte() {
  const p = nuovePolari();
  const k = indiceVele(p, {prua: "J1", randa: "Piena", portante: "Nessuna"});
  let t = 0;
  for (const a of [40, 45, 50, 60, 90, 120, 150, 165]) for (const segno of [1, -1]) for (let i = 0; i < 30; i++) {
    const rumore = ((i * 37) % 11 - 5) / 25;        // ±0,2 kn, deterministico
    p.campioni.push([t += 2000, segno * (a + ((i % 5) - 2)), vera(a) + rumore, 10.4, k]);
  }
  return p;
}
test("polare: percentile per casella, conteggi per mura, angoli ottimi", () => {
  const p = polariFinte(), punti = polare(p, 10, "tutte", {statistica: 80});
  const a60 = punti.find(q => q.twa === 60);
  assert.equal(a60.n, 60); assert.equal(a60.nS, 30); assert.equal(a60.nD, 30); assert.equal(a60.valido, true);
  assert.ok(a60.v > vera(60) && a60.v < vera(60) + 0.25, "80° percentile poco sopra la media: " + a60.v);
  const o = ottimi(punti);
  assert.ok(o.bolina.twa >= 40 && o.bolina.twa <= 60);
  assert.equal(o.poppa.twa, 165);
  assert.ok(Math.abs(velocitaPolare(punti, 75) - (a60.v + punti.find(q => q.twa === 90).v) / 2) < 0.6);
  assert.equal(polare(p, 12, "tutte").length, 0);
});
test("polare: configurazione migliore per angolo e caselle con pochi punti", () => {
  const p = polariFinte();
  const k2 = indiceVele(p, {prua: "Nessuna", randa: "Piena", portante: "Gennaker"});
  for (let i = 0; i < MIN_PUNTI; i++) p.campioni.push([1e6 + i * 2000, 150, vera(150) + 1, 10, k2]);
  for (let i = 0; i < 5; i++) p.campioni.push([2e6 + i * 2000, 120, 9, 10, k2]);
  const punti = polare(p, 10, "tutte", 80);
  assert.equal(punti.find(q => q.twa === 150).config, k2);
  assert.equal(punti.find(q => q.twa === 120).config, 0, "5 punti non bastano a battere una casella valida");
  assert.equal(polare(p, 10, k2, 80).find(q => q.twa === 120).valido, false);
});
test("tabella per il foglio di calcolo", () => {
  const csv = tabellaCsv(polariFinte());
  const righe = csv.trim().split("\r\n");
  assert.equal(righe[0], "Angolo dal vento \\ vento vero (kn);10");
  assert.ok(righe.some(r => /^90;\d+,\d\d$/.test(r)));
  assert.ok(righe.some(r => r.startsWith("Poppa migliore: angolo;165")));
});
test("unione di due file di polari senza doppioni", () => {
  const a = polariFinte(), b = verificaPolari(JSON.parse(JSON.stringify(polariFinte())));
  b.configurazioni = ["J3|2 mani|Nessuna", ...b.configurazioni];
  b.campioni = b.campioni.map(c => [c[0], c[1], c[2], c[3], c[4] + 1]);
  b.campioni.push([9e9, 90, 6, 10, 0]);
  const n = a.campioni.length, aggiunti = unisciPolari(a, b);
  assert.equal(aggiunti, 1); assert.equal(a.campioni.length, n + 1);
  assert.equal(a.configurazioni[a.campioni[a.campioni.length - 1][4]], "J3|2 mani|Nessuna");
  assert.throws(() => verificaPolari({formato: "rr-regatta"}), /polari/);
});
import {PRUA} from "../js/polari.mjs";
test("vele di prua e verifica delle vele salvate", () => {
  assert.deepEqual(PRUA, ["J1", "J2", "J3", "Tormentina"]);
  const p = verificaPolari({...nuovePolari(), vele: {prua: "Genoa 1", randa: "Piena", portante: "Gennaker"}});
  assert.equal(p.vele.prua, "J1"); assert.equal(p.vele.portante, "Gennaker");
});

test("record: velocità media più alta tenuta per 30 secondi, senza le punte", () => {
  // 40 punti a 2 s: 6 kn, con una punta di 9 kn (un'onda) e un tratto di 25 s a 7 kn.
  const lista = Array.from({length: 40}, (_, i) => [i * 2000, 60, i === 5 ? 9 : i >= 20 && i <= 31 ? 7 : 6, 10, 0]);
  const r = migliorTenuta(lista);
  assert.ok(Math.abs(r.v - 7) < 1e-9, "tratto a 7 kn: " + r.v); assert.equal(r.t, 40000);
  assert.equal(migliorTenuta(lista.slice(0, 8)), null, "14 secondi di punti non bastano");
  // Una pausa spezza la sequenza.
  const spezzata = [...lista.slice(0, 8), ...lista.slice(8, 16).map(c => [c[0] + 60000, ...c.slice(1)])];
  assert.equal(migliorTenuta(spezzata), null);
});
test("polare record e polare della sessione", () => {
  const p = polariFinte(), tutti = polare(p, 10, "tutte");
  const a90 = tutti.find(q => q.twa === 90);
  assert.equal(a90.valido, true); assert.ok(a90.v >= vera(90) - 0.05 && a90.v < vera(90) + 0.2, "record a 90°: " + a90.v);
  // Una seconda uscita, più lenta, solo al traverso.
  const t0 = 1e7;
  for (let i = 0; i < 20; i++) p.campioni.push([t0 + i * 2000, 90, vera(90) - 1, 10, 0]);
  const sessione = polare(p, 10, "tutte", {da: t0});
  assert.equal(sessione.length, 1); assert.ok(Math.abs(sessione[0].v - (vera(90) - 1)) < 1e-9);
  assert.ok(Math.abs(polare(p, 10, "tutte").find(q => q.twa === 90).v - a90.v) < 1e-9, "il record non cambia");
  assert.deepEqual(classiConDati(p, {da: t0}), [10]); assert.deepEqual(classiConDati(p, {da: t0 + 1e6}), []);
});
