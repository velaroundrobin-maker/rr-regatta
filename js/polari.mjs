// Polari apprese in allenamento (Fase 4b, prima parte).
// Vento: direzione dalla taratura più recente (motore prua al vento o coppia di boline), intensità inserita
// dall'equipaggio con l'anemometro. Barca: rotta e velocità sul fondo dal GPS.
// Ogni punto registrato è [t, angolo dal vento con segno (+ mure a sinistra), velocità kn, vento vero kn, configurazione].
import {delta, circularMean} from "./engine.mjs?v=0.5";

export const CHIAVE_POLARI = "rr-regatta-polari-v1";
export const PRUA = ["J1", "J2", "J3", "Genoa 1", "Genoa 2", "Genoa 3", "Nessuna"];
export const RANDA = ["Piena", "1 mano", "2 mani"];
export const PORTANTI = ["Nessuna", "Spinnaker", "Gennaker", "Code 0"];
export const CLASSI_VENTO = [4, 6, 8, 10, 12, 14, 16, 20, 25];
export const CLASSI_ANGOLO = [30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120, 135, 150, 165, 180];
export const MIN_PUNTI = 15;          // 30 secondi di navigazione stabile per casella
export const MAX_CAMPIONI = 30000;    // circa 16 ore a un punto ogni 2 secondi

export function nuovePolari() {
  return {formato: "rr-regatta-polari", versione: 1, barca: "", configurazioni: [], campioni: [], letture: [],
    vele: {prua: "J1", randa: "Piena", portante: "Nessuna"}, vento: null,
    imp: {validitaMin: 20, percentile: 80}};
}
export function verificaPolari(obj) {
  if (!obj || obj.formato !== "rr-regatta-polari" || obj.versione !== 1) throw new Error("non è un file di polari di RR Regatta");
  if (!Array.isArray(obj.campioni) || !Array.isArray(obj.configurazioni)) throw new Error("file di polari incompleto");
  const n = nuovePolari();
  obj.letture ??= []; obj.barca ??= "";
  obj.vele = {...n.vele, ...(obj.vele || {})};
  obj.imp = {...n.imp, ...(obj.imp || {})};
  obj.vento ??= null;
  obj.campioni = obj.campioni.filter(c => Array.isArray(c) && c.length >= 5 && c.every(Number.isFinite) && c[4] >= 0 && c[4] < obj.configurazioni.length);
  return obj;
}

// ---------------- Vele ----------------
export const chiaveVele = v => v.prua + "|" + v.randa + "|" + v.portante;
export function nomeVele(chiave) {
  const [prua, randa, portante] = String(chiave).split("|");
  const parti = [];
  if (prua && prua !== "Nessuna") parti.push(prua);
  parti.push(randa === "Piena" ? "randa piena" : "randa " + randa);
  if (portante && portante !== "Nessuna") parti.push(portante);
  if (prua === "Nessuna" && (!portante || portante === "Nessuna")) parti.unshift("senza vela di prua");
  return parti.join(" · ");
}
export function indiceVele(pol, vele) {
  const k = chiaveVele(vele);
  let i = pol.configurazioni.indexOf(k);
  if (i < 0) { pol.configurazioni.push(k); i = pol.configurazioni.length - 1; }
  return i;
}

// ---------------- Vento ----------------
// L'anemometro a mano misura il vento apparente: è vento vero solo a barca ferma.
// A motore con la prua al vento, il vento vero è la lettura meno la velocità della barca.
export function ventoVero(letto, metodo, sog) {
  if (!Number.isFinite(letto) || letto < 0) return null;
  if (metodo === "motore") return Number.isFinite(sog) ? Math.max(0, letto - sog) : null;
  return letto;
}
export function classeVicina(valore, classi) {
  if (!Number.isFinite(valore)) return null;
  let migliore = classi[0];
  for (const c of classi) if (Math.abs(c - valore) < Math.abs(migliore - valore)) migliore = c;
  return migliore;
}
// Limiti delle classi di vento: a metà fra una classe e la successiva.
export function classeVento(tws) {
  if (!Number.isFinite(tws) || tws < 3) return null;
  return classeVicina(tws, CLASSI_VENTO);
}

