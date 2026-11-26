// Campo di regata: modelli dalle istruzioni, sequenza del percorso, obiettivo della tappa.
import {distanceMeters, bearing, estimateMarkFromBearings, rad, move, norm} from "./engine.mjs?v=0.10";

const boa = (codice, nome, tipo, pos = null) => ({codice, nome, tipo, pos});
const daIstruzioni = (gLat, mLat, gLon, mLon) => ({lat: gLat + mLat / 60, lon: gLon + mLon / 60, acc: null, t: null, fonte: "istruzioni"});

const PARTENZA = [boa("CdR", "Battello comitato", "partenza"), boa("P", "Boa di partenza", "partenza")];
const LOANO_BASTONE = [...PARTENZA, boa("1", "Boa di bolina", "bolina"), boa("1d", "Boa di disimpegno", "disimpegno"), boa("2", "Boa di poppa", "poppa")];
const LOANO_COSTIERE = [...PARTENZA, boa("D", "Disimpegno eventuale", "disimpegno"),
  boa("4", "Boa 4 · Borgio", "percorso", daIstruzioni(44, 9.023, 8, 18.942)),
  boa("5", "Boa 5 · Castello Borghetto", "percorso", daIstruzioni(44, 5.919, 8, 15.259))];
const ALASSIO_COSTIERI = [...PARTENZA, boa("D", "Disimpegno eventuale · arancione", "disimpegno"),
  boa("1A", "Boa 1A · gialla", "bolina"), boa("1B", "Boa 1B · arancione", "bolina"), boa("2", "Boa 2 · gialla", "percorso")];
const ALASSIO_BASTONE = [...PARTENZA, boa("A", "Boa A · gialla", "bolina"), boa("A1", "Boa A1 · gialla", "disimpegno"), boa("B", "Boa B · arancione", "poppa")];

const ARRIVO_LOANO = {ugualePartenza: false, etichette: ["Battello CdR · bandiera blu", "Boa d'arrivo A · arancione"]};
const ARRIVO_CANCELLO = {ugualePartenza: true, etichette: ["Battello CdR", "Boa di partenza"]};

