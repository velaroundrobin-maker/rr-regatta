import test from "node:test";
import assert from "node:assert/strict";
import {taratura, muraDa, rottaStabile, stimaDaBolina, analisiVento, buonoScarso, classificaVento, aggiornaAllarmeScarso,
  aggiornaAllarmeRotazione, bordoFavorevole, distanzaLayline, latoFavorito, boaDiBolina} from "../js/vento.mjs";
import {move, bearing, norm} from "../js/engine.mjs";

const vicino = (a, b, tol = 0.5) => assert.ok(Math.abs(((a - b + 540) % 360) - 180) <= tol, a + " ≠ " + b);

test("taratura a motore + due boline: scostamenti misurati", () => {
  const t = taratura({iniziale: {dir: 0, metodo: "motore"}, rif: {dritta: {cog: 313}, sinistra: {cog: 49}}});
  assert.equal(t.off.sinistra, 49);
  assert.equal(t.off.dritta, -47);
  assert.equal(t.angoloVirata, 96);
  assert.equal(t.misurato, true);
});
test("taratura solo con le due boline: bisettrice, anche attraverso il nord", () => {
  const t = taratura({rif: {dritta: {cog: 305}, sinistra: {cog: 35}}});
  vicino(t.dir, 350);
  assert.equal(t.fonte, "boline");
});
test("taratura solo a motore: angolo di virata predefinito", () => {
  const t = taratura({iniziale: {dir: 200, metodo: "motore"}, rif: {}, angoloVirata: 100});
  assert.deepEqual(t.off, {sinistra: 50, dritta: -50});
  assert.equal(t.misurato, false);
});
test("riferimento incoerente (barca poggiata) ignorato", () => {
  const t = taratura({iniziale: {dir: 0}, rif: {sinistra: {cog: 120}}, angoloVirata: 90});
  assert.equal(t.off.sinistra, 45);
});
test("mura dalla rotta e dal vento", () => {
  assert.equal(muraDa(45, 0), "sinistra");
  assert.equal(muraDa(315, 0), "dritta");
  assert.equal(muraDa(5, 340), "sinistra");
});
test("rotta stabile: dispersione e velocità", () => {
  const f = (t, cog, sog = 5) => ({received: t, cog, sog});
  assert.equal(Math.round(rottaStabile([0, 1, 2, 3, 4, 5].map(i => f(i * 1000, 44 + (i % 2) * 2)), 5000).cog), 45);
  assert.equal(rottaStabile([0, 1, 2, 3, 4, 5].map(i => f(i * 1000, 40 + i * 4)), 5000).motivo, "rotta instabile");
  assert.equal(rottaStabile([0, 1, 2, 3, 4, 5].map(i => f(i * 1000, 45, 0.8)), 5000).motivo, "velocità bassa");
});
test("stima del vento dalla bolina e casi esclusi", () => {
  const tar = taratura({iniziale: {dir: 0}, rif: {dritta: {cog: 315}, sinistra: {cog: 45}}});
  const s = stimaDaBolina({cog: 50, bolina: true, tar, adesso: 1e6});
  assert.equal(s.mura, "sinistra"); vicino(s.dir, 5);
  assert.equal(stimaDaBolina({cog: 300, bolina: true, tar, adesso: 1e6}).dir, 345);
  assert.equal(stimaDaBolina({cog: 100, bolina: true, tar, adesso: 1e6}).motivo, "barca poggiata");
  assert.equal(stimaDaBolina({cog: 50, bolina: false, tar, adesso: 1e6}).dir, null);
  assert.equal(stimaDaBolina({cog: 50, bolina: true, tar, ultimaVirata: 1e6 - 5000, adesso: 1e6}).motivo, "appena virato");
});
test("buono e scarso secondo la mura (convenzione dei manuali)", () => {
  // Vento che gira a destra di 5°: mure a sinistra scarso, mure a dritta buono.
  assert.deepEqual(buonoScarso(5, "sinistra"), {tipo: "scarso", gradi: 5});
  assert.deepEqual(buonoScarso(5, "dritta"), {tipo: "buono", gradi: 5});
  assert.equal(buonoScarso(-8, "sinistra").tipo, "buono");
});
test("vento medio e salto recente", () => {
  const c = [];
  for (let i = 0; i < 270; i++) c.push({t: i * 1000, dir: 0});
  for (let i = 270; i < 300; i++) c.push({t: i * 1000, dir: 10});
  const a = analisiVento(c, 299000);
  assert.ok(Math.abs(a.salto - 9) < 1.5, "salto " + a.salto);
});
test("classificazione: oscillante, persistente, stabile", () => {
  const genera = f => Array.from({length: 600}, (_, i) => ({t: i * 2000, dir: norm(f(i * 2 / 60))}));
  const osc = classificaVento(genera(m => 350 + 10 * Math.sin(2 * Math.PI * m / 4)), 1198000);
  assert.equal(osc.tipo, "oscillante");
  assert.ok(osc.periodo > 3 && osc.periodo < 5, "periodo " + osc.periodo);
  const per = classificaVento(genera(m => 10 + 1 * m + 2 * Math.sin(m)), 1198000);
  assert.equal(per.tipo, "persistente"); assert.equal(per.lato, "destra");
  assert.equal(classificaVento(genera(() => 200), 1198000).tipo, "stabile");
  assert.equal(classificaVento([{t: 0, dir: 1}], 1000).tipo, "in raccolta");
});
test("allarme scarso: persistenza, ritorno, nessun allarme sul buono", () => {
  let a = null;
  const scarso = g => ({tipo: "scarso", gradi: g});
  a = aggiornaAllarmeScarso(a, {bs: scarso(10), valido: true, adesso: 0}); assert.equal(a.attivo, false);
  a = aggiornaAllarmeScarso(a, {bs: scarso(10), valido: true, adesso: 15000}); assert.equal(a.attivo, false);
  a = aggiornaAllarmeScarso(a, {bs: scarso(11), valido: true, adesso: 21000}); assert.equal(a.attivo, true);
  a = aggiornaAllarmeScarso(a, {bs: {tipo: "buono", gradi: 4}, valido: true, adesso: 30000}); assert.equal(a.attivo, false);
  a = aggiornaAllarmeScarso(null, {bs: {tipo: "buono", gradi: 15}, valido: true, adesso: 0});
  a = aggiornaAllarmeScarso(a, {bs: {tipo: "buono", gradi: 15}, valido: true, adesso: 60000}); assert.equal(a.attivo, false);
  // Breve oscillazione: il conteggio riparte
  a = aggiornaAllarmeScarso(null, {bs: scarso(9), valido: true, adesso: 0});
  a = aggiornaAllarmeScarso(a, {bs: scarso(3), valido: true, adesso: 10000});
  a = aggiornaAllarmeScarso(a, {bs: scarso(9), valido: true, adesso: 25000}); assert.equal(a.attivo, false);
});
test("allarme rotazione del vento medio attraverso il nord", () => {
  let a = aggiornaAllarmeRotazione(null, {medio: 355, adesso: 0});
  a = aggiornaAllarmeRotazione(a, {medio: 6, adesso: 1000});
  a = aggiornaAllarmeRotazione(a, {medio: 6, adesso: 62000});
  assert.equal(a.attivo, true); assert.equal(Math.round(a.rotazione), 11);
});
test("bordo favorevole verso una boa di bolina", () => {
  const off = {sinistra: 45, dritta: -45};
  // Vento da 0°, boa a 10°: le mure a sinistra (rotta 45°) puntano 20° più vicino delle mure a dritta (315°).
  const b = bordoFavorevole(10, 0, off);
  assert.equal(b.mura, "sinistra"); assert.equal(Math.round(b.vantaggio), 20);
  assert.equal(bordoFavorevole(350, 0, off).mura, "dritta");
  assert.equal(bordoFavorevole(90, 0, off).mura, null); // boa al traverso: si va diritti
  assert.equal(boaDiBolina(0, 0, off), true);
});
test("lay-line: distanza davanti, in lay-line, superata", () => {
  const off = {sinistra: 45, dritta: -45}, boa = {lat: 44.16, lon: 8.35};
  // Barca 1000 m sottovento alla boa (vento da nord), mure a sinistra (rotta 45°):
  // la lay-line di dritta (rotta 315° verso la boa) si incontra dopo circa 707 m.
  const barca = move(boa, 180, 1000);
  assert.ok(Math.abs(distanzaLayline(barca, boa, "sinistra", 0, off) - 707) < 3);
  const sullaLinea = move(boa, 135, 600); // sulla lay-line di dritta
  assert.ok(Math.abs(distanzaLayline(sullaLinea, boa, "sinistra", 0, off)) < 3);
  const oltre = move(boa, 120, 600);
  assert.ok(distanzaLayline(oltre, boa, "sinistra", 0, off) < -50);
});
test("lato favorito della linea di partenza", () => {
  const cdr = {lat: 44.16, lon: 8.35}, pin = move(cdr, 270, 200); // linea est-ovest lunga 200 m
  assert.equal(latoFavorito(cdr, pin, 0).favorito, "neutra");
  const l = latoFavorito(cdr, pin, 350); // vento da 350°: la boa P (a ovest) è più sopravvento
  assert.equal(l.favorito, "P"); assert.ok(Math.abs(l.vantaggio - 200 * Math.sin(10 * Math.PI / 180)) < 0.5);
  assert.ok(Math.abs(l.sbilanciamento - 10) < 0.1);
  assert.equal(latoFavorito(cdr, pin, 15).favorito, "CdR");
});