// ---------------- Raccolta dei punti ----------------
// fixes: punti GPS recenti {received, cog, sog, accuracy}. Il punto vale solo se rotta e velocità sono stabili da 20 s.
export function valutaPunto({fixes, adesso, rif, vento, validitaMs, ultimoCambioVele, minSog = 1}) {
  if (!rif || !Number.isFinite(rif.dir)) return {ok: false, motivo: "direzione del vento non tarata"};
  if (Number.isFinite(rif.t) && adesso - rif.t > validitaMs) return {ok: false, motivo: "taratura del vento vecchia di " + Math.round((adesso - rif.t) / 60000) + " min: ritara"};
  if (!vento || !Number.isFinite(vento.tws)) return {ok: false, motivo: "manca l'intensità del vento"};
  if (adesso - vento.t > validitaMs) return {ok: false, motivo: "intensità del vento vecchia di " + Math.round((adesso - vento.t) / 60000) + " min: aggiornala"};
  if (classeVento(vento.tws) === null) return {ok: false, motivo: "vento sotto i 3 nodi"};
  if (ultimoCambioVele && adesso - ultimoCambioVele < 60000) return {ok: false, motivo: "vele appena cambiate: attendo un minuto"};
  const v = fixes.filter(f => adesso - f.received <= 20000 && Number.isFinite(f.cog) && Number.isFinite(f.sog));
  if (v.length < 14) return {ok: false, motivo: "pochi dati GPS"};
  const ultimo = v[v.length - 1];
  if (Number.isFinite(ultimo.accuracy) && ultimo.accuracy > 15) return {ok: false, motivo: "precisione GPS scarsa"};
  if (v.some(f => f.sog < minSog)) return {ok: false, motivo: "velocità bassa"};
  const m = circularMean(v.map(f => f.cog));
  if (m === null || Math.max(...v.map(f => Math.abs(delta(f.cog, m)))) > 10) return {ok: false, motivo: "rotta non stabile da 20 secondi"};
  const recenti = v.filter(f => adesso - f.received <= 10000).map(f => f.sog);
  const media = recenti.reduce((a, b) => a + b, 0) / recenti.length;
  if (Math.max(...recenti) - Math.min(...recenti) > Math.max(0.6, 0.2 * media)) return {ok: false, motivo: "velocità in cambiamento"};
  const cogMedia = circularMean(v.filter(f => adesso - f.received <= 10000).map(f => f.cog));
  const twa = delta(cogMedia, rif.dir);
  if (Math.abs(twa) < 25) return {ok: false, motivo: "prua quasi al vento"};
  return {ok: true, twa, sog: media, motivo: null};
}