export const MODELLI = {
  "loano-1": {nome: "Loano · Bastone 1 giro (pennello 1)", boe: LOANO_BASTONE, sequenza: "S - 1 - 1d - 2 - F", arrivo: ARRIVO_LOANO,
    note: "Arrivo: linea tra il battello CdR (bandiera blu, a dritta) e la boa A arancione (a sinistra)."},
  "loano-2": {nome: "Loano · Bastone 2 giri (pennello 2)", boe: LOANO_BASTONE, sequenza: "S - 1 - 1d - 2 - 1 - 1d - 2 - F", arrivo: ARRIVO_LOANO,
    note: "Arrivo: linea tra il battello CdR (bandiera blu, a dritta) e la boa A arancione (a sinistra). Con riduzione alla boa 2 si va direttamente all'arrivo."},
  "loano-3": {nome: "Loano · Costiera lunga (pennello 3)", boe: [...PARTENZA, boa("D", "Disimpegno eventuale", "disimpegno"), boa("GAL", "Isola Gallinara (a sinistra)", "percorso")],
    sequenza: "S - (D) - GAL - F", arrivo: ARRIVO_LOANO, note: "Disimpegno solo se esposta la Delta. L'isola Gallinara si lascia a sinistra."},
  "loano-4": {nome: "Loano · Costiera corta (pennello 4)", boe: LOANO_COSTIERE, sequenza: "S - (D) - 4 - 5 - F", arrivo: ARRIVO_LOANO,
    note: "Boe 4 e 5 a sinistra. Le loro coordinate vengono dalle istruzioni e sono indicative: confermale con «Segna GPS»."},
  "loano-5": {nome: "Loano · Costiera corta (pennello 5)", boe: LOANO_COSTIERE, sequenza: "S - (D) - 5 - 4 - F", arrivo: ARRIVO_LOANO,
    note: "Boe 4 e 5 a sinistra. Le loro coordinate vengono dalle istruzioni e sono indicative: confermale con «Segna GPS»."}
};
for (const percorso of [1, 2, 3]) for (const gruppo of [1, 2]) {
  const b = gruppo === 1 ? "1A" : "1B";
  const sequenza = percorso === 1 ? `S - (D) - ${b} - 2 - G - ${b} - 2 - F` : percorso === 2 ? `S - (D) - 2 - ${b} - G - 2 - ${b} - F`
    : "S - " + Array.from({length: gruppo === 1 ? 3 : 2}, () => "A - A1 - B").join(" - ") + " - F";
  MODELLI[`alassio-${percorso}-${gruppo}`] = {
    nome: `Alassio 2026 · Percorso ${percorso} · ${gruppo}° raggruppamento`, sequenza,
    boe: percorso === 3 ? ALASSIO_BASTONE : ALASSIO_COSTIERI,
    arrivo: percorso === 3 ? {ugualePartenza: false, etichette: ["Battello CdR", "Boa d'arrivo · arancione"]} : ARRIVO_CANCELLO,
    note: percorso === 3 ? "Bastone. Tutte le boe a sinistra. La linea di partenza è ostacolo continuo: non attraversare la linea d'arrivo se non all'arrivo."
      : "Costiero. Tutte le boe a sinistra; D solo se posata. G è il passaggio al cancello (linea di partenza/arrivo): tempo valido come prima prova."
  };
}
MODELLI["allenamento"] = {nome: "Campo disegnato o d'allenamento", boe: [], sequenza: "S", arrivo: {ugualePartenza: true, etichette: ["Battello CdR", "Boa di partenza"]},
  note: "Boe virtuali per gli esercizi: usa i campi pronti qui sotto oppure «Disegna sulla mappa». La sequenza si aggiorna da sola; l'arrivo è sulla linea di partenza."};
MODELLI["personalizzato"] = {nome: "Personalizzato", boe: PARTENZA, sequenza: "S - F", arrivo: {ugualePartenza: false, etichette: ["Estremo 1", "Estremo 2"]},
  note: "Aggiungi le boe e scrivi la sequenza: S partenza, F arrivo, G cancello, boa eventuale tra parentesi, ad esempio S - (D) - 1 - 2 - F."};

