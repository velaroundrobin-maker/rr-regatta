import test from "node:test";
import assert from "node:assert/strict";
import {taratura, muraDa, rottaStabile, stimaDaBolina, analisiVento, buonoScarso, classificaVento, aggiornaAllarmeScarso,
  aggiornaAllarmeRotazione, bordoFavorevole, distanzaLayline, latoFavorito, boaDiBolina} from "../js/vento.mjs";
import {move, bearing, norm, delta} from "../js/engine.mjs";

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

test("taratura: le boline vicine al vento a motore danno lo scostamento di ciascuna mura", () => {
  const T = 1e9;
  const t = taratura({iniziale: {dir: 0, metodo: "motore", t: T}, rif: {dritta: {cog: 313, t: T + 120000}, sinistra: {cog: 49, t: T + 300000}}});
  assert.equal(t.dir, 0); assert.equal(t.fonte, "motore"); assert.equal(t.t, T);
  assert.equal(t.off.sinistra, 49); assert.equal(t.off.dritta, -47);
});
test("taratura: una coppia di boline più recente diventa il nuovo riferimento", () => {
  const T = 1e9, min = 60000;
  const t = taratura({iniziale: {dir: 0, metodo: "motore", t: T}, rif: {dritta: {cog: 325, t: T + 40 * min}, sinistra: {cog: 61, t: T + 42 * min}}});
  vicino(t.dir, 13); assert.equal(t.fonte, "boline"); assert.equal(t.t, T + 40 * min);
  assert.equal(t.off.sinistra, 48); assert.equal(t.off.dritta, -48); assert.equal(t.angoloVirata, 96); assert.equal(t.misurato, true);
});
test("taratura: una sola bolina nuova, lontana dal vento a motore, non sposta lo scostamento", () => {
  const T = 1e9, min = 60000;
  const t = taratura({iniziale: {dir: 0, metodo: "motore", t: T}, rif: {dritta: {cog: 315, t: T + 40 * min}, sinistra: {cog: 46, t: T + 2 * min}}});
  assert.equal(t.fonte, "motore"); assert.equal(t.off.sinistra, 46); assert.equal(t.off.dritta, -46);
});
test("taratura: vento a motore più recente della coppia di boline", () => {
  const T = 1e9, min = 60000;
  const t = taratura({iniziale: {dir: 20, metodo: "motore", t: T + 60 * min}, rif: {dritta: {cog: 315, t: T}, sinistra: {cog: 45, t: T + min}}, angoloVirata: 90});
  assert.equal(t.dir, 20); assert.equal(t.fonte, "motore"); assert.deepEqual(t.off, {sinistra: 45, dritta: -45}); assert.equal(t.misurato, false);
});
import {andatura} from "../js/vento.mjs";
test("andatura dall'angolo tra rotta e vento", () => {
  assert.equal(andatura(45, 0).nome, "Bolina stretta");
  assert.equal(andatura(45, 0).mura, "sinistra");
  assert.equal(andatura(300, 0).nome, "Bolina larga");
  assert.equal(andatura(300, 0).mura, "dritta");
  assert.equal(andatura(90, 0).nome, "Traverso");
  assert.equal(andatura(230, 100).nome, "Lasco");
  assert.equal(andatura(150, 0).nome, "Gran lasco");
  assert.equal(andatura(178, 0).nome, "Poppa");
  assert.equal(andatura(10, 0).nome, "Prua al vento");
  assert.equal(andatura(NaN, 0), null);
});
import {ventoDaAndatura, ANDATURE} from "../js/vento.mjs";
test("vento dall'andatura dichiarata, coerente con l'andatura mostrata", () => {
  assert.equal(ventoDaAndatura(120, "Traverso", "sinistra"), 30);
  assert.equal(ventoDaAndatura(120, "Traverso", "dritta"), 210);
  assert.equal(ventoDaAndatura(10, "Lasco", "sinistra"), 250);
  assert.equal(ventoDaAndatura(300, "Bolina stretta", "dritta", 44), 344);
  assert.equal(ventoDaAndatura(120, "Traverso", "boh"), null);
  for (const nome of ANDATURE) for (const mura of ["sinistra", "dritta"]) {
    const cog = 77, w = ventoDaAndatura(cog, nome, mura, 42), a = andatura(cog, w);
    assert.equal(a.nome, nome, nome + " " + mura); assert.equal(a.mura, mura);
  }
});

test("taratura dalla bolina stretta dichiarata: una mura usa l'angolo presunto, la coppia dà la bisettrice", () => {
  const T = 1e9, min = 60000;
  const una = taratura({iniziale: {dir: 2, metodo: "bolina", t: T}, rif: {dritta: {cog: 317, t: T}}, angoloVirata: 90});
  assert.equal(una.dir, 2); assert.equal(una.fonte, "bolina"); assert.equal(una.misurato, false);
  const due = taratura({iniziale: {dir: 2, metodo: "bolina", t: T}, rif: {dritta: {cog: 317, t: T}, sinistra: {cog: 41, t: T + 6 * min}}, angoloVirata: 90});
  assert.equal(due.fonte, "boline"); assert.ok(Math.abs(delta(due.dir, 359)) < 0.01, "bisettrice 359°: " + due.dir);
  assert.equal(due.misurato, true); assert.ok(Math.abs(due.angoloVirata - 84) < 0.01);
  // Boline troppo lontane nel tempo: resta la bolina dichiarata.
  const lontane = taratura({iniziale: {dir: 2, metodo: "bolina", t: T + 30 * min}, rif: {dritta: {cog: 317, t: T + 30 * min}, sinistra: {cog: 41, t: T}}, angoloVirata: 90});
  assert.equal(lontane.fonte, "bolina");
});

test("vento medio: subito dopo la taratura il riferimento è la taratura", () => {
  // Tarato a 0°; poi 2 minuti di bolina con il vento che ruota fino a 4°.
  const c = Array.from({length: 120}, (_, i) => ({t: i * 1000, dir: 4 * i / 119}));
  const a = analisiVento(c, 119000, {tarDir: 0});
  assert.ok(a.medio > 0.3 && a.medio < 1.5, "riferimento vicino alla taratura: " + a.medio);
  assert.ok(a.salto > 2.5 && a.salto < 3.6, "salto visibile: " + a.salto);
  assert.equal(analisiVento([], 1000, {tarDir: 7}).medio, 7);
  assert.equal(classificaVento(Array.from({length: 150}, (_, i) => ({t: i * 2000, dir: 200})), 298000).tipo, "stabile", "prima stima dopo 4-5 minuti");
});