// ---------------- Calcolo della polare ----------------
const percentile = (valori, p) => {
  const o = [...valori].sort((a, b) => a - b);
  return o[Math.max(0, Math.ceil(p / 100 * o.length) - 1)];
};
// Polare di una classe di vento: per ogni classe d'angolo, il percentile scelto delle velocità (80° = la velocità
// che la barca raggiunge quando è ben condotta, senza dare peso alle punte dovute alle onde o al GPS).
// config: indice di una configurazione, oppure "tutte" per la migliore configurazione in ciascun angolo.
export function polare(pol, classe, config = "tutte", p = pol.imp?.percentile ?? 80) {
  const gruppi = new Map();
  for (const c of pol.campioni) {
    if (classeVento(c[3]) !== classe) continue;
    if (config !== "tutte" && c[4] !== config) continue;
    const a = classeVicina(Math.abs(c[1]), CLASSI_ANGOLO);
    const g = gruppi.get(a) || new Map();
    const lista = g.get(c[4]) || [];
    lista.push(c);
    g.set(c[4], lista); gruppi.set(a, g);
  }
  const punti = [];
  for (const a of CLASSI_ANGOLO) {
    const g = gruppi.get(a); if (!g) continue;
    let migliore = null, totale = 0;
    for (const [k, lista] of g) {
      totale += lista.length;
      const valido = lista.length >= MIN_PUNTI;
      const cand = {twa: a, v: percentile(lista.map(c => c[2]), p), n: lista.length, nS: lista.filter(c => c[1] > 0).length,
        nD: lista.filter(c => c[1] <= 0).length, config: k, valido,
        angoloMedio: lista.reduce((s, c) => s + Math.abs(c[1]), 0) / lista.length};
      if (!migliore || (valido && !migliore.valido) || (valido === migliore.valido && cand.v > migliore.v)) migliore = cand;
    }
    punti.push({...migliore, totale});
  }
  return punti;
}
// Angoli migliori per la VMC al vento e in poppa, dai soli punti validi.
export function ottimi(punti) {
  let bolina = null, poppa = null;
  for (const q of punti) {
    if (!q.valido) continue;
    const vmg = q.v * Math.cos(q.twa * Math.PI / 180);
    if (q.twa < 90 && (!bolina || vmg > bolina.vmg)) bolina = {twa: q.twa, v: q.v, vmg};
    if (q.twa > 90 && (!poppa || -vmg > poppa.vmg)) poppa = {twa: q.twa, v: q.v, vmg: -vmg};
  }
  return {bolina, poppa};
}
// Velocità della polare a un certo angolo (interpolata fra le caselle valide vicine).
export function velocitaPolare(punti, twa) {
  const a = Math.abs(twa), v = punti.filter(q => q.valido);
  if (!v.length) return null;
  const sotto = v.filter(q => q.twa <= a).pop(), sopra = v.find(q => q.twa >= a);
  if (sotto && sopra) return sotto.twa === sopra.twa ? sotto.v : sotto.v + (sopra.v - sotto.v) * (a - sotto.twa) / (sopra.twa - sotto.twa);
  const vicino = sotto || sopra;
  return Math.abs(vicino.twa - a) <= 5 ? vicino.v : null;
}
export const classiConDati = pol => CLASSI_VENTO.filter(k => pol.campioni.some(c => classeVento(c[3]) === k));
export const configurazioniConDati = (pol, classe) => [...new Set(pol.campioni.filter(c => classe == null || classeVento(c[3]) === classe).map(c => c[4]))].sort((a, b) => a - b);

// Tabella da aprire con un foglio di calcolo: angoli in riga, classi di vento in colonna, separatore «;» e virgola decimale.
export function tabellaCsv(pol, config = "tutte") {
  const classi = classiConDati(pol);
  const polari = new Map(classi.map(k => [k, polare(pol, k, config)]));
  const righe = ["Angolo dal vento \\ vento vero (kn);" + classi.join(";")];
  for (const a of CLASSI_ANGOLO) {
    const celle = classi.map(k => { const q = polari.get(k).find(x => x.twa === a && x.valido); return q ? q.v.toFixed(2).replace(".", ",") : ""; });
    if (celle.some(Boolean)) righe.push(a + ";" + celle.join(";"));
  }
  for (const [nome, chiave] of [["Bolina migliore: angolo", "bolina"], ["Poppa migliore: angolo", "poppa"]]) {
    righe.push(nome + ";" + classi.map(k => ottimi(polari.get(k))[chiave]?.twa ?? "").join(";"));
  }
  return righe.join("\r\n") + "\r\n";
}

// Unisce i punti di un altro file (stesse configurazioni riconosciute dal nome; doppioni scartati).
export function unisciPolari(pol, altro) {
  const mappa = altro.configurazioni.map(k => { let i = pol.configurazioni.indexOf(k); if (i < 0) { pol.configurazioni.push(k); i = pol.configurazioni.length - 1; } return i; });
  const visti = new Set(pol.campioni.map(c => c[0] + "|" + c[4]));
  let aggiunti = 0;
  for (const c of altro.campioni) {
    const n = [c[0], c[1], c[2], c[3], mappa[c[4]]];
    const k = n[0] + "|" + n[4];
    if (visti.has(k)) continue;
    visti.add(k); pol.campioni.push(n); aggiunti++;
  }
  pol.campioni.sort((a, b) => a[0] - b[0]);
  if (pol.campioni.length > MAX_CAMPIONI) pol.campioni.splice(0, pol.campioni.length - MAX_CAMPIONI);
  pol.letture = [...(pol.letture || []), ...(altro.letture || [])].sort((a, b) => a.t - b.t);
  return aggiunti;
}
