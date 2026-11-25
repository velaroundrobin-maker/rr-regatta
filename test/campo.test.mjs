import test from "node:test";
import assert from "node:assert/strict";
import {MODELLI, leggiSequenza, tappe, obiettivo, triangola, distanzaTesto, lineaArrivo} from "../js/campo.mjs";
import {nuovaSessione, applicaModello, verifica, carica, salva, CHIAVE} from "../js/stato.mjs";
import {move, bearing, distanceMeters} from "../js/engine.mjs";

const gps = (lat, lon) => ({lat, lon, acc: 3, t: 1, fonte: "gps"});

test("sequenza: partenza esclusa, eventuali, cancello e arrivo", () => {
  assert.deepEqual(tappe("S - (D) - 1A - 2 - G - 1A - 2 - F").map(t => t.codice + (t.opzionale ? "?" : "") + ":" + t.tipo),
    ["D?:boa", "1A:boa", "2:boa", "G:cancello", "1A:boa", "2:boa", "F:arrivo"]);
  assert.equal(leggiSequenza("S - 1 - 1d - 2 - F")[0].tipo, "partenza");
});
test("modelli dalle istruzioni: Loano 2 giri e Alassio", () => {
  assert.equal(tappe(MODELLI["loano-2"].sequenza).length, 7);
  assert.equal(MODELLI["alassio-3-1"].sequenza, "S - A - A1 - B - A - A1 - B - A - A1 - B - F");
  assert.equal(MODELLI["alassio-3-2"].sequenza, "S - A - A1 - B - A - A1 - B - F");
  assert.equal(MODELLI["alassio-1-2"].sequenza, "S - (D) - 1B - 2 - G - 1B - 2 - F");
  assert.equal(MODELLI["alassio-2-1"].sequenza, "S - (D) - 2 - 1A - G - 2 - 1A - F");
  const b4 = MODELLI["loano-4"].boe.find(b => b.codice === "4").pos;
  assert.ok(Math.abs(b4.lat - (44 + 9.023 / 60)) < 1e-9 && b4.fonte === "istruzioni");
});
test("obiettivo: boa con posizione GPS, bearing e distanza calcolabili", () => {
  const s = nuovaSessione("loano-1");
  const barca = {lat: 44.13, lon: 8.28};
  s.boe.find(b => b.codice === "1").pos = gps(...Object.values(move(barca, 10, 1500)));
  const o = obiettivo(s, 0, barca);
  assert.equal(o.tappa.codice, "1");
  assert.ok(Math.abs(bearing(barca, o.pos) - 10) < 0.1);
});
test("obiettivo: un solo rilevamento dà la direzione finché ci si sposta meno di 200 m", () => {
  const s = nuovaSessione("loano-1");
  const barca = {lat: 44.13, lon: 8.28};
  s.boe.find(b => b.codice === "1").osservazioni.push({...barca, rilevamento: 25, t: 1});
  assert.equal(obiettivo(s, 0, move(barca, 45, 150)).rilevamento, 25);
  const lontano = obiettivo(s, 0, move(barca, 45, 300));
  assert.equal(lontano.rilevamento, null);
  assert.match(lontano.motivo, /ripetere/);
});
test("obiettivo: cancello e arrivo dal centro della linea", () => {
  const s = nuovaSessione("alassio-1-1");
  s.boe.find(b => b.codice === "CdR").pos = gps(44, 8);
  s.boe.find(b => b.codice === "P").pos = gps(44, 8.002);
  const t = tappe(s.campo.sequenza), g = t.findIndex(x => x.tipo === "cancello"), f = t.findIndex(x => x.tipo === "arrivo");
  assert.ok(Math.abs(obiettivo(s, g, {lat: 44.01, lon: 8}).pos.lon - 8.001) < 1e-9);
  assert.ok(lineaArrivo(s)); // ad Alassio 1/2 l'arrivo coincide con la partenza
  assert.equal(obiettivo(s, f, null).fonte, "linea");
  const l = nuovaSessione("loano-1");
  assert.equal(obiettivo(l, 3, null).pos, null); // arrivo Loano: estremi non ancora segnati
});
test("triangolazione da due rilevamenti", () => {
  const boa = {lat: 44.15, lon: 8.35}, a = {lat: 44.14, lon: 8.34}, b = move(a, 90, 400);
  const p = triangola([{...a, rilevamento: bearing(a, boa), t: 1}, {...b, rilevamento: bearing(b, boa), t: 2}]);
  assert.ok(distanceMeters(p, boa) < 5);
  assert.equal(triangola([{...a, rilevamento: 30, t: 1}, {...a, rilevamento: 31, t: 2}]), null);
});
test("cambio modello: le posizioni GPS delle boe con lo stesso codice restano", () => {
  const s = nuovaSessione("loano-1");
  s.boe.find(b => b.codice === "CdR").pos = gps(44, 8);
  s.boe.find(b => b.codice === "1").pos = gps(44.02, 8);
  const {sessione, perse} = applicaModello(s, "loano-2");
  assert.deepEqual(sessione.boe.find(b => b.codice === "1").pos, gps(44.02, 8));
  assert.equal(perse.length, 0);
  const verso = applicaModello(s, "alassio-3-1");
  assert.deepEqual(verso.perse.map(b => b.codice), ["1"]);
  assert.deepEqual(verso.sessione.boe.find(b => b.codice === "CdR").pos, gps(44, 8));
});
test("salvataggio e verifica dei file", () => {
  const mem = new Map(), memoria = {getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v)};
  const s = nuovaSessione("loano-2");
  assert.equal(salva(memoria, s), true);
  assert.equal(carica(memoria).campo.modello, "loano-2");
  mem.set(CHIAVE, "{rotto");
  assert.equal(carica(memoria), null);
  assert.throws(() => verifica({formato: "altro"}), /RR Regatta/);
});
test("distanze in metri e miglia", () => {
  assert.equal(distanzaTesto(820.4), "820 m");
  assert.equal(distanzaTesto(1852 * 1.236), "1,24 NM");
});

