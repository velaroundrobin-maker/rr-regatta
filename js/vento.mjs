// Vento stimato dal GPS e tattica di bolina (Fase 3 e 4a).
// Regole dai manuali della cartella «Manuali Addestramento AI»: vedi «Regole tattiche per l'app».
// Convenzioni: angoli in gradi da nord vero, in senso orario; «direzione del vento» = da dove viene.
import {norm, delta, circularMean, rad} from "./engine.mjs?v=0.9.2";

export const MURE = ["dritta", "sinistra"];

// ---------------- Taratura ----------------
// cal = {iniziale: {dir, metodo, t} | null, rif: {dritta: {cog,t}|null, sinistra: {cog,t}|null}, angoloVirata: gradi}
// Vale la taratura più recente:
// - il vento a motore (o a mano) è il riferimento; le boline registrate entro 20 minuti da lì danno lo scostamento
//   reale di ciascuna mura (anche asimmetrico, per corrente e scarroccio);
// - una coppia di boline (dritta e sinistra) registrata più di 20 minuti dopo il vento a motore diventa il nuovo
//   riferimento: il vento è la bisettrice e ogni mura sta a metà dell'angolo di virata misurato.
// L'ora del riferimento («t») è quella della lettura più vecchia che lo compone: serve a sapere quanto è aggiornato.
export const FINESTRA_TARATURA_MS = 20 * 60000;
export function taratura(cal) {
  const r = cal?.rif || {}, def = (cal?.angoloVirata || 90) / 2, F = FINESTRA_TARATURA_MS;
  const ini = Number.isFinite(cal?.iniziale?.dir) ? cal.iniziale : null;
  const tOk = x => Number.isFinite(x?.t);
  const coppia = r.dritta && r.sinistra
    ? {dir: circularMean([r.dritta.cog, r.sinistra.cog]), t: tOk(r.dritta) && tOk(r.sinistra) ? Math.min(r.dritta.t, r.sinistra.t) : null} : null;
  const coppiaNuova = coppia && (!ini || (Number.isFinite(coppia.t) && tOk(ini) && coppia.t > ini.t + F));
  if (coppiaNuova) {
    const s = delta(r.sinistra.cog, coppia.dir), ok = s >= 15 && s <= 80;
    const m = ok ? s : def;
    return {dir: coppia.dir, off: {sinistra: m, dritta: -m}, fonte: "boline", t: coppia.t, angoloVirata: 2 * m, misurato: ok};
  }
  if (!ini) return {dir: null, off: null, fonte: null, t: null, angoloVirata: null, misurato: false};
  const dir = ini.dir;
  // Solo le boline vicine nel tempo al riferimento ne misurano lo scostamento.
  const vicina = x => x && (!tOk(x) || !tOk(ini) || Math.abs(x.t - ini.t) <= F);
  let s = vicina(r.sinistra) ? delta(r.sinistra.cog, dir) : null;
  let d = vicina(r.dritta) ? delta(r.dritta.cog, dir) : null;
  if (s !== null && (s < 15 || s > 80)) s = null;   // riferimento incoerente con il vento: ignorato
  if (d !== null && (d > -15 || d < -80)) d = null;
  const misurato = s !== null && d !== null;
  if (s === null && d !== null) s = -d;
  if (d === null && s !== null) d = -s;
  if (s === null) { s = def; d = -def; }
  return {dir, off: {sinistra: s, dritta: d}, fonte: ini.metodo || "motore", t: tOk(ini) ? ini.t : null, angoloVirata: s - d, misurato};
}

export function muraDa(cog, dirVento) {
  if (!Number.isFinite(cog) || !Number.isFinite(dirVento)) return null;
  return delta(cog, dirVento) >= 0 ? "sinistra" : "dritta";
}