// ---------------- Campi d'allenamento ----------------
// Boe virtuali costruite intorno alla barca, orientate sul vento (da dove viene).
// La barca CdR sta all'estremo destro della linea guardando il vento, la boa P a sinistra.
export const TIPI_ALLENAMENTO = {
  partenza: "Solo linea di partenza", bolina: "Partenza e boa di bolina", bastone: "Bastone (bolina e poppa)", dueboe: "Due boe, senza partenza"
};
export function campoAllenamento(tipo, {centro, vento, lunghezza = 100, distanza = 400, giri = 1, adesso = Date.now()}) {
  if (!TIPI_ALLENAMENTO[tipo]) throw new Error("Campo d'allenamento sconosciuto");
  const pos = p => ({lat: p.lat, lon: p.lon, acc: null, t: adesso, fonte: "disegnata"});
  const b = (codice, nome, tipoBoa, p) => ({codice, nome, tipo: tipoBoa, pos: pos(p), storico: [], osservazioni: []});
  const linea = [b("CdR", "Battello comitato (virtuale)", "partenza", move(centro, norm(vento + 90), lunghezza / 2)),
                 b("P", "Boa di partenza (virtuale)", "partenza", move(centro, norm(vento - 90), lunghezza / 2))];
  const bolina = b("1", "Boa di bolina (virtuale)", "bolina", move(centro, vento, distanza));
  const giro = (pezzo) => Array.from({length: Math.max(1, giri)}, () => pezzo).join(" - ");
  const descr = " · linea " + Math.round(lunghezza) + " m, bolina " + Math.round(distanza) + " m";
  switch (tipo) {
    case "partenza": return {nome: "Allenamento · solo partenza · linea " + Math.round(lunghezza) + " m", boe: linea, sequenza: "S"};
    case "bolina": return {nome: "Allenamento · partenza e bolina" + descr, boe: [...linea, bolina], sequenza: "S - 1 - F"};
    case "bastone": return {nome: "Allenamento · bastone " + giri + (giri > 1 ? " giri" : " giro") + descr,
      boe: [...linea, bolina, b("2", "Boa di poppa (virtuale)", "poppa", move(centro, norm(vento + 180), 50))], sequenza: "S - " + giro("1 - 2") + " - F"};
    case "dueboe": return {nome: "Allenamento · due boe a " + Math.round(distanza) + " m", sequenza: giro("1 - 2"),
      boe: [bolina, b("2", "Boa 2 (virtuale)", "poppa", centro)]};
  }
}
// Sequenza automatica del campo disegnato: partenza se c'è la linea, le boe nell'ordine in cui sono state messe, arrivo sulla linea.
export function sequenzaDisegnata(boe) {
  const linea = trovaBoa(boe, "CdR")?.pos && trovaBoa(boe, "P")?.pos;
  const percorso = boe.filter(x => x.tipo !== "partenza" && x.pos).map(x => x.codice);
  return [...(linea ? ["S"] : []), ...percorso, ...(linea && percorso.length ? ["F"] : [])].join(" - ");
}
// Ritocchi della sequenza mentre si disegna: la boa nuova va prima dell'arrivo, quella tolta sparisce,
// e quando la linea di partenza è completa si aggiungono partenza e arrivo.
export function aggiornaSequenza(sequenza, boe, {aggiunta = null, tolta = null} = {}) {
  let t = leggiSequenza(sequenza).map(x => ({...x}));
  if (tolta) t = t.filter(x => x.codice.toUpperCase() !== tolta.toUpperCase());
  if (aggiunta) {
    const n = {codice: aggiunta, tipo: "boa", opzionale: false};
    if (t.length && t[t.length - 1].tipo === "arrivo") t.splice(t.length - 1, 0, n); else t.push(n);
  }
  const linea = trovaBoa(boe, "CdR")?.pos && trovaBoa(boe, "P")?.pos;
  if (linea && !t.some(x => x.tipo === "partenza")) t.unshift({codice: "S", tipo: "partenza"});
  if (!linea) t = t.filter(x => x.tipo !== "partenza" && x.tipo !== "arrivo" && x.tipo !== "cancello");
  if (linea && t.some(x => x.tipo === "boa") && t[t.length - 1].tipo !== "arrivo") t.push({codice: "F", tipo: "arrivo"});
  if (linea && !t.some(x => x.tipo === "boa")) t = t.filter(x => x.tipo !== "arrivo");
  return t.map(x => x.opzionale ? "(" + x.codice + ")" : x.codice).join(" - ");
}
export function prossimoCodice(boe) {
  for (let i = 1; ; i++) if (!trovaBoa(boe, String(i))) return String(i);
}

// ---------------- Sequenza ----------------
export function leggiSequenza(testo) {
  return String(testo || "").split(/\s*[-–→,]\s*/).map(s => s.trim()).filter(Boolean).map(t => {
    const opzionale = /^\(.*\)$/.test(t), codice = t.replace(/^\(|\)$/g, "").trim();
    const up = codice.toUpperCase();
    const tipo = up === "S" ? "partenza" : up === "F" ? "arrivo" : up === "G" ? "cancello" : "boa";
    return {codice, tipo, opzionale};
  });
}
// Le tappe sono gli obiettivi da raggiungere dopo la partenza.
export const tappe = testo => leggiSequenza(testo).filter(t => t.tipo !== "partenza");

export const trovaBoa = (boe, codice) => boe.find(b => b.codice.toUpperCase() === String(codice).toUpperCase());
const medio = (a, b) => ({lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2});