test("sessioni delle versioni precedenti ricevono vento e dati della barca", () => {
  const vecchia = nuovaSessione("loano-1"); delete vecchia.vento; delete vecchia.barca; delete vecchia.registro;
  const v = verifica(JSON.parse(JSON.stringify(vecchia)));
  assert.equal(v.vento.imp.soglia, 6); assert.deepEqual(v.vento.rif, {dritta: null, sinistra: null});
  assert.equal(v.barca.lunghezza, 10); assert.deepEqual(v.registro, []);
});

import {campoAllenamento, sequenzaDisegnata, prossimoCodice} from "../js/campo.mjs";
import {distanceMeters as dm, bearing as br} from "../js/engine.mjs";
test("campi d'allenamento intorno alla barca e orientati sul vento", () => {
  const centro = {lat: 44.15, lon: 8.3};
  const c = campoAllenamento("bastone", {centro, vento: 200, lunghezza: 120, distanza: 500, giri: 2, adesso: 5});
  assert.equal(c.sequenza, "S - 1 - 2 - 1 - 2 - F");
  const [cdr, p, uno, due] = c.boe;
  assert.ok(Math.abs(dm(cdr.pos, p.pos) - 120) < 0.5);
  assert.ok(Math.abs(br(p.pos, cdr.pos) - 290) < 0.5, "CdR a destra guardando il vento");
  assert.ok(Math.abs(dm(centro, uno.pos) - 500) < 0.5 && Math.abs(br(centro, uno.pos) - 200) < 0.5);
  assert.ok(Math.abs(br(centro, due.pos) - 20) < 0.5);
  assert.equal(uno.pos.fonte, "disegnata");
  assert.equal(campoAllenamento("partenza", {centro, vento: 0}).sequenza, "S");
  assert.equal(campoAllenamento("dueboe", {centro, vento: 0, giri: 3}).sequenza, "1 - 2 - 1 - 2 - 1 - 2");
  assert.throws(() => campoAllenamento("triangolo", {centro, vento: 0}));
});
test("sequenza del campo disegnato e codici nuovi", () => {
  const pos = {lat: 44, lon: 8};
  const boe = [{codice: "CdR", tipo: "partenza", pos}, {codice: "P", tipo: "partenza", pos: null}, {codice: "1", tipo: "percorso", pos}, {codice: "3", tipo: "percorso", pos}];
  assert.equal(sequenzaDisegnata(boe), "1 - 3");
  boe[1].pos = pos;
  assert.equal(sequenzaDisegnata(boe), "S - 1 - 3 - F");
  assert.equal(prossimoCodice(boe), "2");
});
import {aggiornaSequenza} from "../js/campo.mjs";
test("disegno: la boa nuova va prima dell'arrivo e i giri restano", () => {
  const pos = {lat: 44, lon: 8};
  const boe = [{codice: "CdR", pos}, {codice: "P", pos}, {codice: "1", pos}, {codice: "2", pos}, {codice: "3", pos}];
  assert.equal(aggiornaSequenza("S - 1 - 2 - 1 - 2 - F", boe, {aggiunta: "3"}), "S - 1 - 2 - 1 - 2 - 3 - F");
  assert.equal(aggiornaSequenza("S - 1 - 2 - 1 - 2 - F", boe, {tolta: "2"}), "S - 1 - 1 - F");
  assert.equal(aggiornaSequenza("1 - 2", boe, {}), "S - 1 - 2 - F", "linea completata: partenza e arrivo");
  assert.equal(aggiornaSequenza("S - (D) - 1 - F", boe, {aggiunta: "3"}), "S - (D) - 1 - 3 - F");
  assert.equal(aggiornaSequenza("S - 1 - F", [{codice: "CdR", pos}, {codice: "1", pos}], {}), "1", "senza linea niente partenza");
  assert.equal(aggiornaSequenza("S", boe, {aggiunta: "1"}), "S - 1 - F");
  assert.equal(aggiornaSequenza("S - 1 - F", boe, {tolta: "1"}), "S");
});