// Rotta stabile: dispersione piccola negli ultimi secondi.
export function rottaStabile(fixes, adesso, {finestraMs = 8000, maxDispersione = 6, minSog = 1.5, minPunti = 5} = {}) {
  const v = fixes.filter(f => adesso - f.received <= finestraMs && Number.isFinite(f.cog) && Number.isFinite(f.sog));
  if (v.length < minPunti) return {cog: null, motivo: "pochi dati"};
  if (v.some(f => f.sog < minSog)) return {cog: null, motivo: "velocità bassa"};
  const m = circularMean(v.map(f => f.cog));
  if (m === null) return {cog: null, motivo: "rotta instabile"};
  const disp = Math.max(...v.map(f => Math.abs(delta(f.cog, m))));
  if (disp > maxDispersione) return {cog: null, motivo: "rotta instabile"};
  return {cog: m, motivo: null};
}

// Una stima del vento da una bolina stretta stabile, oppure il motivo per cui non si può stimare.
export function stimaDaBolina({cog, bolina, tar, dirAttuale, ultimaVirata, adesso}) {
  if (!bolina) return {dir: null, motivo: "bolina stretta non confermata"};
  if (!tar?.off || !Number.isFinite(tar.dir)) return {dir: null, motivo: "vento non tarato"};
  if (cog === null) return {dir: null, motivo: "rotta non stabile"};
  const rif = Number.isFinite(dirAttuale) ? dirAttuale : tar.dir;
  const mura = muraDa(cog, rif);
  const angolo = Math.abs(delta(cog, rif)), atteso = Math.abs(tar.off[mura]);
  if (Math.abs(angolo - atteso) > 25) return {dir: null, mura, motivo: angolo > atteso ? "barca poggiata" : "rotta troppo stretta"};
  if (ultimaVirata && adesso - ultimaVirata < 12000) return {dir: null, mura, motivo: "appena virato"};
  return {dir: norm(cog - tar.off[mura]), mura, motivo: null};
}

// ---------------- Vento medio, salto, buono/scarso ----------------
export function mediaVento(campioni, adesso, finestraMs) {
  const v = campioni.filter(c => adesso - c.t <= finestraMs);
  return v.length ? {dir: circularMean(v.map(c => c.dir)), n: v.length} : {dir: null, n: 0};
}
export function analisiVento(campioni, adesso, {mediaMs = 5 * 60000, recenteMs = 20000, tarDir = null} = {}) {
  const m = mediaVento(campioni, adesso, mediaMs);
  const r = mediaVento(campioni, adesso, recenteMs);
  const ultimo = campioni.at(-1);
  const recenteValido = r.n >= 5 && ultimo && adesso - ultimo.t < 6000;
  const medio = m.dir ?? tarDir;
  const primo = campioni.find(c => adesso - c.t <= mediaMs);
  return {medio, nMedia: m.n, copertura: primo ? (adesso - primo.t) / mediaMs : 0, recente: recenteValido ? r.dir : null,
    salto: recenteValido && Number.isFinite(medio) ? delta(r.dir, medio) : null};
}
// In bolina: mure a dritta, vento che gira a destra = buono; mure a sinistra, il contrario.
export function buonoScarso(salto, mura) {
  if (!Number.isFinite(salto) || !mura) return null;
  const buono = mura === "dritta" ? salto > 0 : salto < 0;
  return {tipo: Math.abs(salto) < 1 ? "pari" : buono ? "buono" : "scarso", gradi: Math.abs(salto)};
}

