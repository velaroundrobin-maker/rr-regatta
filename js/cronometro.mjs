// Timer di partenza, cronometro e distanza-tempo dalla linea (v0.6).
// Timer: «zero» è l'istante della partenza; prima si conta alla rovescia, dopo si conta il tempo di regata.
import {rad, norm} from "./engine.mjs?v=0.9.2";

const MINUTO = 60000;
export const MINUTI_SEGNALE = [5, 4, 3, 2, 1];
export const RITARDO_MAX_MS = 3000; // un segnale perso da più di 3 s (telefono addormentato) non suona più

export const avviaTimer = (adesso, minuti = 5) => adesso + minuti * MINUTO;
// Al segnale della giuria: il tempo che manca si porta al minuto intero più vicino.
export function sincronizza(zero, adesso) {
  if (zero === null || zero === undefined) return avviaTimer(adesso);
  const minuti = Math.round((zero - adesso) / MINUTO);
  return adesso + minuti * MINUTO;
}
export const spostaMinuto = (zero, d) => zero + d * MINUTO;

// Segnali scattati nell'intervallo (prima, ora]: un beep lungo a ogni minuto da −5 a −1, la raffica allo zero,
// e se richiesto un beep breve a ogni secondo degli ultimi 10.
export function segnali(zero, prima, ora, {ultimi10 = false} = {}) {
  if (!Number.isFinite(zero) || !(ora > prima)) return [];
  const fuori = [];
  const scatta = (t, segnale) => { if (t > prima && t <= ora && ora - t <= RITARDO_MAX_MS) fuori.push({t, ...segnale}); };
  for (const m of MINUTI_SEGNALE) scatta(zero - m * MINUTO, {tipo: "lungo", minuto: m});
  if (ultimi10) for (let s = 10; s >= 1; s--) scatta(zero - s * 1000, {tipo: "breve", secondo: s});
  scatta(zero, {tipo: "partenza"});
  return fuori.sort((a, b) => a.t - b.t);
}

// «−4:59» prima della partenza (secondi arrotondati per eccesso: allo scoccare del minuto si legge −4:00), «+1:05» dopo.
export function testoTimer(zero, adesso) {
  const ms = zero - adesso;
  if (ms > 0) { const s = Math.ceil(ms / 1000); return "−" + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  const s = Math.floor(-ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return "+" + (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s % 60).padStart(2, "0");
}
export function testoCronometro(ms) {
  const d = Math.floor(ms / 100) % 10, s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0") + "," + d;
}

// ---------------- Cronometro ----------------
// cr = {inizio: istante dell'ultimo avvio o null se fermo, accumulato: ms già contati, parziali: [{t, totale, pos}]}
export const nuovoCronometro = () => ({inizio: null, accumulato: 0, parziali: []});
export const tempoCronometro = (cr, adesso) => cr.accumulato + (cr.inizio !== null ? adesso - cr.inizio : 0);
export function avviaFerma(cr, adesso) {
  return cr.inizio === null ? {...cr, inizio: adesso} : {...cr, inizio: null, accumulato: tempoCronometro(cr, adesso)};
}

// ---------------- Distanza-tempo dalla linea ----------------
const xy = (p, o) => ({x: rad(p.lon - o.lon) * 6371008.8 * Math.cos(rad(o.lat)), y: rad(p.lat - o.lat) * 6371008.8});
// Lato del percorso (oltre la linea) = lato verso il vento; senza vento, il lato della prima boa.
// Restituisce la distanza (positiva prima della linea), la velocità verso la linea, il tempo per arrivarci
// e lo scarto rispetto allo zero (negativo = in anticipo).
export function distanzaTempo({barca, cog, sog, linea, dirVento = null, boa = null, mancanoMs = null}) {
  if (!barca || !linea) return null;
  const [a, b] = linea, A = {x: 0, y: 0}, B = xy(b, a), P = xy(barca, a);
  const L = Math.hypot(B.x, B.y);
  if (L < 5) return null;
  const u = {x: B.x / L, y: B.y / L};
  let n = {x: -u.y, y: u.x};
  let orientata = false;
  if (Number.isFinite(dirVento)) {
    const w = {x: Math.sin(rad(dirVento)), y: Math.cos(rad(dirVento))};
    if (n.x * w.x + n.y * w.y < 0) n = {x: -n.x, y: -n.y};
    orientata = Math.abs(n.x * w.x + n.y * w.y) > 0.3;
  } else if (boa) {
    const M = xy(boa, a);
    if (n.x * M.x + n.y * M.y < 0) n = {x: -n.x, y: -n.y};
    orientata = true;
  }
  const lungo = (P.x - A.x) * u.x + (P.y - A.y) * u.y;          // posizione lungo la linea, da CdR verso P
  const oltre = P.x * n.x + P.y * n.y;                          // > 0 = oltre la linea (lato del percorso)
  const fuori = lungo < -10 ? "fuori dalla linea, lato comitato" : lungo > L + 10 ? "fuori dalla linea, lato pin" : null;
  const res = {lunghezza: L, fuori, orientata, oltreLinea: orientata && oltre > 0, distanza: orientata ? -oltre : Math.abs(oltre),
    verso: null, secondi: null, scarto: null};
  if (Number.isFinite(cog) && Number.isFinite(sog)) {
    const ms = sog / 1.943844, v = {x: ms * Math.sin(rad(norm(cog))), y: ms * Math.cos(rad(norm(cog)))};
    const vn = v.x * n.x + v.y * n.y;                           // velocità verso il lato del percorso
    res.verso = orientata ? vn * 1.943844 : Math.abs(vn) * 1.943844 * (Math.sign(vn) === Math.sign(-oltre) ? 1 : -1);
    const vVerso = orientata ? vn : Math.abs(vn) * (Math.sign(vn) === Math.sign(-oltre) ? 1 : -1);
    if (res.distanza > 0 && vVerso > 0.15) {
      res.secondi = res.distanza / vVerso;
      if (Number.isFinite(mancanoMs)) res.scarto = res.secondi - mancanoMs / 1000;
    }
  }
  return res;
}
