// Funzioni pure per la schermata di navigazione: smorzamento, stato del dato, formati.
import {norm,circularMean,distanceMeters,bearing} from "./engine.mjs?v=0.5";

const KN = 1.9438444924406;

// Sotto questa velocità la rotta sul fondo è dominata dal rumore GPS e non va mostrata.
export const MIN_SOG_PER_COG = 0.5; // nodi
export const ETA_VIVO_MS = 5000;     // dato aggiornato
export const ETA_VECCHIO_MS = 15000; // oltre: dato perso

// Media degli ultimi secondi: numeri più leggibili in barca, senza nascondere le variazioni reali.
export function smoothNav(fixes, finestraMs = 3000) {
  if (!fixes || !fixes.length) return {sog: null, cog: null, n: 0};
  const ultimo = fixes[fixes.length - 1].received;
  const recenti = fixes.filter(f => ultimo - f.received <= finestraMs);
  const sogs = recenti.map(f => f.sog).filter(Number.isFinite);
  const sog = sogs.length ? sogs.reduce((a, b) => a + b, 0) / sogs.length : null;
  const cogs = recenti.filter(f => Number.isFinite(f.cog) && Number.isFinite(f.sog) && f.sog >= MIN_SOG_PER_COG).map(f => f.cog);
  const cog = sog !== null && sog >= MIN_SOG_PER_COG && cogs.length ? circularMean(cogs) : null;
  return {sog, cog, n: recenti.length};
}

// Velocità e rotta dagli spostamenti, quando il telefono non le fornisce.
// Due punti consecutivi (1 s) sono troppo vicini rispetto al rumore GPS: si cerca all'indietro
// il punto più recente, ad almeno 3 s di distanza, da cui la barca si è spostata più del rumore.
export function derivaMoto(storico, fix, {minMs = 3000, maxMs = 15000} = {}) {
  let baseFerma = null;
  for (let i = storico.length - 1; i >= 0; i--) {
    const f = storico[i], dt = fix.time - f.time;
    if (dt < minMs) continue;
    if (dt > maxMs) break;
    const soglia = Math.max(4, 1.5 * Math.max(f.accuracy ?? 5, fix.accuracy ?? 5));
    const d = distanceMeters(f, fix);
    if (d > soglia) return {sog: d / (dt / 1000) * KN, cog: bearing(f, fix)};
    baseFerma = f;
  }
  return baseFerma ? {sog: 0, cog: null} : {sog: null, cog: null};
}

export function statoDato(etaMs) {
  if (!Number.isFinite(etaMs)) return "assente";
  return etaMs <= ETA_VIVO_MS ? "vivo" : etaMs <= ETA_VECCHIO_MS ? "vecchio" : "perso";
}

export const numero = (v, decimali) => v.toFixed(decimali).replace(".", ",");
export const angolo = a => String(Math.round(norm(a)) % 360).padStart(3, "0") + "°";

// Gradi e primi decimali, come sulle carte nautiche: 44° 46,200′ N
export function coordinata(v, latitudine) {
  const ass = Math.abs(v);
  let gradi = Math.floor(ass);
  let primi = Math.round((ass - gradi) * 60 * 1000) / 1000;
  if (primi >= 60) { gradi += 1; primi = 0; }
  const g = String(gradi).padStart(latitudine ? 2 : 3, "0");
  const lettera = latitudine ? (v >= 0 ? "N" : "S") : (v >= 0 ? "E" : "W");
  return g + "° " + numero(primi, 3).padStart(6, "0") + "′ " + lettera;
}

// Scala grafica: la distanza «tonda» che occupa circa obiettivoPx pixel.
const SCALE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
export function scalaGrafica(metriPerPixel, obiettivoPx = 90) {
  let migliore = SCALE[0];
  for (const m of SCALE) if (Math.abs(Math.log(m / metriPerPixel / obiettivoPx)) < Math.abs(Math.log(migliore / metriPerPixel / obiettivoPx))) migliore = m;
  const etichetta = migliore >= 1000 ? numero(migliore / 1000, 0) + " km" : migliore + " m";
  return {metri: migliore, pixel: migliore / metriPerPixel, etichetta};
}
