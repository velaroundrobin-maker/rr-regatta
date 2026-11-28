// Sessione di regata: creazione, cambio modello senza perdere le posizioni, salvataggio e verifica dei file.
import {MODELLI} from "./campo.mjs?v=0.11.2";

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
    timer: nuovoTimer(), cronometro: nuovoCrono(), preferenze: {schermoIntero: true},
    registrazioni: [] // {id, modo, inizio, fine}; fine null = in corso
  };
}
// Registrazioni: la traccia, i dati ogni 2 s e i punti delle polari si salvano solo durante una registrazione.
export const registrazioneAttiva = s => { const r = s.registrazioni?.[s.registrazioni.length - 1]; return r && r.fine === null ? r : null; };
export function avviaRegistrazione(s, modo, t = Date.now()) {
  fermaRegistrazione(s, t);
  const r = {id: t, modo, inizio: t, fine: null};
  s.registrazioni.push(r);
  if (s.registrazioni.length > 100) s.registrazioni.splice(0, s.registrazioni.length - 100);
  return r;
}
export function fermaRegistrazione(s, t = Date.now()) {
  const r = registrazioneAttiva(s);
  if (r) r.fine = Math.max(r.inizio, t);
  return r;
}
export const nuovoTimer = (ultimi10 = false) => ({zero: null, ultimi10, partenza: null});
export const nuovoCrono = () => ({inizio: null, accumulato: 0, parziali: [], posAvvio: null});
export function nuovoVento(imp) {
  return {iniziale: null, rif: {dritta: null, sinistra: null}, campioni: [], rotazione: null, bolina: false,
    imp: {soglia: 4, durataS: 20, mediaMin: 5, audio: true, promemoriaMin: 3, ...(imp || {}), v11: true}};
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
  // v0.11: lo scarso si segnala da 4° (prima 6°): le sessioni salvate con il vecchio valore predefinito passano a 4°.
  if (obj.vento?.imp && !obj.vento.imp.v11 && obj.vento.imp.soglia === 6) obj.vento.imp.soglia = 4;
  const v = nuovoVento(obj.vento?.imp);
  obj.vento = {...v, ...(obj.vento || {}), rif: {...v.rif, ...(obj.vento?.rif || {})}, imp: v.imp};
  obj.vento.campioni ??= [];
  obj.barca = {lunghezza: 10, angoloVirata: 90, ...(obj.barca || {})};
  obj.timer = {...nuovoTimer(), ...(obj.timer || {})};
  obj.cronometro = {...nuovoCrono(), ...(obj.cronometro || {})};
  obj.preferenze = {schermoIntero: true, ...(obj.preferenze || {})};
  obj.registrazioni = (Array.isArray(obj.registrazioni) ? obj.registrazioni : []).filter(r => r && Number.isFinite(r.inizio) && typeof r.modo === "string" && (r.fine === null || Number.isFinite(r.fine)));
  obj.registrazioni.forEach((r, i, a) => { if (r.fine === null && i < a.length - 1) r.fine = a[i + 1].inizio; }); // una sola in corso, l'ultima
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
