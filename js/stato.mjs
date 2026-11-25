// Sessione di regata: creazione, cambio modello senza perdere le posizioni, salvataggio e verifica dei file.
import {MODELLI} from "./campo.mjs?v=0.7.2";

export const CHIAVE = "rr-regatta-sessione-v1";
const copia = x => JSON.parse(JSON.stringify(x));
const nuovaBoa = b => ({codice: b.codice, nome: b.nome, tipo: b.tipo, pos: b.pos ? copia(b.pos) : null, storico: [], osservazioni: []});

export function nuovaSessione(modello = "loano-1", adesso = Date.now()) {
  const m = MODELLI[modello] || MODELLI["loano-1"];
  return {
    formato: "rr-regatta", versione: 1, creata: adesso,
    campo: {nome: m.nome, modello: MODELLI[modello] ? modello : "loano-1", sequenza: m.sequenza},
    boe: m.boe.map(nuovaBoa), tappa: 0,
    arrivo: {ugualePartenza: m.arrivo.ugualePartenza, etichette: [...m.arrivo.etichette], estremi: {a: null, b: null}, taglio: null},
    eventi: [], traccia: [], registro: [],
    vento: nuovoVento(), barca: {lunghezza: 10, angoloVirata: 90},
    timer: nuovoTimer(), cronometro: nuovoCrono()
  };
}
export const nuovoTimer = (ultimi10 = false) => ({zero: null, ultimi10, partenza: null});
export const nuovoCrono = () => ({inizio: null, accumulato: 0, parziali: [], posAvvio: null});
export function nuovoVento(imp) {
  return {iniziale: null, rif: {dritta: null, sinistra: null}, campioni: [], rotazione: null, bolina: false,
    imp: {soglia: 6, durataS: 20, mediaMin: 5, audio: true, ...(imp || {})}};
}

// Cambia modello mantenendo posizioni, rilevamenti e storico delle boe con lo stesso codice.
export function applicaModello(s, modello, {nome, sequenza} = {}) {
  const m = MODELLI[modello];
  if (!m) throw new Error("Modello sconosciuto");
  const vecchie = new Map(s.boe.map(b => [b.codice.toUpperCase(), b]));
  const boe = (modello === "personalizzato" && s.campo.modello === "personalizzato" ? s.boe : m.boe).map(b => {
    const v = vecchie.get(b.codice.toUpperCase());
    if (!v) return nuovaBoa(b);
    const tieni = v.pos && v.pos.fonte !== "istruzioni";
    return {...nuovaBoa(b), pos: tieni ? v.pos : (b.pos ? copia(b.pos) : v.pos), storico: v.storico || [], osservazioni: v.osservazioni || []};
  });
  const perse = s.boe.filter(b => (b.pos && b.pos.fonte !== "istruzioni") && !boe.some(n => n.codice.toUpperCase() === b.codice.toUpperCase()));
  const stessoArrivo = s.arrivo.ugualePartenza === m.arrivo.ugualePartenza;
  return {
    sessione: {...s, campo: {nome: nome || m.nome, modello, sequenza: sequenza || m.sequenza}, boe, tappa: 0,
      arrivo: {ugualePartenza: m.arrivo.ugualePartenza, etichette: [...m.arrivo.etichette],
        estremi: stessoArrivo ? s.arrivo.estremi : {a: null, b: null}, taglio: null}},
    perse
  };
}

export function verifica(obj) {
  if (!obj || obj.formato !== "rr-regatta" || obj.versione !== 1) throw new Error("non è un file di RR Regatta");
  if (!obj.campo || typeof obj.campo.sequenza !== "string" || !Array.isArray(obj.boe) || !obj.arrivo || !obj.arrivo.estremi)
    throw new Error("file incompleto");
  for (const b of obj.boe) if (typeof b.codice !== "string" || !b.codice) throw new Error("boa senza codice");
  obj.eventi ??= []; obj.traccia ??= []; obj.registro ??= []; obj.tappa = Number.isInteger(obj.tappa) ? obj.tappa : 0;
  // Sessioni create con versioni precedenti: si aggiungono vento e dati della barca.
  const v = nuovoVento(obj.vento?.imp);
  obj.vento = {...v, ...(obj.vento || {}), rif: {...v.rif, ...(obj.vento?.rif || {})}, imp: v.imp};
  obj.vento.campioni ??= [];
  obj.barca = {lunghezza: 10, angoloVirata: 90, ...(obj.barca || {})};
  obj.timer = {...nuovoTimer(), ...(obj.timer || {})};
  obj.cronometro = {...nuovoCrono(), ...(obj.cronometro || {})};
  for (const b of obj.boe) { b.storico ??= []; b.osservazioni ??= []; b.pos ??= null; }
  return obj;
}

export function carica(memoria) {
  try { const testo = memoria.getItem(CHIAVE); if (testo) return verifica(JSON.parse(testo)); } catch {}
  return null;
}
export function salva(memoria, s) {
  try { memoria.setItem(CHIAVE, JSON.stringify(s)); return true; } catch { return false; }
}