export function lineaPartenza(boe) {
  const c = trovaBoa(boe, "CdR")?.pos, p = trovaBoa(boe, "P")?.pos;
  return c && p ? [c, p] : null;
}
export function lineaArrivo(s) {
  if (s.arrivo.ugualePartenza) return lineaPartenza(s.boe);
  const {a, b} = s.arrivo.estremi;
  return a && b ? [a, b] : null;
}

// Dove si trova l'obiettivo della tappa: posizione nota, solo direzione, oppure ignoto (con il motivo).
export function obiettivo(s, indice, barca, adesso = Date.now()) {
  const tappa = tappe(s.campo.sequenza)[indice];
  if (!tappa) return {tappa: null, nome: "Percorso completato", pos: null, rilevamento: null, motivo: "nessuna tappa"};
  if (tappa.tipo === "cancello" || tappa.tipo === "arrivo") {
    const linea = tappa.tipo === "cancello" ? lineaPartenza(s.boe) : lineaArrivo(s);
    const nome = tappa.tipo === "cancello" ? "Cancello (linea di partenza)" : "Arrivo";
    if (linea) return {tappa, nome, pos: medio(linea[0], linea[1]), fonte: "linea", motivo: "centro della linea"};
    const uno = tappa.tipo === "arrivo" && !s.arrivo.ugualePartenza ? (s.arrivo.estremi.a || s.arrivo.estremi.b) : null;
    if (uno) return {tappa, nome, pos: uno, fonte: "estremo", motivo: "un solo estremo noto"};
    return {tappa, nome, pos: null, rilevamento: null, motivo: tappa.tipo === "cancello" ? "segna CdR e P" : "segna gli estremi della linea"};
  }
  const b = trovaBoa(s.boe, tappa.codice);
  if (!b) return {tappa, nome: "Boa " + tappa.codice, pos: null, rilevamento: null, motivo: "boa non presente nel campo"};
  if (b.pos) return {tappa, boa: b, nome: b.nome, pos: b.pos, fonte: b.pos.fonte, motivo: b.pos.fonte};
  const oss = b.osservazioni?.at(-1);
  if (oss && barca) {
    const spostamento = distanceMeters(oss, barca);
    if (spostamento <= 200) return {tappa, boa: b, nome: b.nome, pos: null, rilevamento: oss.rilevamento, fonte: "rilevamento", spostamento, motivo: "rilevamento provvisorio"};
    return {tappa, boa: b, nome: b.nome, pos: null, rilevamento: null, motivo: "rilevamento da ripetere (spostamento " + Math.round(spostamento) + " m)"};
  }
  return {tappa, boa: b, nome: b.nome, pos: null, rilevamento: null, motivo: "posizione ignota"};
}

// Con più rilevamenti da punti diversi, la migliore intersezione (rette ben incrociate e base lunga).
export function triangola(osservazioni) {
  let migliore = null, punteggio = -Infinity;
  for (let i = 0; i < osservazioni.length; i++) for (let j = i + 1; j < osservazioni.length; j++) {
    const a = osservazioni[i], b = osservazioni[j];
    const p = estimateMarkFromBearings({...a, bearing: a.rilevamento}, {...b, bearing: b.rilevamento});
    if (!p) continue;
    const v = Math.min(distanceMeters(a, b), 2000) * Math.abs(Math.sin(rad(p.crossAngle)));
    if (v > punteggio) { punteggio = v; migliore = {lat: p.lat, lon: p.lon, acc: null, t: Math.max(a.t, b.t), fonte: "triangolazione", angolo: p.crossAngle}; }
  }
  return migliore;
}

export function distanzaTesto(m) {
  if (!Number.isFinite(m)) return "—";
  return m < 1000 ? Math.round(m) + " m" : (m / 1852).toFixed(2).replace(".", ",") + " NM";
}
export {bearing, distanceMeters};