// ---------------- Tipo di vento ----------------
// Regressione lineare della direzione nel tempo: tendenza (persistente) contro oscillazioni attorno alla media.
export function classificaVento(campioni, adesso, {finestraMs = 20 * 60000, minDurataMs = 8 * 60000, minCampioni = 30} = {}) {
  const v = campioni.filter(c => adesso - c.t <= finestraMs);
  if (v.length < minCampioni || v.at(-1).t - v[0].t < minDurataMs)
    return {tipo: "in raccolta", testo: "Servono almeno " + Math.round(minDurataMs / 60000) + " minuti di bolina stretta per capire il tipo di vento."};
  const m = circularMean(v.map(c => c.dir));
  const t0 = v[0].t, xs = v.map(c => (c.t - t0) / 60000), ys = v.map(c => delta(c.dir, m));
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const pendenza = sxx ? sxy / sxx : 0; // gradi al minuto
  const residui = ys.map((y, i) => y - (my + pendenza * (xs[i] - mx))).sort((a, b) => a - b);
  const q = p => residui[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  const ampiezza = (q(0.9) - q(0.1)) / 2;
  const durata = xs.at(-1), rotazione = pendenza * durata;
  // Periodo: passaggi della media mobile attraverso la tendenza.
  let passaggi = 0, segno = 0;
  for (let i = 0; i < n; i++) { const r = ys[i] - (my + pendenza * (xs[i] - mx)); const sg = r > ampiezza * 0.3 ? 1 : r < -ampiezza * 0.3 ? -1 : 0; if (sg && sg !== segno) { if (segno) passaggi++; segno = sg; } }
  const periodo = passaggi >= 2 ? 2 * durata / passaggi : null;
  const lato = pendenza > 0 ? "destra" : "sinistra";
  if (Math.abs(rotazione) >= Math.max(6, 2 * ampiezza))
    return {tipo: "persistente", lato, rotazione, pendenza, ampiezza, periodo, media: m,
      testo: "Rotazione persistente verso " + lato + " (" + Math.round(Math.abs(rotazione)) + "° in " + Math.round(durata) + " min). Vai verso " + lato + ": prima lo scarso, poi vira e arriva in boa sul buono. Attenzione a non superare la lay-line."};
  if (ampiezza >= 3)
    return {tipo: "oscillante", rotazione, pendenza, ampiezza, periodo, media: m,
      testo: "Oscillante ±" + Math.round(ampiezza) + "°" + (periodo ? ", ogni " + Math.round(periodo) + " min circa" : "") + ". Vira sugli scarsi quando superano la media, resta centrale fino all'ultimo terzo della bolina."};
  return {tipo: "stabile", rotazione, pendenza, ampiezza, periodo, media: m,
    testo: "Vento stabile. Conta più la velocità: poche virate e attenzione alle lay-line."};
}

// ---------------- Allarme scarso (tattico, per mura) ----------------
// Scatta se lo scarso supera la soglia per la durata richiesta; si spegne da solo quando lo scarso rientra.
export function aggiornaAllarmeScarso(prec, {bs, valido, adesso, soglia = 6, durataMs = 20000}) {
  const a = {inizio: null, attivo: false, riconosciuto: false, gradi: 0, ...(prec || {})};
  const scarso = valido && bs?.tipo === "scarso" ? bs.gradi : 0;
  if (scarso >= soglia) {
    if (a.inizio === null) a.inizio = adesso;
    a.gradi = scarso;
    if (!a.attivo && adesso - a.inizio >= durataMs) a.attivo = true;
  } else if (scarso < soglia - 2) {
    return {inizio: null, attivo: false, riconosciuto: false, gradi: scarso};
  }
  return a;
}

// ---------------- Rotazione del vento medio (strategico) ----------------
export function aggiornaAllarmeRotazione(prec, {medio, adesso, soglia = 8, durataMs = 60000}) {
  const a = {riferimento: null, inizio: null, attivo: false, rotazione: 0, ...(prec || {})};
  if (!Number.isFinite(medio)) return a;
  if (!Number.isFinite(a.riferimento)) return {...a, riferimento: medio};
  if (a.attivo) return a;
  const r = delta(medio, a.riferimento);
  if (Math.abs(r) < soglia) return {...a, inizio: null, rotazione: r};
  const inizio = a.inizio ?? adesso;
  return {...a, inizio, rotazione: r, attivo: adesso - inizio >= durataMs};
}

// ---------------- Tattica: bordo favorevole, lay-line, linea di partenza ----------------
const R = 6371008.8;
const xy = (p, o) => ({x: rad(p.lon - o.lon) * R * Math.cos(rad(o.lat)), y: rad(p.lat - o.lat) * R});
const versore = b => ({x: Math.sin(rad(b)), y: Math.cos(rad(b))});
const vettoriale = (a, b) => a.x * b.y - a.y * b.x;

export function rotteDiBolina(dir, off) { return {dritta: norm(dir + off.dritta), sinistra: norm(dir + off.sinistra)}; }

// La boa è «di bolina» se il suo rilevamento cade nel settore non navigabile.
export function boaDiBolina(rilevamento, dir, off) {
  const d = delta(rilevamento, dir);
  return d > off.dritta + 3 && d < off.sinistra - 3;
}

export function bordoFavorevole(rilevamento, dir, off) {
  if (!Number.isFinite(rilevamento) || !Number.isFinite(dir) || !off) return null;
  if (!boaDiBolina(rilevamento, dir, off)) return {mura: null, testo: "Boa raggiungibile senza virare"};
  const c = rotteDiBolina(dir, off);
  const ad = Math.abs(delta(c.dritta, rilevamento)), as = Math.abs(delta(c.sinistra, rilevamento));
  const mura = ad <= as ? "dritta" : "sinistra", vantaggio = Math.abs(ad - as);
  return {mura, vantaggio, testo: vantaggio < 2 ? "Bordi equivalenti" : "Mure favorite: " + mura + " (" + Math.round(vantaggio) + "° più verso la boa)"};
}

// Distanza da percorrere sulla mura attuale prima di raggiungere la lay-line (dove si vira e si prende la boa).
// Positiva: lay-line davanti. Negativa: lay-line già superata.
export function distanzaLayline(barca, boa, mura, dir, off) {
  if (!barca || !boa || !mura || !Number.isFinite(dir) || !off) return null;
  const c = rotteDiBolina(dir, off), altra = mura === "dritta" ? "sinistra" : "dritta";
  const m = xy(boa, barca), u = versore(c[mura]), v = versore(c[altra]);
  const den = vettoriale(u, v);
  if (Math.abs(den) < 0.1) return null;
  return vettoriale(m, v) / den;
}

// Linea di partenza: estremo più sopravvento e vantaggio (in metri sopravvento).
export function latoFavorito(cdr, pin, dir) {
  if (!cdr || !pin || !Number.isFinite(dir)) return null;
  const p = xy(pin, cdr), su = versore(dir), lunghezza = Math.hypot(p.x, p.y);
  if (lunghezza < 5) return null;
  const vantaggio = p.x * su.x + p.y * su.y; // > 0: la boa P è più sopravvento
  const sbilanciamento = Math.asin(Math.max(-1, Math.min(1, vantaggio / lunghezza))) * 180 / Math.PI;
  return {favorito: Math.abs(sbilanciamento) < 2 ? "neutra" : vantaggio > 0 ? "P" : "CdR", vantaggio: Math.abs(vantaggio), sbilanciamento: Math.abs(sbilanciamento), lunghezza};
}

// ---------------- Andatura ----------------
// Dall'angolo tra la rotta sul fondo e il vento. Limiti indicativi: la bolina stretta reale dipende dalla barca.
export function andatura(cog, dirVento) {
  if (!Number.isFinite(cog) || !Number.isFinite(dirVento)) return null;
  const a = Math.abs(delta(cog, dirVento));
  const nome = a < 30 ? "Prua al vento" : a < 50 ? "Bolina stretta" : a < 75 ? "Bolina larga" : a < 105 ? "Traverso" : a < 135 ? "Lasco" : a < 165 ? "Gran lasco" : "Poppa";
  return {nome, angolo: a, mura: muraDa(cog, dirVento)};
}

// ---------------- Andatura dichiarata dall'equipaggio ----------------
// Angolo dal vento di ogni andatura (centro dei limiti usati per mostrarla). La bolina stretta usa l'angolo
// della barca (metà dell'angolo di virata tarato o tipico).
export const ANDATURE = ["Bolina stretta", "Bolina larga", "Traverso", "Lasco", "Gran lasco", "Poppa"];
export const ANGOLO_ANDATURA = {"Bolina larga": 62, "Traverso": 90, "Lasco": 120, "Gran lasco": 150, "Poppa": 172};
// Mure a sinistra: il vento arriva da sinistra, quindi sta «a sinistra» della rotta (rotta − angolo).
export function ventoDaAndatura(cog, nome, mura, angoloBolina = 45) {
  const a = nome === "Bolina stretta" ? angoloBolina : ANGOLO_ANDATURA[nome];
  if (!Number.isFinite(cog) || !Number.isFinite(a) || (mura !== "sinistra" && mura !== "dritta")) return null;
  return norm(mura === "sinistra" ? cog - a : cog + a);
}
