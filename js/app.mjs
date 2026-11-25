// RR Regatta · v0.5: navigazione GPS, campo di regata, vento e tattica di bolina, polari apprese in allenamento.
import {gpsFixFromPosition, gpsErrorInfo} from "./gps.mjs?v=0.9.2";
import {markVMC, norm, delta} from "./engine.mjs?v=0.9.2";
import {smoothNav, derivaMoto, statoDato, numero, angolo, coordinata, scalaGrafica} from "./nav.mjs?v=0.9.2";
import {MODELLI, leggiSequenza, tappe, trovaBoa, obiettivo, triangola, distanzaTesto, lineaPartenza, lineaArrivo, bearing, distanceMeters,
  TIPI_ALLENAMENTO, campoAllenamento, aggiornaSequenza, prossimoCodice} from "./campo.mjs?v=0.9.2";
import {nuovaSessione, nuovoVento, nuovoTimer, nuovoCrono, applicaModello, verifica, carica, salva} from "./stato.mjs?v=0.9.2";
import {avviaTimer, sincronizza, spostaMinuto, segnali, testoTimer, testoCronometro, avviaFerma, tempoCronometro, distanzaTempo} from "./cronometro.mjs?v=0.9.2";
import {taratura, muraDa, rottaStabile, stimaDaBolina, analisiVento, buonoScarso, classificaVento, aggiornaAllarmeScarso,
  aggiornaAllarmeRotazione, bordoFavorevole, distanzaLayline, latoFavorito, boaDiBolina, rotteDiBolina, andatura, ANDATURE, ventoDaAndatura} from "./vento.mjs?v=0.9.2";
import {CHIAVE_POLARI, PRUA, RANDA, PORTANTI, MAX_CAMPIONI, nuovePolari, verificaPolari, chiaveVele, nomeVele, indiceVele, ventoVero,
  classeVento, valutaPunto, polare, ottimi, velocitaPolare, classiConDati, configurazioniConDati, tabellaCsv, unisciPolari} from "./polari.mjs?v=0.9.2";

const VERSIONE = "0.9.2";
const R = 6371008.8;
const rad = d => d * Math.PI / 180;
const $ = id => document.getElementById(id);
const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const ora = t => new Date(t).toLocaleTimeString("it-IT");
const etaTesto = ms => ms < 90000 ? "adesso" : Math.round(ms / 60000) + " min fa";
// «tarato» riferito al vento, «tarata» riferito alla direzione.
const fonteVento = (t, femminile = false) => { const o = femminile ? "a" : "o"; return t.fonte === "boline" ? "misurat" + o + " con le due boline" : t.fonte === "a mano" ? "inserit" + o + " a mano" : t.fonte === "andatura" ? "stimat" + o + " dall'andatura" : "tarat" + o + " a motore"; };
const oraBreve = t => new Date(t).toLocaleTimeString("it-IT", {hour: "2-digit", minute: "2-digit"});

// Errori del programma sempre visibili: niente più schermate mute.
function mostraErrore(testo) { const el = $("avviso-errore"); el.textContent = "Errore del programma: " + testo; el.hidden = false; }
addEventListener("error", e => mostraErrore(e.message || "sconosciuto"));
addEventListener("unhandledrejection", e => mostraErrore((e.reason && e.reason.message) || String(e.reason)));
$("versione").textContent = "";

// ---------------- Sessione salvata ----------------
const memoria = (() => { try { const m = window.localStorage; m.getItem("x"); return m; } catch { const d = new Map(); return {getItem: k => d.get(k) ?? null, setItem: (k, v) => d.set(k, v)}; } })();
let s = carica(memoria) || nuovaSessione("loano-1");
let attesaSalvataggio = null;
function salvaPresto() {
  clearTimeout(attesaSalvataggio);
  attesaSalvataggio = setTimeout(() => { if (!salva(memoria, s)) avvisa("Memoria del telefono piena: esporta la sessione."); }, 400);
}
function evento(testo) { s.eventi.unshift({t: Date.now(), testo}); if (s.eventi.length > 300) s.eventi.length = 300; }
function modificato() { salvaPresto(); disegnaViste(); aggiorna(); }
// Le polari sono della barca, non della regata: file a parte, che resta anche con «Nuova sessione».
let pol = (() => { try { const t = memoria.getItem(CHIAVE_POLARI); if (t) return verificaPolari(JSON.parse(t)); } catch {} return nuovePolari(); })();
let attesaPolari = null;
function salvaPolari(subito = false) {
  clearTimeout(attesaPolari);
  const fai = () => { try { memoria.setItem(CHIAVE_POLARI, JSON.stringify(pol)); } catch { avvisa("Memoria del telefono piena: esporta le polari."); } };
  if (subito) fai(); else attesaPolari = setTimeout(fai, 400);
}
addEventListener("pagehide", () => { salva(memoria, s); salvaPolari(true); });

let timerAvviso = null;
function avvisa(testo) { const el = $("avviso"); el.textContent = testo; el.hidden = false; clearTimeout(timerAvviso); timerAvviso = setTimeout(() => el.hidden = true, 3800); }

// ---------------- Stato della navigazione (non salvato) ----------------
const st = {
  watch: null, sessione: 0, fase: "fermo", problema: "", avviatoIl: 0,
  fix: null, fixes: [], origine: null,
  segui: true, centro: null, mpp: 1.2,
  mostraTraccia: false, vuoleSchermo: false, wakeLock: null,
  vista: "vista-home", modo: null, rilievo: {codice: null, lato: -1},
  mura: null, ultimaVirata: 0, stima: null, bs: null, allScarso: null, poggiataDa: null, ultimoRegistro: 0, audio: null,
  cronoAperto: false, cronoModo: "timer", ultimoTick: Date.now(), disegno: null, trascina: null, tocco: null, annullaDisegno: [], selezionata: null, vc: null, tipoAllenamento: "partenza",
  polRegistra: false, polValuta: null, polUltimo: 0, polCambioVele: 0, polNuovi: 0, polClasse: null, polConfig: "attuale", polMetodo: "fermo"
};
const gpsAttivo = () => st.watch !== null;
const fixVivo = () => gpsAttivo() && st.fix && Date.now() - st.fix.received <= 5000;

// ---------------- GPS ----------------
function avviaGps() {
  if (gpsAttivo()) {
    if (confirm("Spegnere il GPS? Rotta, velocità e distanze non saranno più aggiornate.")) fermaGps();
    return;
  }
  if (!("geolocation" in navigator) || !window.isSecureContext) {
    st.fase = "errore"; st.problema = "Questo browser non può usare il GPS (serve Chrome e un indirizzo https)."; aggiorna(); return;
  }
  const sessione = ++st.sessione;
  st.fase = "cerca"; st.problema = ""; st.avviatoIl = Date.now(); st.segui = true;
  try {
    st.watch = navigator.geolocation.watchPosition(p => puntoRicevuto(p, sessione), e => erroreGps(e, sessione),
      {enableHighAccuracy: true, maximumAge: 0, timeout: 30000});
  } catch (e) { st.fase = "errore"; st.problema = "Impossibile avviare il GPS: " + e.message; st.watch = null; }
  aggiorna();
}
function fermaGps() {
  st.sessione++;
  if (st.watch !== null) navigator.geolocation.clearWatch(st.watch);
  st.watch = null; st.fase = "fermo"; aggiorna();
}
function puntoRicevuto(pos, sessione) {
  if (sessione !== st.sessione) return;
  const adesso = Date.now();
  // Solo i valori forniti dal telefono; quelli mancanti si ricavano dagli spostamenti degli ultimi secondi.
  const fix = gpsFixFromPosition(pos, null, adesso);
  if (!fix) return;
  if (st.fix && Number.isFinite(fix.accuracy) && Number.isFinite(st.fix.accuracy) &&
      fix.accuracy > st.fix.accuracy * 3 && adesso - st.fix.received < 12000) return;
  fix.fonte = {sog: Number.isFinite(fix.sog) ? "telefono" : "calcolata", cog: Number.isFinite(fix.cog) ? "telefono" : "calcolata"};
  if (!Number.isFinite(fix.sog) || !Number.isFinite(fix.cog)) {
    const d = derivaMoto(st.fixes, fix);
    if (!Number.isFinite(fix.sog)) fix.sog = d.sog;
    if (!Number.isFinite(fix.cog)) fix.cog = d.cog;
  }
  fix.received = adesso;
  st.fix = fix; st.fase = "vivo"; st.problema = "";
  st.fixes.push(fix);
  while (st.fixes.length && adesso - st.fixes[0].received > 30000) st.fixes.shift();
  if (!st.origine) st.origine = {lat: fix.lat, lon: fix.lon};
  const u = s.traccia[s.traccia.length - 1];
  if (!u || (adesso - u.t > 3000 && metri(u, fix) > 3)) {
    s.traccia.push({lat: +fix.lat.toFixed(6), lon: +fix.lon.toFixed(6), t: adesso});
    if (s.traccia.length > 5000) s.traccia.shift();
  }
  elaboraVento(fix, adesso);
  elaboraPolari(adesso);
  aggiorna();
}
function erroreGps(err, sessione) {
  if (sessione !== st.sessione) return;
  const info = gpsErrorInfo(err);
  if (info.terminal) { fermaGps(); st.fase = "errore"; st.problema = info.detail; }
  else if (!st.fix) st.problema = info.detail;
  aggiorna();
}
const metri = (a, b) => Math.hypot(rad(b.lon - a.lon) * R * Math.cos(rad(a.lat)), rad(b.lat - a.lat) * R);
setInterval(() => { if (gpsAttivo()) salva(memoria, s); if (st.polNuovi) { salvaPolari(true); } }, 15000); // traccia e polari salvate periodicamente

// ---------------- Vento (Fase 3) ----------------
const tar = () => taratura({...s.vento, angoloVirata: s.barca.angoloVirata});
const opzioniVento = t => ({mediaMs: s.vento.imp.mediaMin * 60000, tarDir: t.dir});
function statoVento(adesso = Date.now()) { const t = tar(); return {tar: t, ...analisiVento(s.vento.campioni, adesso, opzioniVento(t))}; }

function elaboraVento(fix, adesso) {
  const t = tar();
  const prima = analisiVento(s.vento.campioni, adesso, opzioniVento(t));
  const rs = rottaStabile(st.fixes, adesso);
  // Mura dalla rotta e dal vento; il cambio di mura è una virata.
  const mura = Number.isFinite(prima.medio) && Number.isFinite(fix.cog) && fix.sog >= 1.5 ? muraDa(fix.cog, prima.medio) : null;
  if (mura && st.mura && mura !== st.mura) { st.ultimaVirata = adesso; if (s.vento.bolina) evento("Virata: ora mure a " + mura); }
  if (mura) st.mura = mura;
  const stima = stimaDaBolina({cog: rs.cog, bolina: s.vento.bolina, tar: t, dirAttuale: prima.medio, ultimaVirata: st.ultimaVirata, adesso});
  st.stima = rs.cog === null && s.vento.bolina && t.off ? {...stima, motivo: rs.motivo === "velocità bassa" ? "velocità bassa" : "rotta non stabile"} : stima;
  if (stima.dir !== null) {
    s.vento.campioni.push({t: adesso, dir: +stima.dir.toFixed(1), mura: stima.mura});
    while (s.vento.campioni.length && adesso - s.vento.campioni[0].t > 4 * 3600000) s.vento.campioni.shift();
  }
  // Se la barca ha poggiato a lungo, la bolina stretta si spegne da sola.
  if (s.vento.bolina && stima.motivo === "barca poggiata") {
    st.poggiataDa ??= adesso;
    if (adesso - st.poggiataDa > 30000) { s.vento.bolina = false; st.poggiataDa = null; evento("Bolina stretta terminata: la barca ha poggiato"); avvisa("Bolina stretta disattivata: la barca ha poggiato."); salvaPresto(); }
  } else st.poggiataDa = null;
  // Salto, buono/scarso e allarmi.
  const an = analisiVento(s.vento.campioni, adesso, opzioniVento(t));
  st.bs = buonoScarso(an.salto, stima.mura ?? st.mura);
  const eraAttivo = st.allScarso?.attivo;
  st.allScarso = aggiornaAllarmeScarso(st.allScarso, {bs: st.bs, valido: stima.dir !== null, adesso, soglia: s.vento.imp.soglia, durataMs: s.vento.imp.durataS * 1000});
  if (!eraAttivo && st.allScarso.attivo) { evento("ALLARME scarso di " + Math.round(st.allScarso.gradi) + "° (mure a " + st.mura + ", vento medio " + angolo(an.medio) + ")"); segnale(); }
  const eraRot = s.vento.rotazione?.attivo;
  // Il riferimento della rotazione si fissa solo con almeno 4 minuti di stime (evita falsi allarmi subito dopo la taratura).
  s.vento.rotazione = aggiornaAllarmeRotazione(s.vento.rotazione, {medio: an.nMedia >= 60 && an.copertura * s.vento.imp.mediaMin >= 4 ? an.medio : null, adesso, soglia: Math.max(8, s.vento.imp.soglia)});
  if (!eraRot && s.vento.rotazione.attivo) { evento("ALLARME rotazione del vento medio di " + Math.round(s.vento.rotazione.rotazione) + "°"); segnale(); }
  // Registro dati per l'analisi dopo l'uscita: un punto ogni 2 secondi.
  if (adesso - st.ultimoRegistro >= 2000) {
    st.ultimoRegistro = adesso;
    s.registro.push([adesso, +fix.lat.toFixed(6), +fix.lon.toFixed(6), Number.isFinite(fix.sog) ? +fix.sog.toFixed(2) : null,
      Number.isFinite(fix.cog) ? Math.round(fix.cog) : null, Number.isFinite(fix.accuracy) ? Math.round(fix.accuracy) : null, s.vento.bolina ? 1 : 0]);
    if (s.registro.length > 15000) s.registro.shift();
  }
}

// Suono e vibrazione dell'allarme. Il suono si sblocca al primo tocco sullo schermo (regola dei browser).
document.addEventListener("pointerdown", () => {
  try { const C = window.AudioContext || window.webkitAudioContext; if (C && !st.audio) st.audio = new C(); st.audio?.resume(); } catch {}
}, {once: false, passive: true});
function segnale() {
  try { navigator.vibrate?.([400, 150, 400, 150, 400]); } catch {}
  if (!s.vento.imp.audio || !st.audio) return;
  try {
    const a = st.audio, t0 = a.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      const o = a.createOscillator(), g = a.createGain(), t = t0 + i * 0.32;
      o.type = "square"; o.frequency.value = i % 2 ? 660 : 880;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.27);
    }
  } catch {}
}

function rottaPerTaratura(maxDispersione = 8) {
  if (!fixVivo()) { avvisa("Serve il GPS attivo con una posizione recente."); return null; }
  const r = rottaStabile(st.fixes, Date.now(), {finestraMs: 10000, maxDispersione});
  if (r.cog === null) { avvisa("Rotta non ancora utilizzabile (" + r.motivo + "): tieni la rotta costante, sopra 1,5 nodi, per una decina di secondi e riprova."); return null; }
  return r.cog;
}
function taraMotore() {
  const c = rottaPerTaratura(); if (c === null) return;
  if (st.polRegistra) { st.polRegistra = false; evento("Polari: registrazione fermata (taratura a motore)"); }
  if (s.vento.iniziale && !confirm("Sostituire il vento di riferimento " + angolo(s.vento.iniziale.dir) + " con " + angolo(c) + "? Le stime raccolte finora verranno azzerate.")) return;
  s.vento.iniziale = {dir: Math.round(c), metodo: "motore", t: Date.now()};
  s.vento.campioni = []; s.vento.rotazione = null;
  evento("Vento a motore: " + angolo(c));
  avvisa("Vento di riferimento registrato: " + angolo(c) + "." + (st.vista === "vista-polari" ? " Quando navighi a vela, riavvia la registrazione." : ""));
  modificato();
}
function taraBolina(mura) {
  const c = rottaPerTaratura(); if (c === null) return;
  const t = tar();
  if (t.dir !== null) {
    const ang = Math.abs(delta(c, t.dir)), m = muraDa(c, t.dir);
    if (ang < 15 || ang > 80) { avvisa("La rotta " + angolo(c) + " è a " + Math.round(ang) + "° dal vento di riferimento " + angolo(t.dir) + ": non sembra una bolina stretta. Controlla il vento o la rotta."); return; }
    if (m !== mura && !confirm("Con il vento a " + angolo(t.dir) + " la rotta " + angolo(c) + " risulta mure a " + m + ". Registrarla comunque come mure a " + mura + "?")) return;
  }
  s.vento.rif[mura] = {cog: Math.round(c), t: Date.now()};
  s.vento.bolina = true;
  const t2 = tar();
  // Nuovo riferimento dalle due boline: le stime raccolte con quello vecchio non si mescolano con le nuove.
  if (t2.fonte === "boline" && (t.fonte !== "boline" || Math.abs(delta(t2.dir, t.dir)) > 0.5 || t2.t !== t.t)) { s.vento.campioni = []; s.vento.rotazione = null; st.allScarso = null; }
  evento("Bolina mure a " + mura + ": " + angolo(c));
  const nuovo = t2.fonte === "boline" && (t.fonte !== "boline" || t2.t !== t.t);
  avvisa("Bolina mure a " + mura + " registrata: " + angolo(c) + "." +
    (nuovo ? " Nuovo vento di riferimento dalle due boline: " + angolo(t2.dir) + ", angolo di virata " + Math.round(t2.angoloVirata) + "°."
      : t2.misurato && t2.fonte !== "boline" ? " Angolo di virata misurato: " + Math.round(t2.angoloVirata) + "°."
      : " Ora registra l'altra mura."));
  modificato();
}
function taraMano() {
  const v = Number($("tar-mano").value);
  if (!Number.isFinite(v) || $("tar-mano").value === "" || v < 0 || v > 360) { avvisa("Scrivi la direzione da cui viene il vento, da 0 a 359 gradi."); return; }
  s.vento.iniziale = {dir: norm(Math.round(v)), metodo: "a mano", t: Date.now()};
  s.vento.campioni = []; s.vento.rotazione = null; $("tar-mano").value = "";
  evento("Vento impostato a mano: " + angolo(v)); avvisa("Vento di riferimento: " + angolo(v) + "."); modificato();
}
function azzeraTaratura() {
  if (!confirm("Azzerare vento di riferimento, boline registrate e stime raccolte?")) return;
  s.vento = nuovoVento(s.vento.imp); st.allScarso = null;
  evento("Taratura del vento azzerata"); modificato();
}

// ---------------- Polari (Fase 4b) ----------------
const veleAttuali = () => indiceVele(pol, pol.vele);
function elaboraPolari(adesso) {
  if (!st.polRegistra) { st.polValuta = null; return; }
  const t = tar();
  st.polValuta = valutaPunto({fixes: st.fixes, adesso, rif: {dir: t.dir, t: t.t, fonte: t.fonte}, vento: pol.vento,
    validitaMs: pol.imp.validitaMin * 60000, ultimoCambioVele: st.polCambioVele});
  if (st.polValuta.ok && adesso - st.polUltimo >= 2000) {
    st.polUltimo = adesso;
    pol.campioni.push([adesso, +st.polValuta.twa.toFixed(1), +st.polValuta.sog.toFixed(2), +pol.vento.tws.toFixed(1), veleAttuali()]);
    if (pol.campioni.length > MAX_CAMPIONI) pol.campioni.splice(0, pol.campioni.length - MAX_CAMPIONI);
    if (++st.polNuovi % 10 === 0 && st.vista === "vista-polari") disegnaPolari();
  }
}
function registraPolari() {
  if (!st.polRegistra) {
    if (!gpsAttivo()) { avvisa("Prima accendi il GPS."); return; }
    if (tar().dir === null) avvisa("Prima tara la direzione del vento con la prua al vento a motore.");
    else if (!pol.vento) avvisa("Inserisci l'intensità del vento letta con l'anemometro.");
  }
  st.polRegistra = !st.polRegistra; st.polValuta = null;
  evento("Polari: registrazione " + (st.polRegistra ? "avviata · " + nomeVele(chiaveVele(pol.vele)) : "fermata"));
  salvaPolari(); modificato();
}
function inserisciVento() {
  const letto = Number(String($("pol-tws").value).replace(",", "."));
  if ($("pol-tws").value === "" || !Number.isFinite(letto) || letto < 0 || letto > 60) { avvisa("Scrivi il vento letto, in nodi."); return; }
  st.polMetodo = "fermo"; // per ora l'intensità si legge solo a barca ferma, con l'anemometro di coperta
  const sog = 0;
  if (st.polMetodo === "motore" && !Number.isFinite(sog)) { avvisa("A motore serve il GPS attivo: l'app toglie la velocità della barca."); return; }
  const tws = ventoVero(letto, st.polMetodo, sog);
  pol.vento = {tws: +tws.toFixed(1), letto, metodo: st.polMetodo, sog: Number.isFinite(sog) ? +sog.toFixed(1) : null, t: Date.now()};
  pol.letture.push({...pol.vento});
  evento("Vento a barca ferma: " + numero(tws, 1) + " nodi");
  avvisa("Vento inserito: " + numero(tws, 1) + " nodi" + (classeVento(tws) ? " (polare dei " + classeVento(tws) + " nodi)." : ", troppo poco per le polari."));
  st.polClasse = null; salvaPolari(); modificato();
}
function cambiaVele(tipo, valore) {
  if (pol.vele[tipo] === valore) return;
  pol.vele = {...pol.vele, [tipo]: valore};
  st.polCambioVele = Date.now();
  evento("Vele: " + nomeVele(chiaveVele(pol.vele)));
  salvaPolari(); modificato();
}
const ultimoHtml = new Map();
const html = (id, testo) => { if (ultimoHtml.get(id) !== testo) { ultimoHtml.set(id, testo); $(id).innerHTML = testo; } }; // non ridisegna se non cambia: niente tocchi persi
const pulsantiScelta = (valori, scelto, attr) => valori.map(v => '<button type="button" ' + attr + '="' + esc(v) + '" aria-pressed="' + (v === scelto) + '">' + esc(v) + "</button>").join("");
function configScelta() {
  if (st.polConfig === "tutte") return "tutte";
  if (st.polConfig === "attuale") return veleAttuali();
  return Number(st.polConfig);
}
function classeScelta() { return st.polClasse ?? classeVento(pol.vento?.tws) ?? classiConDati(pol)[0] ?? null; }

function disegnaPolariVivo() {
  const adesso = Date.now(), t = tar(), r = $("pol-registra");
  r.setAttribute("aria-pressed", String(st.polRegistra));
  r.textContent = st.polRegistra ? "Stop registrazione" : "Avvia la registrazione";
  const val = st.polValuta, nConfig = pol.campioni.filter(c => c[4] === pol.configurazioni.indexOf(chiaveVele(pol.vele))).length;
  const el = $("pol-stato");
  el.className = "pol-stato" + (st.polRegistra && val && !val.ok ? " pausa" : "");
  el.textContent = !st.polRegistra ? "Registrazione ferma. " + pol.campioni.length + " punti salvati in tutto."
    : !gpsAttivo() ? "In pausa: GPS fermo."
    : !val ? "In attesa del GPS…"
    : val.ok ? "Registrazione in corso: " + nConfig + " punti con queste vele (" + Math.round(nConfig * 2 / 60) + " min)."
    : "In pausa: " + val.motivo + ".";
  const vivo = fixVivo(), twa = vivo && t.dir !== null && Number.isFinite(st.fix.cog) && st.fix.sog >= 0.5 ? delta(st.fix.cog, t.dir) : null;
  $("pol-twa").textContent = twa === null ? "—" : Math.round(Math.abs(twa)) + "°";
  $("pol-twa-nota").textContent = twa === null ? (t.dir === null ? "vento da tarare" : " ") : "mure a " + (twa >= 0 ? "sinistra" : "dritta");
  $("pol-sog").textContent = vivo && Number.isFinite(st.fix.sog) ? numero(st.fix.sog, 1) : "—";
  const classe = classeVento(pol.vento?.tws), punti = classe ? polare(pol, classe, veleAttuali()) : [];
  const vp = twa === null ? null : velocitaPolare(punti, twa);
  $("pol-rif").textContent = vp ? numero(vp, 1) : "—";
  $("pol-rif-nota").textContent = vp && vivo ? Math.round(st.fix.sog / vp * 100) + "% della polare" : classe ? "ancora pochi dati" : " ";
  $("pol-vento-stato").textContent = "Direzione: " + (t.dir === null ? "da tarare" : angolo(t.dir) + ", " + fonteVento(t, true) + (t.t ? " " + etaTesto(adesso - t.t) : "")) +
    ". Intensità: " + (pol.vento ? numero(pol.vento.tws, 1) + " nodi, inserita " + etaTesto(adesso - pol.vento.t) : "da inserire") + ".";
  $("versione").textContent = st.polRegistra ? " · polari" : "";
  $("versione").className = st.polRegistra ? "registra" : "";
}
function disegnaPolari() {
  disegnaPolariVivo();
  html("pol-prua", pulsantiScelta(PRUA, pol.vele.prua, "data-prua"));
  html("pol-randa", pulsantiScelta(RANDA, pol.vele.randa, "data-randa"));
  html("pol-portante", pulsantiScelta(PORTANTI, pol.vele.portante, "data-portante"));
  $("pol-vele-stato").textContent = "A riva: " + nomeVele(chiaveVele(pol.vele)) + ".";
  document.querySelectorAll("[data-metodo]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.metodo === st.polMetodo)));
  $("pol-validita").value = String(pol.imp.validitaMin);
  // Classi di vento e configurazioni con dati.
  const classe = classeScelta(), conDati = new Set(classiConDati(pol));
  const classi = [...new Set([...conDati, ...(classeVento(pol.vento?.tws) ? [classeVento(pol.vento.tws)] : [])])].sort((a, b) => a - b);
  html("pol-classi", classi.length ? classi.map(k => '<button type="button" data-classe="' + k + '" aria-pressed="' + (k === classe) + '" class="' + (conDati.has(k) ? "" : "vuota") + '">' + k + " kn</button>").join("")
    : '<span class="aiuto">Nessun dato ancora.</span>');
  const cfg = configurazioniConDati(pol, classe);
  html("pol-config", '<option value="attuale">Le vele a riva adesso</option><option value="tutte">Le vele migliori per ogni angolo</option>' +
    cfg.map(i => '<option value="' + i + '">' + esc(nomeVele(pol.configurazioni[i])) + "</option>").join(""));
  $("pol-config").value = ["attuale", "tutte"].includes(st.polConfig) || cfg.includes(Number(st.polConfig)) ? String(st.polConfig) : "attuale";
  const scelta = configScelta(), punti = classe ? polare(pol, classe, scelta) : [], o = ottimi(punti);
  disegnaGraficoPolare(punti, o, classe);
  $("pol-ottimi").textContent = !punti.some(q => q.valido) ? "Ancora pochi dati per questa polare."
    : (o.bolina ? "Bolina migliore: " + o.bolina.twa + "° a " + numero(o.bolina.v, 1) + " kn, VMC " + numero(o.bolina.vmg, 1) + " kn (angolo di virata " + 2 * o.bolina.twa + "°). " : "Bolina: dati insufficienti. ") +
      (o.poppa ? "Poppa migliore: " + o.poppa.twa + "° a " + numero(o.poppa.v, 1) + " kn, VMC " + numero(o.poppa.vmg, 1) + " kn." : "Poppa: dati insufficienti.");
  const uv = $("pol-usa-virata");
  uv.hidden = !o.bolina; if (o.bolina) { uv.dataset.angolo = String(2 * o.bolina.twa); uv.textContent = "Usa " + 2 * o.bolina.twa + "° come angolo di virata in regata"; }
  const tutte = scelta === "tutte";
  html("pol-tabella", punti.length ? "<tr><th>Angolo</th><th>Velocità</th><th>Punti D/S</th>" + (tutte ? "<th>Vele</th>" : "") + "</tr>" +
    punti.map(q => '<tr class="' + (!q.valido ? "debole" : q.twa === o.bolina?.twa || q.twa === o.poppa?.twa ? "ottimo" : "") + '"><td>' + q.twa + '°</td><td class="v">' +
      (q.valido ? numero(q.v, 2) : "(" + numero(q.v, 1) + ")") + "</td><td>" + q.nD + "/" + q.nS + "</td>" + (tutte ? "<td>" + esc(nomeVele(pol.configurazioni[q.config])) + "</td>" : "") + "</tr>").join("") : "");
  const n = pol.campioni.length, ore = n ? (n * 2 / 3600) : 0;
  $("pol-riepilogo").textContent = n ? n + " punti (circa " + numero(ore, 1) + " ore di navigazione utile), " + pol.configurazioni.length + " combinazioni di vele, " +
    (g => g + (g === 1 ? " giorno" : " giorni") + " di uscita.")(new Set(pol.campioni.map(c => new Date(c[0]).toDateString())).size) : "Nessun punto registrato.";
}
// Diagramma polare: vento dall'alto, angoli dal vento a destra, cerchi ogni nodo.
function disegnaGraficoPolare(punti, o, classe) {
  const svg = $("grafico-polare"), W = svg.clientWidth, H = svg.clientHeight;
  if (!W || !H) return;
  if (!punti.length) { svg.innerHTML = '<text x="' + W / 2 + '" y="' + H / 2 + '" fill="#b5b5b5" font-size="14" text-anchor="middle">' + (classe ? "Nessun punto con " + classe + " nodi" : "Inserisci il vento e registra") + "</text>"; return; }
  const vmax = Math.max(4, Math.ceil(Math.max(...punti.map(q => q.v)) + 0.5)), cy = H / 2, Rg = Math.min(W - 40, H / 2 - 14), cx = Math.max(26, (W - Rg) / 2 - 10);
  const xy = (a, v) => ({x: cx + Rg * v / vmax * Math.sin(a * Math.PI / 180), y: cy - Rg * v / vmax * Math.cos(a * Math.PI / 180)});
  let out = "";
  for (let v = 1; v <= vmax; v++) {
    const r = Rg * v / vmax;
    out += '<path d="M' + cx + " " + (cy - r) + "A" + r + " " + r + " 0 0 1 " + cx + " " + (cy + r) + '" fill="none" stroke="' + (v % 2 ? "#262626" : "#3a3a3a") + '"/>';
    if (v % 2 === 0 || vmax <= 6) out += '<text x="' + (cx - 4) + '" y="' + (cy - r + 4) + '" fill="#b5b5b5" font-size="11" text-anchor="end">' + v + "</text>";
  }
  for (const a of [0, 30, 45, 60, 90, 120, 135, 150, 180]) {
    const p = xy(a, vmax);
    out += '<path d="M' + cx + " " + cy + "L" + p.x.toFixed(1) + " " + p.y.toFixed(1) + '" stroke="#2c2c2c"/>';
    if (a && a < 180) { const q = xy(a, vmax * 1.0); out += '<text x="' + Math.min(W - 4, q.x + 3).toFixed(1) + '" y="' + (q.y + (a < 90 ? -2 : 12)).toFixed(1) + '" fill="#b5b5b5" font-size="11" text-anchor="' + (q.x > W - 30 ? "end" : "start") + '">' + a + "°</text>"; }
  }
  out += '<text x="' + cx + '" y="11" fill="#fff" font-size="11" text-anchor="middle">VENTO</text>';
  const validi = punti.filter(q => q.valido);
  if (validi.length > 1) out += '<path d="' + validi.map((q, i) => { const p = xy(q.twa, q.v); return (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1); }).join("") + '" fill="none" stroke="#ff0000" stroke-width="3" stroke-linejoin="round"/>';
  for (const q of punti) {
    const p = xy(q.twa, q.v);
    out += q.valido ? '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4" fill="#fff"/>' : '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4" fill="none" stroke="#b5b5b5" stroke-width="1.5"/>';
  }
  for (const k of ["bolina", "poppa"]) if (o[k]) {
    const p = xy(o[k].twa, o[k].v);
    out += '<path d="M' + cx + " " + cy + "L" + p.x.toFixed(1) + " " + p.y.toFixed(1) + '" stroke="#fff" stroke-dasharray="4 4"/><circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="7" fill="none" stroke="#fff" stroke-width="2"/>';
  }
  svg.innerHTML = out;
}
function scaricaFile(nome, testo, tipo) {
  const url = URL.createObjectURL(new Blob([testo], {type: tipo}));
  const a = document.createElement("a"); a.href = url; a.download = nome; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const dataFile = () => { const d = new Date(); return d.toISOString().slice(0, 10) + "-" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0"); };

// ---------------- Timer di partenza e cronometro (v0.6) ----------------
// Suoni: beep lungo e forte ai minuti, raffica allo zero («partiti»), beep breve negli ultimi 10 secondi.
function suono(tipo) {
  try { navigator.vibrate?.(tipo === "partenza" ? [150, 80, 150, 80, 150, 80, 150, 80, 150, 80, 150, 80, 150, 80, 150, 80, 150] : tipo === "lungo" ? [1000] : [80]); } catch {}
  const a = st.audio; if (!a) return;
  try {
    if (a.state === "suspended") a.resume(); // dopo uno schermo spento il browser sospende l'audio
    const t0 = a.currentTime + 0.02;
    const bip = (t, durata, freq) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = "square"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45, t + 0.015);
      g.gain.setValueAtTime(0.45, t + durata - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + durata);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + durata + 0.02);
    };
    if (tipo === "lungo") bip(t0, 1.1, 880);
    else if (tipo === "partenza") for (let i = 0; i < 9; i++) bip(t0 + i * 0.22, 0.13, 1050);
    else bip(t0, 0.12, 1250);
  } catch {}
}
function tickTimer() {
  const adesso = Date.now(), z = s.timer.zero;
  if (Number.isFinite(z)) for (const x of segnali(z, st.ultimoTick, adesso, {ultimi10: s.timer.ultimi10})) {
    suono(x.tipo);
    if (x.tipo === "partenza") { s.timer.partenza = z; evento("PARTENZA dal timer alle " + ora(z)); salvaPresto(); }
    else if (x.tipo === "lungo") evento("Timer: −" + x.minuto + " min");
  }
  st.ultimoTick = adesso;
  if (st.vista === "vista-nav") disegnaCrono(adesso);
  if (adesso - (st.ultimoControllo || 0) < 1000) return; // una volta al secondo basta
  st.ultimoControllo = adesso;
  // La selezione di una boa con un tocco si chiude da sola dopo 20 secondi: in regata non si sposta una boa per sbaglio.
  if (st.disegno?.daTocco && adesso - st.disegno.ultimoTocco > 20000) { st.disegno = null; st.selezionata = null; disegnaBarra(); salvaPresto(); aggiorna(); }
  controllaRichiesta(adesso);
  if (st.andaturaAperta && st.vista === "vista-nav") disegnaAndatura();
}
function comandoTimer(azione) {
  const adesso = Date.now(), z = s.timer.zero;
  if (azione === "avvia") { s.timer.zero = avviaTimer(adesso); s.timer.partenza = null; evento("Timer avviato: −5:00"); suono("lungo"); }
  else if (azione === "sinc") { s.timer.zero = sincronizza(z, adesso); evento("Timer sincronizzato: " + testoTimer(s.timer.zero, adesso)); suono("breve"); }
  else if (azione === "meno") s.timer.zero = spostaMinuto(z, -1);
  else if (azione === "piu") s.timer.zero = spostaMinuto(z, 1);
  else if (azione === "ferma") {
    if (z > adesso && !confirm("Stop del timer di partenza?")) return;
    s.timer.zero = null; evento("Timer fermato");
  }
  st.ultimoTick = adesso; salvaPresto(); disegnaCrono(adesso);
}
function testoLinea(adesso) {
  const linea = lineaPartenza(s.boe);
  if (!linea) return {testo: "Per distanza e tempo dalla linea servono barca comitato e pin segnati.", classe: ""};
  if (!fixVivo()) return {testo: "Serve il GPS per distanza e tempo dalla linea.", classe: ""};
  const nav = smoothNav(st.fixes), sv = statoVento(adesso);
  const prima = trovaBoa(s.boe, tappe(s.campo.sequenza).find(t => t.tipo === "boa")?.codice || "")?.pos || null;
  const r = distanzaTempo({barca: st.fix, cog: nav.cog, sog: nav.sog, linea, dirVento: Number.isFinite(sv.medio) ? sv.medio : sv.tar.dir, boa: prima,
    mancanoMs: Number.isFinite(s.timer.zero) ? s.timer.zero - adesso : null});
  if (!r) return {testo: "Linea troppo corta: controlla barca comitato e pin.", classe: ""};
  const prePartenza = Number.isFinite(s.timer.zero) && s.timer.zero > adesso;
  if (r.oltreLinea) return {testo: prePartenza ? "OLTRE LA LINEA: torna sotto!" : "Oltre la linea di " + Math.round(-r.distanza) + " m", classe: prePartenza ? "allarme-linea" : ""};
  const parti = ["Linea " + Math.round(r.distanza) + " m"];
  if (r.secondi !== null) parti.push(Math.round(r.secondi) + " s a " + numero(r.verso, 1) + " kn");
  else if (r.verso !== null && r.verso <= 0.3) parti.push(r.verso < 0 ? "ti stai allontanando" : "rotta parallela alla linea");
  if (prePartenza && r.scarto !== null) parti.push(r.scarto < -1.5 ? "ANTICIPO " + Math.round(-r.scarto) + " s" : r.scarto > 1.5 ? "RITARDO " + Math.round(r.scarto) + " s" : "IN TEMPO");
  if (r.fuori) parti.push(r.fuori);
  if (!r.orientata) parti.push("lato del percorso incerto: tara il vento");
  return {testo: parti.join(" · "), classe: ""};
}
function disegnaCrono(adesso = Date.now()) {
  const z = s.timer.zero, cr = s.cronometro, timerAttivo = Number.isFinite(z), crAttivo = cr.inizio !== null || cr.accumulato > 0;
  $("crono").hidden = !st.cronoAperto;
  const pill = $("crono-pillola");
  pill.hidden = st.cronoAperto || !(timerAttivo || cr.inizio !== null);
  if (!pill.hidden) { pill.textContent = timerAttivo ? testoTimer(z, adesso) : "⏱ " + testoCronometro(tempoCronometro(cr, adesso)); pill.className = "crono-pillola" + (timerAttivo && z <= adesso ? " partiti" : ""); }
  // Il tempo che corre si legge nel pulsante Timer, senza riquadri sopra la mappa.
  const bc = $("btn-crono"), corre = timerAttivo || cr.inizio !== null;
  bc.textContent = timerAttivo ? testoTimer(z, adesso) : cr.inizio !== null ? testoCronometro(tempoCronometro(cr, adesso)).replace(/,\d$/, "") : "Timer";
  bc.classList.toggle("in-corso", corre && !st.cronoAperto);
  bc.classList.toggle("attivo", st.cronoAperto);
  if (!st.cronoAperto) return;
  document.querySelectorAll("[data-modo]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.modo === st.cronoModo)));
  $("crono-timer").hidden = st.cronoModo !== "timer"; $("crono-cronometro").hidden = st.cronoModo !== "cronometro";
  if (st.cronoModo === "timer") {
    const t = $("timer-tempo");
    t.textContent = timerAttivo ? testoTimer(z, adesso) : "−5:00";
    t.className = "crono-tempo" + (timerAttivo && z <= adesso ? " partiti" : "");
    const info = $("timer-info");
    if (timerAttivo && z <= adesso) { info.textContent = "Partiti alle " + ora(z) + " · tempo di regata"; info.className = "crono-info"; }
    else { const l = testoLinea(adesso); info.textContent = l.testo; info.className = "crono-info " + l.classe; }
    html("timer-comandi", !timerAttivo ? '<button type="button" class="principale" data-timer="avvia">Avvia −5:00</button>'
      : z > adesso ? '<button type="button" class="principale largo2" data-timer="sinc">Sincronizza</button><button type="button" data-timer="meno" aria-label="Un minuto in meno">−1′</button><button type="button" data-timer="piu" aria-label="Un minuto in più">+1′</button><button type="button" data-timer="ferma">Stop</button>'
      : '<button type="button" data-timer="avvia">Nuova partenza</button><button type="button" data-timer="ferma">Stop</button>');
  } else {
    $("cr-tempo").textContent = testoCronometro(tempoCronometro(cr, adesso));
    $("cr-avvia").textContent = cr.inizio !== null ? "Stop" : crAttivo ? "Riprendi" : "Avvia";
    $("cr-parziale").disabled = !crAttivo; $("cr-azzera").disabled = !crAttivo;
    html("cr-parziali", [...cr.parziali].reverse().map((p, i, lista) => {
      const n = cr.parziali.length - i, prec = cr.parziali[n - 2], daT = prec ? prec.totale : 0, daPos = prec ? prec.pos : cr.posAvvio;
      const dt = (p.totale - daT) / 1000, d = p.pos && daPos ? distanceMeters(daPos, p.pos) : null;
      return "<li><b>" + n + ". " + testoCronometro(p.totale) + "</b><span>+" + testoCronometro(p.totale - daT) + (d !== null ? " · " + Math.round(d) + " m · " + (dt > 0 ? numero(d / dt * 1.943844, 1) + " kn" : "—") : "") + "</span></li>";
    }).join(""));
  }
}
const posAdesso = () => fixVivo() ? {lat: st.fix.lat, lon: st.fix.lon} : null;
function comandoCronometro(azione) {
  const adesso = Date.now(), cr = s.cronometro;
  if (azione === "avvia") {
    if (cr.inizio === null && cr.accumulato === 0) cr.posAvvio = posAdesso();
    s.cronometro = {...cr, ...avviaFerma(cr, adesso)};
  } else if (azione === "parziale") {
    cr.parziali.push({t: adesso, totale: tempoCronometro(cr, adesso), pos: posAdesso()});
    suono("breve");
  } else if (azione === "azzera") {
    if (cr.parziali.length && !confirm("Azzerare il cronometro e i " + cr.parziali.length + " tempi parziali?")) return;
    if (cr.parziali.length) evento("Cronometro azzerato: " + cr.parziali.map((p, i) => (i + 1) + ". " + testoCronometro(p.totale)).join(", "));
    s.cronometro = nuovoCrono();
  }
  salvaPresto(); disegnaCrono(adesso);
}

// ---------------- Disegno del campo sulla mappa (v0.6) ----------------
function daSchermo(p) {
  const v = st.vc; if (!v) return null;
  return {lat: v.c.lat + (v.H / 2 - p.y) * v.m / R * 180 / Math.PI, lon: v.c.lon + (p.x - v.W / 2) * v.m / (R * v.k) * 180 / Math.PI};
}
function boaVicina(p) {
  const v = st.vc; if (!v) return null;
  let migliore = null, dmin = 28;
  for (const b of s.boe) {
    if (!b.pos) continue;
    const x = v.W / 2 + rad(b.pos.lon - v.c.lon) * R * v.k / v.m, y = v.H / 2 - rad(b.pos.lat - v.c.lat) * R / v.m, d = Math.hypot(x - p.x, y - p.y);
    if (d < dmin) { dmin = d; migliore = b; }
  }
  return migliore;
}
function avviaDisegno() {
  if (!st.centro) {
    // Anche prima di uscire, senza GPS: si parte dall'ultima posizione nota, dalle boe o da Loano.
    const ultima = s.traccia[s.traccia.length - 1];
    if (st.fix) st.centro = {lat: st.fix.lat, lon: st.fix.lon};
    else if (s.boe.some(b => b.pos)) inquadraTutto();
    else st.centro = ultima ? {lat: ultima.lat, lon: ultima.lon} : {lat: 44.135, lon: 8.27};
  }
  // Sopra un campo di regata: campo nuovo da disegnare, oppure boe aggiunte al campo esistente.
  if (s.campo.modello !== "allenamento") {
    if (confirm("Disegnare un campo nuovo al posto di «" + s.campo.nome + "»?\n\nOK: campo nuovo, vuoto (le boe del campo attuale si tolgono).\nAnnulla: aggiungi boe al campo attuale.")) {
      s.campo = {nome: "Campo disegnato", modello: "allenamento", sequenza: ""};
      s.boe = []; s.tappa = 0;
      s.arrivo = {ugualePartenza: true, etichette: ["Barca comitato", "Pin"], estremi: {a: null, b: null}, taglio: null};
      evento("Nuovo campo da disegnare");
    } else avvisa("Le boe che aggiungi vanno inserite a mano nella sequenza (scheda Regata → Cambia campo di regata).");
  }
  st.disegno = {metti: s.boe.some(b => b.codice === "CdR" && b.pos) ? "boa" : "CdR"}; st.segui = false; st.selezionata = null; st.annullaDisegno = [];
  mostraVista("vista-nav"); disegnaBarra(); salvaPresto();
  avvisa(st.disegno.metti === "CdR" ? "Tocca la mappa dove mettere la barca comitato, poi il pin; poi le boe. Trascina per spostare." : "Tocca la mappa per mettere una boa; trascina una boa per spostarla.");
}
function disegnaBarra() {
  $("disegno-barra").hidden = !st.disegno;
  document.body.classList.toggle("disegnando", !!st.disegno); // mentre si disegna la mappa prende il posto degli strumenti
  if (!st.disegno) return;
  document.querySelectorAll("[data-metti]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.metti === st.disegno.metti)));
  const t = $("disegno-togli");
  t.hidden = !st.selezionata; t.textContent = "Cancella " + (st.selezionata === "P" ? "pin" : st.selezionata === "CdR" ? "comitato" : st.selezionata || "");
  $("disegno-annulla").disabled = !st.annullaDisegno.length;
  $("disegno-aiuto").textContent = st.disegno.metti === "boa" ? "Tocca la mappa per mettere una boa. Trascina una boa per spostarla; toccala per sceglierla."
    : "Tocca la mappa dove mettere " + (st.disegno.metti === "CdR" ? "la barca comitato (estremo destro della linea, guardando il vento)." : "il pin (estremo sinistro della linea, guardando il vento).");
}
function metti(punto) {
  if (!punto) return;
  const pos = {...punto, acc: null, t: Date.now(), fonte: "disegnata"}, cosa = st.disegno.metti;
  if (cosa === "boa") {
    const codice = prossimoCodice(s.boe);
    st.annullaDisegno.push({tipo: "aggiungi", codice, sequenza: s.campo.sequenza});
    s.boe.push({codice, nome: "Boa " + codice + " (virtuale)", tipo: "percorso", pos, storico: [], osservazioni: []});
    st.selezionata = codice;
    dopoDisegno("Boa virtuale " + codice, {aggiunta: codice});
  } else {
    let b = trovaBoa(s.boe, cosa);
    if (b) st.annullaDisegno.push({tipo: "sposta", codice: b.codice, pos: b.pos ? {...b.pos} : null, sequenza: s.campo.sequenza});
    else { b = {codice: cosa, nome: cosa === "CdR" ? "Battello comitato (virtuale)" : "Boa di partenza (virtuale)", tipo: "partenza", pos: null, storico: [], osservazioni: []}; st.annullaDisegno.push({tipo: "aggiungi", codice: cosa, sequenza: s.campo.sequenza}); s.boe.unshift(b); }
    b.pos = pos;
    // Messa la barca CdR si passa alla boa P, e viceversa finché manca.
    if (cosa === "CdR" && !trovaBoa(s.boe, "P")?.pos) st.disegno.metti = "P";
    else if (cosa === "P" && !trovaBoa(s.boe, "CdR")?.pos) st.disegno.metti = "CdR";
    else st.disegno.metti = "boa";
    dopoDisegno((cosa === "CdR" ? "Barca comitato" : "Pin") + " virtuale");
  }
}
function dopoDisegno(testo, modifica = {}) {
  if (s.campo.modello === "allenamento") {
    if (modifica.sequenza !== undefined) s.campo.sequenza = modifica.sequenza;
    else s.campo.sequenza = aggiornaSequenza(s.campo.sequenza, s.boe, modifica);
    s.tappa = Math.min(s.tappa, Math.max(0, tappe(s.campo.sequenza).length - 1));
  }
  if (testo) evento("Disegno: " + testo);
  salvaPresto(); disegnaBarra(); aggiorna();
}
function annullaDisegno() {
  const a = st.annullaDisegno.pop(); if (!a) return;
  if (a.tipo === "aggiungi") s.boe = s.boe.filter(b => b.codice !== a.codice);
  else if (a.tipo === "sposta") { const b = trovaBoa(s.boe, a.codice); if (b) b.pos = a.pos; }
  else if (a.tipo === "togli") s.boe.splice(Math.min(a.indice, s.boe.length), 0, a.boa);
  st.selezionata = null; dopoDisegno("annullato", {sequenza: a.sequenza});
}
function togliSelezionata() {
  const i = s.boe.findIndex(b => b.codice === st.selezionata); if (i < 0) return;
  const codice = s.boe[i].codice;
  // Nei campi di regata la boa fa parte del percorso: si cancella solo la sua posizione.
  if (s.campo.modello !== "allenamento" && tappe(s.campo.sequenza).some(t => t.codice?.toUpperCase() === codice.toUpperCase())) {
    st.annullaDisegno.push({tipo: "sposta", codice, pos: s.boe[i].pos ? {...s.boe[i].pos} : null, sequenza: s.campo.sequenza});
    s.boe[i].pos = null; st.selezionata = null;
    dopoDisegno("cancellata la posizione di " + codice, {sequenza: s.campo.sequenza});
    return;
  }
  st.annullaDisegno.push({tipo: "togli", boa: s.boe[i], indice: i, sequenza: s.campo.sequenza});
  s.boe.splice(i, 1); st.selezionata = null;
  dopoDisegno("cancellata " + codice, {tolta: codice});
}
// Tocco su una boa fuori dal disegno: si seleziona e si apre la barra per spostarla o cancellarla.
function selezionaBoa(codice) {
  st.disegno = {metti: "boa", daTocco: true, ultimoTocco: Date.now()}; st.selezionata = codice; st.segui = false; st.annullaDisegno = [];
  st.cronoAperto = false; st.andaturaAperta = false; disegnaCrono(); disegnaAndatura();
  disegnaBarra(); aggiorna();
  const b = trovaBoa(s.boe, codice);
  avvisa((codice === "CdR" ? "Barca comitato" : codice === "P" ? "Pin" : "Boa " + codice) + " selezionata: trascinala per spostarla, «Cancella» per toglierla, «Fine» per chiudere.");
}
function fineDisegno() {
  st.disegno = null; st.selezionata = null; disegnaBarra();
  // La mappa torna alla sua misura: inquadra barca e boe, così si vede subito il campo intero.
  if ([st.fix, ...s.boe.map(b => b.pos)].some(p => p && Number.isFinite(p.lat))) inquadraTutto();
  evento("Campo disegnato: " + s.campo.sequenza); salvaPresto(); modificato();
  if (s.campo.modello !== "allenamento" && s.boe.some(b => b.pos?.fonte === "disegnata")) avvisa("Ricorda di controllare la sequenza in Regata → Cambia campo.");
}

// ---------------- Campi d'allenamento pronti ----------------
function disegnaAllenamento() {
  document.querySelectorAll("[data-tipo]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tipo === st.tipoAllenamento)));
  const sv = statoVento(), w = Number.isFinite(sv.medio) ? sv.medio : sv.tar.dir;
  if (document.activeElement !== $("all-vento") && $("all-vento").value === "" && Number.isFinite(w)) $("all-vento").value = String(Math.round(w));
  const t = st.tipoAllenamento;
  $("all-linea").disabled = t === "dueboe"; $("all-distanza").disabled = t === "partenza"; $("all-giri").disabled = t === "partenza" || t === "bolina";
  $("all-nota").textContent = (Number.isFinite(w) ? "Vento tarato: " + angolo(w) + ". " : "Vento non tarato: scrivi da dove viene. ") +
    {partenza: "Linea perpendicolare al vento, con il centro sulla barca.", bolina: "Linea con il centro sulla barca e boa 1 sopravvento; arrivo sulla linea.",
     bastone: "Linea con il centro sulla barca, boa 1 sopravvento e boa 2 cinquanta metri sotto la linea; arrivo sulla linea.",
     dueboe: "Boa 1 sopravvento e boa 2 dove si trova la barca."}[t];
}
function creaAllenamento() {
  const vento = Number($("all-vento").value), lunghezza = Number($("all-linea").value), distanza = Number($("all-distanza").value), giri = Number($("all-giri").value);
  if ($("all-vento").value === "" || !(vento >= 0 && vento <= 360)) { avvisa("Scrivi da dove viene il vento, da 0 a 359 gradi."); return; }
  if (!(lunghezza >= 20 && lunghezza <= 1000)) { avvisa("Linea di partenza tra 20 e 1000 metri."); return; }
  if (!(distanza >= 50 && distanza <= 5000)) { avvisa("Boa di bolina tra 50 e 5000 metri."); return; }
  const centro = fixVivo() ? {lat: st.fix.lat, lon: st.fix.lon} : null;
  if (!centro) { avvisa("Serve il GPS attivo: il campo si costruisce intorno alla barca."); return; }
  const c = campoAllenamento(st.tipoAllenamento, {centro, vento, lunghezza, distanza, giri});
  const conPosizioni = s.boe.filter(b => b.pos && b.pos.fonte !== "istruzioni" && b.pos.fonte !== "disegnata").map(b => b.codice);
  if (!confirm("Sostituire il campo «" + s.campo.nome + "» con «" + c.nome + "»?" + (conPosizioni.length ? " Si perdono le posizioni GPS di " + conPosizioni.join(", ") + "." : ""))) return;
  s.campo = {nome: c.nome, modello: "allenamento", sequenza: c.sequenza};
  s.boe = c.boe; s.tappa = 0;
  s.arrivo = {ugualePartenza: true, etichette: ["Battello CdR", "Boa di partenza"], estremi: {a: null, b: null}, taglio: null};
  evento("Campo d'allenamento: " + c.nome + " · " + c.sequenza);
  $("allenamento").open = false;
  avvisa("Campo d'allenamento creato: " + c.sequenza + ". Puoi spostare le boe con «Disegna sulla mappa».");
  modificato(); mostraVista("vista-nav"); inquadraTutto();
}

// ---------------- Modalità e preparazione guidata (v0.7) ----------------
const NOMI_MODO = {navigazione: "Navigazione", allenamento: "Allenamento", regata: "Regata", polari: "Polari"};
const SCHEDE = {
  navigazione: [["vista-nav", "Strumenti"], ["vista-guida", "Preparazione"]],
  allenamento: [["vista-nav", "Strumenti"], ["vista-guida", "Preparazione"], ["vista-regata", "Campo"]],
  regata: [["vista-nav", "Strumenti"], ["vista-guida", "Preparazione"], ["vista-regata", "Regata"]],
  polari: [["vista-nav", "Strumenti"], ["vista-guida", "Preparazione"], ["vista-polari", "Polari"]]
};
function disegnaSchede() {
  $("btn-reset").hidden = !st.modo;
  const nav = $("schede"), voci = st.modo ? [...SCHEDE[st.modo], ["menu", "Menu"]] : st.vista === "vista-altro" ? [["menu", "Menu"]] : [];
  nav.hidden = !voci.length;
  nav.style.setProperty("--n", String(voci.length || 1));
  html("schede", voci.map(([v, t]) => '<button type="button" data-vista="' + v + '"' + (v === st.vista ? ' aria-current="page"' : "") + ">" + t + "</button>").join(""));
}
function vaiAllaHome() {
  if (st.disegno) fineDisegno();
  st.modo = null; mostraVista("vista-home");
}
async function entraModo(m) {
  st.modo = m; st.ultimaRichiesta = Date.now(); st.andaturaAperta = false;
  if (s.preferenze.schermoIntero && puoIntero()) schermoIntero(true);
  if (!gpsAttivo() && st.fase !== "errore") avviaGps();
  // Entrando in una modalità lo schermo resta acceso da solo (si spegne in «File, registro e impostazioni»).
  if ("wakeLock" in navigator && !st.wakeLock) { st.vuoleSchermo = true; chiediSchermo(); }
  evento("Modalità " + NOMI_MODO[m]);
  mostraVista("vista-guida");
}
function disegnaHome() {
  const g = !gpsAttivo() ? "GPS spento" : st.fix ? "GPS acceso, ±" + Math.round(st.fix.accuracy ?? 0) + " m" : "GPS in ricerca…";
  $("home-stato").textContent = g + " · versione " + VERSIONE + (st.problema ? " · " + st.problema : "");
}

// Passi della preparazione: titolo, spiegazione, stato, fatto sì/no, pulsanti [azione, testo, principale?].
// Il GPS compare tra i passi solo se c'è un problema (spento o permesso negato).
const passiGps = () => gpsAttivo() && st.fase !== "errore" ? [] : [passoGps()];
const passoGps = () => ({titolo: "GPS", testo: "Il GPS non è attivo.",
  fatto: fixVivo(), stato: fixVivo() ? "Posizione ricevuta." : gpsAttivo() ? "Ricerca della posizione…" : st.problema || "GPS spento.",
  azioni: gpsAttivo() ? [] : [["gps", "Accendi il GPS", true]]});
const passoSchermo = () => ({titolo: "Schermo sempre acceso", testo: "Resta acceso da solo. Tieni il telefono in carica.",
  fatto: !!st.wakeLock, stato: st.wakeLock ? "Lo schermo resta acceso." : "Lo schermo può spegnersi.", azioni: st.wakeLock ? [] : [["schermo", "Tieni acceso lo schermo", true]]});
function passoVento(perche, conAndatura = true) {
  const t = tar(), ok = t.dir !== null;
  return {titolo: "Direzione del vento", testo: perche + " A motore: prua al vento, rotta costante 10 secondi, poi premi." + (conAndatura ? " A vela: dichiara l'andatura." : ""),
    fatto: ok, stato: t.dir === null ? "Vento non tarato." : "Vento da " + angolo(t.dir) + ", " + fonteVento(t) + (t.t ? " " + etaTesto(Date.now() - t.t) : "") +
      (t.misurato ? " · angolo di virata " + Math.round(t.angoloVirata) + "°." : "."),
    azioni: [["motore", t.dir === null ? "Prua al vento a motore: memorizza" : "Ritara: prua al vento a motore", t.dir === null], ...(conAndatura ? [["andatura", "Dichiara l'andatura"]] : [])]};
}
const passoTimer = testo => ({titolo: "Timer di partenza", facoltativo: true, testo,
  fatto: Number.isFinite(s.timer.zero), stato: !Number.isFinite(s.timer.zero) ? "Timer fermo." : s.timer.zero > Date.now() ? "Timer avviato." : "Partiti.",
  azioni: [["timer", "Apri il timer", true]]});
function primaBoa() { const t = tappe(s.campo.sequenza).find(x => x.tipo === "boa"); return t ? trovaBoa(s.boe, t.codice) : null; }
function passiModo(m) {
  if (m === "navigazione") return [...passiGps(),
    passoVento("Serve per vento e andatura.")];
  if (m === "allenamento") {
    const campo = s.campo.modello === "allenamento" && s.boe.some(b => b.pos);
    return [...passiGps(),
      passoVento("Orienta le boe sul vento."),
      {titolo: "Boe", facoltativo: true, testo: "Campi pronti intorno alla barca, orientati sul vento (linea 100 m, bolina 400 m), oppure disegnati.",
        fatto: campo, stato: campo ? s.campo.nome + " · " + s.campo.sequenza : "Nessun campo d'allenamento.",
        azioni: [["campo:partenza", "Solo partenza"], ["campo:bolina", "Partenza e bolina"], ["campo:bastone", "Bastone"], ["campo:dueboe", "Due boe"], ["disegna", "Le disegno io"]]},
      passoTimer("Da −5:00, beep a ogni minuto e raffica allo zero. Con la linea: distanza e anticipo.")];
  }
  if (m === "regata") {
    const lp = lineaPartenza(s.boe), b = primaBoa();
    const cdr = trovaBoa(s.boe, "CdR")?.pos?.fonte === "gps", p = trovaBoa(s.boe, "P")?.pos?.fonte === "gps";
    return [...passiGps(),
      {titolo: "Percorso", testo: "Dalle istruzioni di regata o disegnato.",
        fatto: true, stato: s.campo.nome + " · " + s.campo.sequenza, azioni: [["vai:vista-regata:configura", "Scegli il percorso"], ["disegna", "Disegna sulla mappa"]]},
      {titolo: "Linea di partenza", testo: "Passa vicino a comitato e pin e segnali, oppure disegnali.",
        fatto: !!lp, stato: lp ? "Linea segnata" + (cdr && p ? " col GPS." : " (in parte virtuale o stimata).") : "Linea non segnata.",
        azioni: [["segna:CdR", cdr ? "Aggiorna comitato" : "Segna comitato"], ["segna:P", p ? "Aggiorna pin" : "Segna pin"], ["disegna", "Disegna sulla mappa"]]},
      ...(b ? [{titolo: "Boa " + b.codice + " · " + b.nome, testo: "Vicino: Segna GPS. Lontano: Rileva, due volte da punti diversi.",
        fatto: !!b.pos, stato: b.pos ? statoBoa(b).testo : "Posizione ignota.", azioni: [["segna:" + b.codice, b.pos?.fonte === "gps" ? "Aggiorna GPS" : "Segna GPS"], ["rileva:" + b.codice, "Rileva"]]}] : []),
      passoVento("Serve per salti, lay-line e linea. Falla poco prima della partenza."),
      passoTimer("Avvia al segnale dei 5 minuti, poi Sincronizza a ogni segnale.")];
  }
  if (m === "polari") {
    const t = tar(), lim = pol.imp.validitaMin * 60000, adesso = Date.now();
    const dirOk = t.dir !== null && t.fonte !== "andatura" && (!t.t || adesso - t.t <= lim), twsOk = pol.vento && adesso - pol.vento.t <= lim;
    return [...passiGps(),
      {...passoVento("Ritarala almeno ogni " + pol.imp.validitaMin + " minuti.", false), fatto: dirOk},
      {titolo: "Intensità del vento", testo: "A barca ferma, dall'anemometro di coperta.",
        fatto: !!twsOk, stato: pol.vento ? numero(pol.vento.tws, 1) + " nodi, " + etaTesto(adesso - pol.vento.t) + (twsOk ? "." : ": da aggiornare.") : "Non inserita.",
        azioni: [["vai:vista-polari:pol-tws", "Inserisci il vento", !twsOk]]},
      {titolo: "Vele a riva", testo: "Le polari si separano per vele.", fatto: true, stato: nomeVele(chiaveVele(pol.vele)) + ".",
        azioni: [["vai:vista-polari:pol-prua", "Cambia vele"]]},
      {titolo: "Registrazione", testo: "Un angolo alla volta, un minuto per mura, su entrambe le mure.",
        fatto: st.polRegistra, stato: st.polRegistra ? "Registrazione attiva." : "Registrazione ferma.", azioni: [["registra", st.polRegistra ? "Stop registrazione" : "Avvia la registrazione", !st.polRegistra]]}];
  }
  return [];
}
const INTRO = {
  navigazione: "Basta il GPS; per vento e andatura serve la taratura o l'andatura dichiarata.",
  allenamento: "Prepara solo quello che serve: i passi facoltativi si saltano.",
  regata: "Segui i passi nell'ordine, sul campo di regata.",
  polari: "Servono vento aggiornato e vele a riva."
};
function disegnaGuida() {
  if (!st.modo) return;
  $("guida-titolo").textContent = "PREPARAZIONE · " + NOMI_MODO[st.modo].toUpperCase();
  $("guida-intro").textContent = INTRO[st.modo];
  html("guida-passi", passiModo(st.modo).map((p, i) => '<li class="passo' + (p.fatto ? " fatto" : "") + '"><div class="passo-testa"><i>' + (p.fatto ? "✓" : i + 1) + "</i><strong>" + esc(p.titolo) + "</strong>" +
    (p.facoltativo ? "<small>facoltativo</small>" : "") + "</div><p>" + esc(p.testo) + '</p><p class="passo-stato">' + esc(p.stato) + "</p>" +
    (p.azioni.length ? '<div class="passo-azioni">' + p.azioni.map(([a, t, pr]) => '<button type="button" data-guida="' + esc(a) + '"' + (pr ? ' class="principale"' : "") + ">" + esc(t) + "</button>").join("") + "</div>" : "") + "</li>").join(""));
}
function azioneGuida(cmd) {
  const [a, x, y] = cmd.split(":");
  if (a === "gps") { if (!gpsAttivo()) avviaGps(); }
  else if (a === "schermo") { if (!("wakeLock" in navigator)) avvisa("Questo browser non permette di tenere lo schermo acceso."); else { st.vuoleSchermo = true; chiediSchermo().then(aggiorna); } }
  else if (a === "motore") taraMotore();
  else if (a === "andatura") { mostraVista("vista-nav"); apriAndatura(); }
  else if (a === "dritta" || a === "sinistra") taraBolina(a);
  else if (a === "campo") {
    st.tipoAllenamento = x;
    const sv = statoVento(), w = Number.isFinite(sv.medio) ? sv.medio : sv.tar.dir;
    if (!Number.isFinite(w)) { avvisa("Prima tara la direzione del vento (passo 3), oppure scrivila nella scheda «Campo» → Campo d'allenamento."); return; }
    $("all-vento").value = String(Math.round(w));
    creaAllenamento();
  }
  else if (a === "disegna") avviaDisegno();
  else if (a === "timer") { st.cronoAperto = true; st.cronoModo = "timer"; mostraVista("vista-nav"); }
  else if (a === "segna") segnaBoa(x);
  else if (a === "rileva") apriRilievo(x);
  else if (a === "registra") registraPolari();
  else if (a === "vai") {
    mostraVista(x);
    const el = $(y); if (!el) return;
    if (el.tagName === "DETAILS") el.open = true;
    setTimeout(() => el.scrollIntoView({block: "center"}), 50);
  }
  aggiorna();
}

// ---------------- Spiegazione delle modalità (v0.8) ----------------
const SPIEGAZIONE = {
  navigazione: {sintesi: "Strumentazione di bordo: rotta, velocità, vento medio e andatura.", lista: [
    "Rotta e velocità dal GPS.",
    "Vento: prua al vento a motore, oppure dichiara l'andatura.",
    "Se il vento gira, dichiara la nuova andatura.",
    "Timer e cronometro."]},
  allenamento: {sintesi: "Esercizi con boe, prove di partenza con timer e cronometro.", lista: [
    "Boe: campi pronti o disegnati sulla mappa (comitato, pin, boe).",
    "Timer di partenza con distanza e tempo dalla linea.",
    "Cronometro con tempi parziali."]},
  regata: {sintesi: "Strumentazione per la regata: campo, linea di partenza, salti di vento, buoni e scarsi.", lista: [
    "Percorso dalle istruzioni (Loano, Alassio) o disegnato.",
    "Linea: estremo favorito, distanza e tempo con il timer.",
    "Bolina stretta: buono, scarso e allarme.",
    "Mure favorite, lay-line, arrivo."]},
  polari: {sintesi: "Misura delle velocità della barca a ogni angolo dal vento.", lista: [
    "Vento: prua al vento a motore; intensità a barca ferma.",
    "Vele a riva.",
    "Polare, angoli migliori e % della polare."]}
};
function mostraIntro(m) {
  st.modoProposto = m;
  $("intro-titolo").textContent = NOMI_MODO[m].toUpperCase();
  $("intro-sintesi").textContent = SPIEGAZIONE[m].sintesi;
  $("intro-lista").innerHTML = SPIEGAZIONE[m].lista.map(x => "<li>" + esc(x) + "</li>").join("");
  mostraVista("vista-intro");
}

// ---------------- Andatura dichiarata (v0.8) ----------------
// L'equipaggio dichiara andatura e mure; con la rotta l'app ricava da dove viene il vento.
// Bolina stretta: partono le stime continue dei salti. Le altre andature: il vento di riferimento si aggiorna
// se si scosta di più di 10° da quello che l'app stava usando (altrimenti resta quello, più preciso).
function apriAndatura() {
  st.andaturaAperta = true; $("richiesta-andatura").hidden = true; disegnaAndatura();
}
function disegnaAndatura() {
  const p = $("pannello-andatura");
  p.hidden = !st.andaturaAperta;
  if (!st.andaturaAperta) return;
  const nav = smoothNav(st.fixes), sv = statoVento(), W = Number.isFinite(sv.medio) ? sv.medio : sv.tar.dir;
  const att = fixVivo() && nav.cog !== null && Number.isFinite(W) ? andatura(nav.cog, W) : null;
  $("andatura-info").textContent = (fixVivo() && nav.cog !== null ? "Rotta " + angolo(nav.cog) : "Rotta non disponibile") + (att ? " · per l'app: " + att.nome.toLowerCase() + ", mure a " + att.mura : "") + ".";
  html("griglia-andature", '<span class="intestazione">Mure a sinistra</span><span class="intestazione">Mure a dritta</span>' +
    ANDATURE.map(n => ["sinistra", "dritta"].map(m => '<button type="button" data-andatura="' + n + '|' + m + '"' + (att && att.nome === n && att.mura === m ? ' class="attuale"' : "") + ">" + n + "</button>").join("")).join(""));
}
function dichiaraAndatura(nome, mura) {
  // Le andature sono larghe una trentina di gradi: basta una rotta stabile entro ±15° (con l'onda la rotta GPS balla).
  const c = rottaPerTaratura(nome === "Bolina stretta" ? 8 : 15); if (c === null) return;
  const adesso = Date.now(), t = tar(), sv = statoVento(adesso);
  const angoloBolina = Number.isFinite(t.off?.[mura]) ? Math.abs(t.off[mura]) : (s.barca.angoloVirata || 90) / 2;
  const nuovo = ventoDaAndatura(c, nome, mura, angoloBolina);
  const prima = Number.isFinite(sv.medio) ? sv.medio : t.dir;
  s.vento.andatura = {nome, mura, t: adesso, cog: Math.round(c)};
  st.ultimaRichiesta = adesso; st.andaturaAperta = false;
  let msg;
  if (prima === null || Math.abs(delta(nuovo, prima)) > 10) {
    s.vento.iniziale = {dir: Math.round(nuovo), metodo: "andatura", andatura: nome, t: adesso};
    s.vento.campioni = []; s.vento.rotazione = null; st.allScarso = null;
    msg = "Vento aggiornato: da " + angolo(nuovo) + (prima === null ? "" : " (prima " + angolo(prima) + ")") + ".";
  } else msg = "Andatura confermata: il vento resta da " + angolo(prima) + ".";
  if (nome === "Bolina stretta") { s.vento.bolina = true; st.poggiataDa = null; msg += " In bolina stretta l'app stima i salti di vento."; }
  else s.vento.bolina = false;
  evento("Andatura dichiarata: " + nome.toLowerCase() + ", mure a " + mura + " · rotta " + angolo(c) + " · " + msg);
  avvisa(msg); salvaPresto(); disegnaAndatura(); aggiorna();
}
// Richiesta periodica di conferma dell'andatura.
function controllaRichiesta(adesso) {
  const r = $("richiesta-andatura"), min = s.vento.imp.promemoriaMin || 0;
  const nav = smoothNav(st.fixes);
  const possibile = st.vista === "vista-nav" && ["navigazione", "allenamento", "regata"].includes(st.modo) && min > 0 && fixVivo() &&
    nav.sog !== null && nav.sog >= 1.5 && !s.vento.bolina && !st.disegno && !st.andaturaAperta && !st.cronoAperto &&
    !(Number.isFinite(s.timer.zero) && adesso > s.timer.zero - 6 * 60000 && adesso < s.timer.zero + 2 * 60000); // niente richieste durante la partenza
  if (!possibile) { if (!st.andaturaAperta) r.hidden = true; return; }
  if (!st.ultimaRichiesta) st.ultimaRichiesta = adesso;
  const sv = statoVento(adesso), W = Number.isFinite(sv.medio) ? sv.medio : sv.tar.dir, a = Number.isFinite(W) && nav.cog !== null ? andatura(nav.cog, W) : null;
  // Cambio di andatura (giro di boa, poggiata, orzata) stabile da 20 secondi: si chiede subito, senza aspettare i minuti.
  const chiave = a ? a.nome + "|" + a.mura : "";
  if (!st.andaturaCalcolata || st.andaturaCalcolata.chiave !== chiave) st.andaturaCalcolata = {chiave, da: adesso};
  const ultima = s.vento.andatura ? s.vento.andatura.nome + "|" + s.vento.andatura.mura : null;
  const cambiata = a && ultima && chiave !== ultima && adesso - st.andaturaCalcolata.da >= 20000;
  if (r.hidden && !cambiata && adesso - st.ultimaRichiesta < min * 60000) return;
  if (r.hidden) { try { navigator.vibrate?.([120]); } catch {} }
  r.hidden = false;
  r.dataset.andatura = a ? a.nome + "|" + a.mura : "";
  $("richiesta-testo").textContent = a ? "Andatura: " + a.nome.toLowerCase() + ", mure a " + a.mura + "?" : "Che andatura stai tenendo?";
  $("richiesta-giusta").hidden = !a;
  $("richiesta-cambia").textContent = a ? "Cambia" : "Dichiara";
}

// ---------------- Reset (v0.9) ----------------
// Prima di ogni reset si tiene una copia, per «Annulla l'ultimo reset».
const CHIAVE_COPIA = "rr-regatta-prima-del-reset";
function copiaPrimaDelReset() {
  try { memoria.setItem(CHIAVE_COPIA, JSON.stringify({t: Date.now(), sessione: s, ventoPolari: pol.vento})); } catch {}
}
function leggiCopia() { try { const c = JSON.parse(memoria.getItem(CHIAVE_COPIA) || "null"); return c?.sessione ? c : null; } catch { return null; } }
function annullaReset() {
  const c = leggiCopia(); if (!c) return;
  if (!confirm("Tornare a com'era prima del reset delle " + ora(c.t) + "?")) return;
  try { s = verifica(c.sessione); } catch (err) { avvisa("Copia non valida: " + err.message + "."); return; }
  pol.vento = c.ventoPolari ?? pol.vento; salvaPolari(true);
  memoria.removeItem(CHIAVE_COPIA); azzeraStato();
  evento("Annullato il reset delle " + ora(c.t)); avvisa("Reset annullato."); modificato();
}
function azzeraStato() {
  st.allScarso = null; st.mura = null; st.poggiataDa = null; st.ultimaVirata = 0; st.stima = null; st.bs = null;
  st.cronoAperto = false; st.andaturaAperta = false; st.ultimaRichiesta = Date.now(); st.ultimoTick = Date.now();
  if (st.disegno) { st.disegno = null; st.selezionata = null; disegnaBarra(); }
}
const COSA_RESET = {
  navigazione: "Si cancellano vento, andatura, timer e cronometro.",
  allenamento: "Si cancellano vento, andatura, boe d'allenamento, timer e cronometro.",
  regata: "Si cancellano vento, boe segnate o rilevate, arrivo, timer e cronometro. Restano il percorso e le posizioni delle istruzioni.",
  polari: "Si cancellano vento e intensità inseriti e si ferma la registrazione. I punti delle polari restano."
};
function resetModo(m) {
  if (!confirm("Reset di " + NOMI_MODO[m] + "?\n\n" + COSA_RESET[m])) return;
  copiaPrimaDelReset();
  s.vento = nuovoVento(s.vento.imp);
  s.timer = nuovoTimer(s.timer.ultimi10); s.cronometro = nuovoCrono();
  if (m === "allenamento" || m === "regata") {
    if (s.campo.modello === "allenamento") { s.boe = []; s.campo = {...s.campo, sequenza: ""}; }
    else s.boe = s.boe.map(b => ({...b, pos: b.pos?.fonte === "istruzioni" ? b.pos : null, storico: [], osservazioni: []}));
    s.tappa = 0; s.arrivo = {...s.arrivo, estremi: {a: null, b: null}, taglio: null};
  }
  if (m === "polari") { st.polRegistra = false; st.polValuta = null; pol.vento = null; salvaPolari(true); }
  azzeraStato();
  evento("Reset " + NOMI_MODO[m]); avvisa("Reset fatto."); modificato();
}

// ---------------- Schermo intero e solo verticale (v0.9) ----------------
const puoIntero = () => !!document.documentElement.requestFullscreen;
async function schermoIntero(attiva) {
  try {
    if (attiva && !document.fullscreenElement) await document.documentElement.requestFullscreen({navigationUI: "hide"});
    if (!attiva && document.fullscreenElement) await document.exitFullscreen();
  } catch {}
  try { if (document.fullscreenElement) await screen.orientation?.lock?.("portrait"); } catch {}
  disegnaIntero();
}
function disegnaIntero() {
  const dentro = !!document.fullscreenElement;
  $("btn-intero").hidden = !puoIntero() || dentro;
  const b = $("imp-intero");
  b.setAttribute("aria-pressed", String(!!s.preferenze.schermoIntero));
  b.textContent = "Schermo intero: " + (s.preferenze.schermoIntero ? "sì" : "no");
}
document.addEventListener("fullscreenchange", disegnaIntero);

// Un solo riquadro sulla mappa alla volta: premendo un altro pulsante, timer e andatura si chiudono da soli.
document.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (st.andaturaAperta && !b.closest("#pannello-andatura") && b.id !== "btn-andatura") { st.andaturaAperta = false; disegnaAndatura(); }
  if (st.cronoAperto && !b.closest("#crono") && b.id !== "btn-crono" && b.id !== "crono-pillola") { st.cronoAperto = false; disegnaCrono(); }
}, true);

// ---------------- Azioni di regata ----------------
const puntoGps = () => ({lat: st.fix.lat, lon: st.fix.lon, acc: Number.isFinite(st.fix.accuracy) ? Math.round(st.fix.accuracy) : null, t: Date.now(), fonte: "gps"});

function segnaBoa(codice) {
  const b = trovaBoa(s.boe, codice);
  if (!b) return;
  if (!fixVivo()) { avvisa("Serve un punto GPS recente: avvia il GPS e attendi la posizione."); return; }
  const prima = b.pos, p = puntoGps();
  b.storico.push(p); b.pos = p;
  const scarto = prima ? Math.round(distanceMeters(prima, p)) : null;
  let testo = b.codice + ": posizione GPS registrata (±" + p.acc + " m).";
  if (prima?.fonte === "gps") testo = b.codice + ": posizione aggiornata, " + scarto + " m dalla precedente.";
  else if (prima) testo = b.codice + ": posizione GPS registrata; la stima precedente era a " + scarto + " m.";
  if (p.acc > 20) testo += " Precisione scarsa: ripeti più tardi se puoi.";
  evento("Segna GPS " + b.codice + " (±" + p.acc + " m)");
  avvisa(testo); modificato();
}
function apriRilievo(codice) {
  st.rilievo.codice = codice;
  mostraVista("vista-regata");
  $("blocco-rilievo").hidden = false;
  $("ril-codice").textContent = codice;
  disegnaRilievo();
  $("blocco-rilievo").scrollIntoView({block: "start"});
}
function registraRilievo() {
  const b = trovaBoa(s.boe, st.rilievo.codice), nav = smoothNav(st.fixes), gradi = Number($("ril-angolo").value);
  if (!b) return;
  if (!fixVivo() || nav.cog === null || nav.sog < 1) { avvisa("Serve una rotta stabile: naviga ad almeno 1 nodo con il GPS attivo."); return; }
  if (!Number.isFinite(gradi) || gradi < 0 || gradi > 180) { avvisa("Inserisci un angolo fra 0 e 180 gradi."); return; }
  const relativo = st.rilievo.lato * gradi;
  const oss = {lat: st.fix.lat, lon: st.fix.lon, acc: st.fix.accuracy, t: Date.now(), cog: Math.round(nav.cog), relativo, rilevamento: norm(nav.cog + relativo)};
  b.osservazioni.push(oss);
  if (b.osservazioni.length > 12) b.osservazioni.shift();
  let testo = "Rilevamento " + b.codice + ": " + angolo(oss.rilevamento) + ". ";
  if (!b.pos || b.pos.fonte === "triangolazione") {
    const t = triangola(b.osservazioni);
    if (t) { b.pos = t; testo += "Posizione stimata dall'incrocio dei rilevamenti."; }
    else testo += b.osservazioni.length === 1 ? "Ora c'è la direzione. Più avanti, da un altro punto, fai un secondo rilevamento." : "Rilevamenti troppo simili per incrociarli: allontanati di più prima del prossimo.";
  }
  evento("Rilevamento " + b.codice + " " + (relativo < 0 ? gradi + "° a sinistra" : gradi + "° a dritta") + " → " + angolo(oss.rilevamento));
  $("blocco-rilievo").hidden = true; st.rilievo.codice = null;
  avvisa(testo); modificato();
}
function boaPassata() {
  const lista = tappe(s.campo.sequenza), t = lista[s.tappa];
  if (!t) return;
  evento((t.tipo === "cancello" ? "Cancello" : "Passata " + t.codice) + (t.opzionale ? " (eventuale)" : ""));
  s.tappa++;
  const prossima = lista[s.tappa];
  avvisa(prossima ? "Prossima: " + (prossima.tipo === "arrivo" ? "arrivo" : prossima.tipo === "cancello" ? "cancello" : "boa " + prossima.codice) : "Percorso completato.");
  modificato();
}
function tagliaTraguardo() {
  if (s.arrivo.taglio) return;
  const adesso = Date.now(), f = st.fix;
  s.arrivo.taglio = {t: adesso, lat: f?.lat ?? null, lon: f?.lon ?? null, acc: f?.accuracy ?? null, etaFix: f ? adesso - f.received : null};
  s.tappa = tappe(s.campo.sequenza).length;
  evento("ARRIVO " + ora(adesso) + (f ? "" : " (senza posizione GPS)"));
  avvisa("Traguardo registrato alle " + ora(adesso) + ".");
  modificato();
}
function annullaArrivo() {
  if (!s.arrivo.taglio || !confirm("Annullare l'arrivo registrato? La regata torna in corso.")) return;
  s.arrivo.taglio = null;
  const lista = tappe(s.campo.sequenza);
  const iArrivo = lista.map(t => t.tipo).lastIndexOf("arrivo");
  s.tappa = iArrivo >= 0 ? iArrivo : Math.max(0, lista.length - 1);
  evento("Arrivo annullato"); modificato();
}
function segnaEstremo(qual) {
  if (!fixVivo()) { avvisa("Serve un punto GPS recente: avvia il GPS e attendi la posizione."); return; }
  const altro = s.arrivo.estremi[qual === "a" ? "b" : "a"], p = puntoGps();
  if (altro && distanceMeters(altro, p) < 10) { avvisa("I due estremi devono essere distinti: spostati di almeno 10 metri."); return; }
  s.arrivo.estremi[qual] = p;
  evento("Estremo d'arrivo " + (qual === "a" ? 1 : 2) + " (±" + p.acc + " m)");
  avvisa("Estremo " + (qual === "a" ? 1 : 2) + " della linea d'arrivo registrato."); modificato();
}

// ---------------- Schermo sempre acceso ----------------
async function chiediSchermo() {
  try { st.wakeLock = await navigator.wakeLock.request("screen"); st.wakeLock.addEventListener("release", () => { st.wakeLock = null; disegnaAltro(); }); }
  catch { st.wakeLock = null; }
  disegnaAltro();
}
async function cambiaSchermo() {
  if (!("wakeLock" in navigator)) { avvisa("Questo browser non permette di tenere lo schermo acceso."); return; }
  st.vuoleSchermo = !st.vuoleSchermo;
  if (st.vuoleSchermo) await chiediSchermo();
  else { try { await st.wakeLock?.release(); } catch {} st.wakeLock = null; disegnaAltro(); }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && st.vuoleSchermo && !st.wakeLock) chiediSchermo();
  aggiorna();
});

// ---------------- Disegno: parte che cambia ogni secondo ----------------
// Ridisegno raggruppato con un timer: a differenza di requestAnimationFrame non si ferma mai,
// anche se il browser considera la pagina in secondo piano.
function aggiorna() { if (!aggiorna.attesa) { aggiorna.attesa = true; setTimeout(() => { aggiorna.attesa = false; disegnaNav(); if (st.vista === "vista-polari") disegnaPolariVivo(); if (st.vista === "vista-guida") disegnaGuida(); if (st.vista === "vista-home") disegnaHome(); }, 30); } }

function descriviFonte(ob) {
  switch (ob.fonte) {
    case "gps": return "posizione GPS ±" + (ob.pos.acc ?? "?") + " m";
    case "triangolazione": return "posizione stimata da due rilevamenti";
    case "istruzioni": return "posizione indicativa dalle istruzioni";
    case "disegnata": return "boa virtuale";
    case "linea": return "centro della linea";
    case "estremo": return "un solo estremo della linea";
    case "rilevamento": return "solo direzione · rilevamento a " + Math.round(ob.spostamento) + " m da qui";
    default: return ob.motivo + (ob.tappa?.tipo === "boa" ? " · usa «Rileva»" : "");
  }
}

function disegnaNav() {
  const adesso = Date.now(), attivo = gpsAttivo();
  const eta = st.fix ? adesso - st.fix.received : NaN, dato = st.fix ? statoDato(eta) : "assente", sec = Math.floor(eta / 1000);

  const pill = $("stato-gps");
  let classe = "", testo = "GPS fermo";
  if (st.fase === "errore") { classe = "problema"; testo = "GPS non disponibile"; }
  else if (attivo && !st.fix) { classe = "cerca"; testo = "Ricerca GPS… " + Math.floor((adesso - st.avviatoIl) / 1000) + " s"; }
  else if (attivo && dato === "vivo") { classe = "vivo"; testo = "GPS ±" + Math.round(st.fix.accuracy ?? 0) + " m"; }
  else if (attivo) { classe = "problema"; testo = "Nessun punto da " + sec + " s"; }
  pill.className = "stato-gps " + classe;
  $("stato-gps-testo").textContent = testo;

  const nav = smoothNav(st.fixes);
  const mostra = attivo && (dato === "vivo" || dato === "vecchio"), vecchio = attivo && dato === "vecchio";
  $("sog").textContent = mostra && nav.sog !== null ? numero(nav.sog, 1) : "—";
  $("cog").textContent = mostra && nav.cog !== null ? angolo(nav.cog) : "—";
  const nota = !attivo ? "GPS fermo" : !st.fix ? "in attesa del GPS" : dato === "vecchio" ? "dato vecchio · " + sec + " s" : dato === "perso" ? "segnale perso" : null;
  const fonte = st.fix?.fonte || {};
  $("nota-sog").textContent = nota ?? (nav.sog === null ? "in calcolo…" : fonte.sog === "telefono" ? "dal telefono" : "calcolata");
  $("nota-cog").textContent = nota ?? (nav.cog === null ? "barca ferma" : fonte.cog === "telefono" ? "dal telefono" : "calcolata");
  $("cella-sog").classList.toggle("vecchio", vecchio);
  $("cella-cog").classList.toggle("vecchio", vecchio);

  // Modalità: la striscia verso la boa solo in allenamento e regata; l'andatura in navigazione e polari.
  const modo = st.modo, corsa = modo === "allenamento" || modo === "regata";
  $("vista-nav").dataset.modo = modo || "";
  $("striscia-boa").hidden = !corsa;
  $("striscia-polari").hidden = modo !== "polari";
  $("cella-andatura").hidden = !(modo === "navigazione" || modo === "polari");

  // Prossima boa
  const lista = tappe(s.campo.sequenza), barca = mostra ? st.fix : null;
  const ob = obiettivo(s, s.tappa, barca, adesso);
  const rlv = ob.pos && barca ? bearing(barca, ob.pos) : ob.rilevamento ?? null;
  const dist = ob.pos && barca ? distanceMeters(barca, ob.pos) : NaN;
  const vmc = mostra && nav.cog !== null && rlv !== null ? markVMC(nav.sog, nav.cog, rlv) : null;
  $("pr-codice").textContent = s.arrivo.taglio || !ob.tappa ? "✓" : ob.tappa.tipo === "arrivo" ? "F" : ob.tappa.codice;
  $("pr-nome").textContent = s.arrivo.taglio ? "Arrivo registrato" : ob.nome + (ob.tappa?.opzionale ? " · eventuale" : "");
  $("pr-rlv").textContent = rlv === null ? "—" : (ob.pos ? "" : "~") + angolo(rlv);
  $("pr-dist").textContent = ob.pos && barca ? distanzaTesto(dist) : "—";
  $("pr-vmc").textContent = vmc === null ? "—" : numero(vmc, 1) + " kn";
  $("pr-nota").textContent = s.arrivo.taglio ? "Arrivo alle " + ora(s.arrivo.taglio.t)
    : !ob.tappa ? "Percorso completato" : "Tappa " + (s.tappa + 1) + " di " + lista.length + " · " + descriviFonte(ob);
  const boaTappa = !s.arrivo.taglio && ob.tappa?.tipo === "boa" && ob.boa;
  const ps = $("pr-segna"), pr = $("pr-rileva");
  ps.hidden = !boaTappa || ob.pos?.fonte === "disegnata"; // la boa virtuale non si segna col GPS
  ps.textContent = ob.pos?.fonte === "gps" ? "Aggiorna" : "Segna GPS";
  ps.dataset.codice = pr.dataset.codice = boaTappa ? ob.boa.codice : "";
  pr.hidden = !boaTappa || !!ob.pos; // la boa con posizione nota non ha bisogno di rilevamenti

  // Vento stimato e salto
  const sv = statoVento(adesso), W = sv.medio, off = sv.tar.off;
  $("vento").textContent = Number.isFinite(W) ? angolo(W) : "—";
  const nv = $("nota-vento"), campiona = mostra && st.stima?.dir != null;
  nv.className = "nota" + (campiona && st.bs?.tipo === "scarso" ? " scarso" : "");
  nv.textContent = !Number.isFinite(W) ? "da tarare"
    : campiona && st.bs ? (st.bs.tipo === "pari" ? "salto 0°" : st.bs.tipo.toUpperCase() + " " + Math.round(st.bs.gradi) + "°")
    : sv.nMedia ? "media " + s.vento.imp.mediaMin + " min" : fonteVento(sv.tar);

  // Tattica: lato favorito della linea, bordo favorevole, lay-line
  const tattica = []; let forte = false;
  if (s.tappa === 0 && !s.arrivo.taglio && Number.isFinite(W)) {
    const lp = lineaPartenza(s.boe), lf = lp && latoFavorito(lp[0], lp[1], W);
    const vicino = lp && barca && distanceMeters(barca, {lat: (lp[0].lat + lp[1].lat) / 2, lon: (lp[0].lon + lp[1].lon) / 2}) < 500;
    if (lf && vicino) tattica.push(lf.favorito === "neutra" ? "Linea neutra" : "Linea: " + (lf.favorito === "P" ? "favorito il pin" : "favorita la barca comitato") + " (+" + Math.round(lf.vantaggio) + " m)");
  }
  if (off && Number.isFinite(W) && rlv !== null && barca && !s.arrivo.taglio) {
    const bf = bordoFavorevole(rlv, W, off);
    if (bf?.mura === null) {
      // Boa fuori dal settore di bolina: o la si raggiunge sulla mura attuale, o si è già oltre la lay-line dell'altra mura.
      const d = delta(rlv, W), oltre = st.mura === "sinistra" ? d < off.dritta : st.mura === "dritta" ? d > off.sinistra : false;
      if (oltre) { tattica.push("Oltre la lay-line: vira e poggia sulla boa"); forte = true; }
      else tattica.push("Boa raggiungibile senza virare");
    }
    else if (bf) {
      let txt = bf.vantaggio < 2 ? "Bordi equivalenti" : "Mure favorite: " + bf.mura + " (+" + Math.round(bf.vantaggio) + "°)";
      if (ob.pos && st.mura) {
        const rotta = rotteDiBolina(W, off)[st.mura];
        const d = distanzaLayline(barca, ob.pos, st.mura, W, off), soglia = Math.max(2 * s.barca.lunghezza, 15);
        if (Math.abs(delta(rlv, rotta)) <= 4) txt = "Sulla lay-line: boa dritta di prua";
        else if (d !== null && Math.abs(d) <= soglia) { txt = "IN LAY-LINE: VIRA"; forte = true; }
        else if (d !== null && d < 0) txt += " · oltre la lay-line di " + distanzaTesto(-d);
        else if (d !== null) txt += " · lay-line a " + distanzaTesto(d);
      }
      tattica.push(txt);
    }
  }
  // Andatura e striscia delle polari
  const Wa = Number.isFinite(W) ? W : sv.tar.dir, and = mostra && nav.cog !== null ? andatura(nav.cog, Wa) : null;
  $("andatura").textContent = and ? and.nome : "—";
  $("nota-andatura").textContent = !Number.isFinite(Wa) ? "vento da tarare" : and ? Math.round(and.angolo) + "° · mure a " + and.mura : nav.cog === null && mostra ? "barca ferma" : "—";
  if (modo === "polari") {
    const classe = classeVento(pol.vento?.tws), punti = classe ? polare(pol, classe, veleAttuali()) : [];
    const twa = and && sv.tar.dir !== null ? delta(nav.cog, sv.tar.dir) : null, vp = twa === null ? null : velocitaPolare(punti, twa);
    $("sp-twa").textContent = twa === null ? "—" : Math.round(Math.abs(twa)) + "°";
    $("sp-pol").textContent = vp ? numero(vp, 1) + " kn" : "—";
    $("sp-perc").textContent = vp && nav.sog !== null ? Math.round(nav.sog / vp * 100) + "%" : "—";
    const val = st.polValuta;
    $("sp-stato").textContent = !st.polRegistra ? "Registrazione ferma · " + nomeVele(chiaveVele(pol.vele)) + (pol.vento ? " · vento " + numero(pol.vento.tws, 1) + " kn" : " · vento da inserire")
      : val?.ok ? "REGISTRO · " + nomeVele(chiaveVele(pol.vele)) + " · vento " + numero(pol.vento.tws, 1) + " kn" : "In pausa: " + (val?.motivo || "in attesa del GPS");
    const br = $("btn-registra");
    br.setAttribute("aria-pressed", String(st.polRegistra)); br.textContent = st.polRegistra ? "Stop registrazione" : "Registra";
  }
  $("btn-registra").hidden = modo !== "polari";

  const pt = $("pr-tattica");
  pt.hidden = !tattica.length; pt.textContent = tattica.join(" · "); pt.classList.toggle("forte", forte);

  // Allarmi
  const al = $("allarme"), rot = s.vento.rotazione;
  if (st.allScarso?.attivo && !st.allScarso.riconosciuto) {
    al.hidden = false; al.className = "allarme"; al.dataset.tipo = "scarso";
    $("allarme-titolo").textContent = "SCARSO " + Math.round(st.allScarso.gradi) + "°";
    $("allarme-testo").textContent = "Scarso da " + Math.round((adesso - st.allScarso.inizio) / 1000) + " secondi: valuta la virata.";
  } else if (rot?.attivo) {
    al.hidden = false; al.className = "allarme rotazione"; al.dataset.tipo = "rotazione";
    $("allarme-titolo").textContent = "VENTO RUOTATO " + (rot.rotazione > 0 ? "+" : "−") + Math.round(Math.abs(rot.rotazione)) + "°";
    $("allarme-testo").textContent = "Il vento medio è girato a " + (rot.rotazione > 0 ? "destra" : "sinistra") + ". Possibile rotazione persistente.";
  } else al.hidden = true;

  // Pulsanti in basso
  const b = $("btn-gps");
  b.textContent = attivo ? "Spegni GPS" : "Accendi GPS";
  b.classList.toggle("attivo", attivo);
  const inRegata = attivo && !s.arrivo.taglio && ob.tappa;
  const ba = $("btn-andatura");
  ba.hidden = !attivo || modo === "polari" || !modo; ba.setAttribute("aria-pressed", String(!!s.vento.bolina));
  ba.textContent = s.vento.bolina ? "BOLINA STRETTA ✓" : s.vento.andatura ? "Andatura: " + s.vento.andatura.nome.toLowerCase() : "Andatura";
  $("btn-disegna-mappa").hidden = !corsa;
  $("segui").hidden = !corsa; $("tutto").hidden = !corsa;
  if (!corsa && !st.disegno) st.segui = true; // senza carta sotto, fuori da campo la mappa segue sempre la barca
  $("btn-disegna-mappa").classList.toggle("attivo", !!st.disegno);
  $("btn-traguardo").hidden = !(corsa && ob.tappa?.tipo === "arrivo" && !s.arrivo.taglio && attivo);
  $("btn-passata").hidden = !(corsa && inRegata && ob.tappa.tipo !== "arrivo");
  if (ob.tappa) $("btn-passata").textContent = ob.tappa.tipo === "cancello" ? "Cancello passato ›" : ob.tappa.opzionale ? ob.tappa.codice + " passata o assente ›" : "Boa " + ob.tappa.codice + " passata ›";
  $("segui").classList.toggle("attivo", st.segui && !!st.fix);

  const msg = $("mappa-messaggio");
  msg.hidden = !!st.fix || !!st.centro;
  msg.classList.toggle("problema", st.fase === "errore" || (!!st.problema && attivo));
  if (!msg.hidden) {
    $("messaggio-titolo").textContent = st.fase === "errore" ? "GPS non disponibile" : attivo ? "Ricerca della posizione…" : "GPS spento";
    $("messaggio-testo").textContent = st.problema || (attivo ? "Se compare la richiesta, rispondi «Consenti». All'aperto la prima posizione arriva in pochi secondi." : "Premi «Accendi GPS»: la posizione della barca comparirà qui.");
  }
  $("riquadro-pos").hidden = !st.fix;
  if (st.fix) {
    $("lat").textContent = coordinata(st.fix.lat, true);
    $("lon").textContent = coordinata(st.fix.lon, false);
    $("precisione").textContent = (dato === "vivo" ? "" : "ultima posizione · ") + "±" + Math.round(st.fix.accuracy ?? 0) + " m";
  }
  if (st.vista === "vista-regata" && !$("blocco-rilievo").hidden) disegnaAnteprimaRilievo(nav);
  if (st.vista === "vista-nav") disegnaCarta(nav, attivo && dato === "vivo", corsa ? ob : null, {W, off, rlv, campo: corsa || !!st.disegno});
}

// ---------------- Mappa ----------------
function disegnaCarta(nav, vivo, ob, vento = {}) {
  const svg = $("carta"), W = svg.clientWidth, H = svg.clientHeight;
  if (!W || !H) return;
  if (st.segui && st.fix) st.centro = {lat: st.fix.lat, lon: st.fix.lon};
  if (!st.centro) { svg.innerHTML = ""; return; }
  const c = st.centro, k = Math.cos(rad(c.lat)), m = st.mpp;
  if (!st.origine) st.origine = {...c};
  const xy = p => ({x: W / 2 + rad(p.lon - c.lon) * R * k / m, y: H / 2 - rad(p.lat - c.lat) * R / m});
  st.vc = {c: {...c}, k, m, W, H};
  const f1 = v => v.toFixed(1);
  const sc = scalaGrafica(m, Math.min(110, W * 0.28));
  let out = "";

  const o = st.origine, g = sc.metri;
  const cx = rad(c.lon - o.lon) * R * k, cy = rad(c.lat - o.lat) * R;
  let linee = "";
  for (let x = Math.ceil((cx - W / 2 * m) / g) * g; x <= cx + W / 2 * m; x += g) linee += "M" + f1(W / 2 + (x - cx) / m) + " 0V" + H;
  for (let y = Math.ceil((cy - H / 2 * m) / g) * g; y <= cy + H / 2 * m; y += g) linee += "M0 " + f1(H / 2 - (y - cy) / m) + "H" + W;
  out += '<path d="' + linee + '" stroke="#fff" stroke-opacity=".08" fill="none"/>';

  if (st.mostraTraccia && s.traccia.length > 1)
    out += '<polyline points="' + s.traccia.map(p => { const q = xy(p); return f1(q.x) + "," + f1(q.y); }).join(" ") + '" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linejoin="round"/>';

  const campo = vento.campo !== false;
  const segmento = (a, b, colore, spessore) => { const p = xy(a), q = xy(b); return '<path d="M' + f1(p.x) + " " + f1(p.y) + "L" + f1(q.x) + " " + f1(q.y) + '" stroke="' + colore + '" stroke-width="' + spessore + '" stroke-linecap="round"/>'; };
  const lp = campo && lineaPartenza(s.boe);
  if (lp) out += segmento(lp[0], lp[1], "#ff0000", 4);
  const la = campo && lineaArrivo(s);
  if (la && !s.arrivo.ugualePartenza) out += segmento(la[0], la[1], "#ffffff", 4);
  if (campo) for (const e of [s.arrivo.estremi.a, s.arrivo.estremi.b]) if (e && !s.arrivo.ugualePartenza) { const p = xy(e); out += '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="6" fill="#fff" stroke="#000" stroke-width="2"/>'; }

  // Rilevamento senza posizione: semiretta dal punto d'osservazione.
  if (ob?.fonte === "rilevamento" && ob.boa) {
    const oss = ob.boa.osservazioni.at(-1), p = xy(oss), r = rad(oss.rilevamento), L = 3000;
    out += '<path d="M' + f1(p.x) + " " + f1(p.y) + "L" + f1(p.x + L * Math.sin(r)) + " " + f1(p.y - L * Math.cos(r)) + '" stroke="#fff" stroke-width="2" stroke-opacity=".85"/>';
  }

  // Lay-line dalla boa di bolina e freccia del vento (solo con vento tarato).
  if (vento.off && Number.isFinite(vento.W) && ob?.pos && vento.rlv !== null && boaDiBolina(vento.rlv, vento.W, vento.off)) {
    const c = rotteDiBolina(vento.W, vento.off), p = xy(ob.pos);
    for (const r of [c.dritta, c.sinistra]) {
      const a = rad(r + 180), L = 6000;
      out += '<path d="M' + f1(p.x) + " " + f1(p.y) + "L" + f1(p.x + L * Math.sin(a)) + " " + f1(p.y - L * Math.cos(a)) + '" stroke="#bdbdbd" stroke-width="1.5" stroke-opacity=".7"/>';
    }
  }

  const etichette = [];
  for (const b of campo ? s.boe : []) {
    if (!b.pos) continue;
    const p = xy(b.pos), corrente = ob?.boa === b, certo = b.pos.fonte === "gps", virtuale = b.pos.fonte === "disegnata", scelta = st.disegno && st.selezionata === b.codice;
    const cx = f1(p.x), cy = f1(p.y);
    if (b.codice === "CdR") {
      // Barca comitato: una barchetta bianca con la prua al vento, come all'ancora.
      const rot = Number.isFinite(vento.W) ? vento.W : 0;
      out += '<g transform="translate(' + cx + " " + cy + ") rotate(" + f1(rot) + ')"><path d="M0 -13 C6 -7 7 3 5 11 L-5 11 C-7 3 -6 -7 0 -13Z" fill="#fff" stroke="' + (scelta ? "#ff0000" : "#000") + '" stroke-width="' + (scelta ? 3 : 1.5) + '"/></g>';
    } else {
      // Boa: cerchio pieno con un anello intorno; anello rosso per la prossima boa (o per quella scelta mentre si disegna).
      out += '<circle cx="' + cx + '" cy="' + cy + '" r="12" fill="none" stroke="' + (corrente || scelta ? "#ff0000" : "#fff") + '" stroke-width="' + (corrente || scelta ? 3 : 2) + '"/>';
      out += '<circle cx="' + cx + '" cy="' + cy + '" r="5.5" fill="#ff0000"/>';
    }
    etichette.push({px: p.x, py: p.y, x: p.x + 15, y: p.y - 15, testo: (b.codice === "P" ? "Pin" : b.codice) + (certo || virtuale ? "" : b.pos.fonte === "istruzioni" ? " (IdR)" : " ~")});
  }
  if (ob && (ob.fonte === "linea" || ob.fonte === "estremo") && ob.pos) { const p = xy(ob.pos); out += '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="15" fill="none" stroke="#ff0000" stroke-width="3"/>'; }
  if (campo && s.arrivo.taglio?.lat != null) { const p = xy(s.arrivo.taglio); out += '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="7" fill="#fff"/><circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="16" fill="none" stroke="#fff" stroke-width="2.5"/>'; }
  const riservate = []; // spazi già occupati da bussola e vento: le sigle delle boe li evitano
  // Bussola sui bordi: tacche ogni 10°, gradi ogni 30°, punti cardinali (nord in alto).
  const bordo = gr => {
    const dx = Math.sin(rad(gr)), dy = -Math.cos(rad(gr));
    const t = Math.min(dx ? (dx > 0 ? W / 2 : -W / 2) / dx : Infinity, dy ? (dy > 0 ? H / 2 : -H / 2) / dy : Infinity);
    return {x: W / 2 + dx * t, y: H / 2 + dy * t, dx, dy};
  };
  // Punti da non coprire con le scritte fisse: boe e barca.
  const punti = etichette.map(e => ({x: e.px, y: e.py}));
  if (st.fix) punti.push(xy(st.fix));
  const vicino = (x, y, dx, dy) => punti.some(p => Math.abs(p.x - x) < dx && Math.abs(p.y - y) < dy);
  for (let gr = 0; gr < 360; gr += 10) {
    const b = bordo(gr), L = gr % 30 ? 6 : 12;
    out += '<path d="M' + f1(b.x) + " " + f1(b.y) + "L" + f1(b.x - b.dx * L) + " " + f1(b.y - b.dy * L) + '" stroke="#fff" stroke-opacity=".7" stroke-width="' + (gr % 90 ? 1.5 : 3) + '"/>';
    if (gr % 30) continue;
    const cardinale = {0: "N", 90: "E", 180: "S", 270: "O"}[gr], q = 22, lx = b.x - b.dx * q, ly = b.y - b.dy * q + 4, lw = cardinale ? 12 : 24;
    if (vicino(lx, ly - 5, lw / 2 + 14, 22)) continue; // una boa o la barca sotto la scritta: resta solo la tacca
    riservate.push({x: lx - lw / 2 - 2, y: ly - 14, w: lw + 4, h: 18});
    out += '<text x="' + f1(b.x - b.dx * q) + '" y="' + f1(b.y - b.dy * q + 4) + '" fill="' + (cardinale ? "#fff" : "#b5b5b5") + '" font-size="' + (cardinale ? 15 : 11) + '" font-weight="800" text-anchor="middle">' + (cardinale || String(gr).padStart(3, "0")) + "</text>";
  }
  // Freccia del vento sul bordo, dal lato da cui arriva, che punta dove va il vento.
  if (Number.isFinite(vento.W)) {
    // Sul bordo da cui arriva il vento, con la scritta accanto. Se lì c'è una boa o la barca (di solito la boa di bolina)
    // la freccia si scosta un poco lungo il bordo; la scritta va dal lato libero.
    const urta = (x, y, w, h) => riservate.some(r => x - w / 2 < r.x + r.w && x + w / 2 > r.x && y - h / 2 < r.y + r.h && y + h / 2 > r.y);
    const fuori = (x, y, w, h) => x - w / 2 < 4 || x + w / 2 > W - 4 || y - h / 2 < 4 || y + h / 2 > H - 4;
    let scelto = null;
    for (const d of [0, 15, -15, 30, -30]) for (const lato of [1, -1]) {
      const b = bordo(vento.W + d), ax = b.x - b.dx * 46, ay = b.y - b.dy * 46;
      const tx = ax - b.dy * 62 * lato, ty = ay + b.dx * 62 * lato;
      const voto = (vicino(ax, ay, 24, 30) ? 100 : 0) + (vicino(tx, ty, 50, 20) ? 10 : 0) + (urta(tx, ty, 80, 16) ? 3 : 0) + (fuori(tx, ty, 80, 16) ? 5 : 0) + Math.abs(d) / 100;
      if (!scelto || voto < scelto.voto) scelto = {ax, ay, tx, ty, voto};
    }
    const {ax, ay, tx, ty} = scelto;
    out += '<g transform="translate(' + f1(ax) + " " + f1(ay) + ") rotate(" + f1(vento.W) + ')"><path d="M0 -16 L0 14 M-7 6 L0 15 L7 6" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round"/></g>';
    out += '<text x="' + f1(tx) + '" y="' + f1(ty + 4) + '" fill="#fff" font-size="12" font-weight="800" text-anchor="middle" paint-order="stroke" stroke="#101010" stroke-width="4">VENTO ' + angolo(vento.W) + "</text>";
    riservate.push({x: tx - 42, y: ty - 10, w: 84, h: 20}, {x: ax - 14, y: ay - 18, w: 28, h: 36});
  }
  // Sigle delle boe: se si sovrappongono tra loro o alla bussola, si spostano intorno al loro punto.
  // Anche le boe e la barca sono spazi da non coprire.
  for (const e of etichette) riservate.push({x: e.px - 12, y: e.py - 12, w: 24, h: 24});
  if (st.fix) { const b = xy(st.fix); riservate.push({x: b.x - 16, y: b.y - 22, w: 32, h: 40}); }
  const occupate = [...riservate];
  const sovrapposto = (a, r) => Math.max(0, Math.min(a.x + a.w, r.x + r.w) - Math.max(a.x, r.x) + 3) * Math.max(0, Math.min(a.y + a.h, r.y + r.h) - Math.max(a.y, r.y) + 3);
  for (const e of etichette) {
    const w = 10 + e.testo.length * 8;
    const prove = [[0, 0], [0, 30], [-w - 30, 0], [-w - 30, 30], [0, -26], [-w - 30, -26], [0, 56], [-w - 30, 56], [-w / 2 - 15, 46], [-w / 2 - 15, -42], [24, 15], [-w - 54, 15]];
    const area = ([dx, dy]) => { const a = {x: e.x + dx, y: e.y + dy - 15, w, h: 21}; return occupate.reduce((t, r) => t + sovrapposto(a, r), 0) + (a.x < 4 || a.x + w > W - 4 || a.y < 4 || a.y + 21 > H - 4 ? 1e6 : 0); };
    // La prima posizione libera; se nessuna lo è, quella che copre meno.
    const [dx, dy] = prove.find(q => area(q) === 0) || prove.reduce((m, q) => area(q) < area(m) ? q : m);
    e.x += dx; e.y += dy; occupate.push({x: e.x, y: e.y - 15, w, h: 21});
    out += '<rect x="' + f1(e.x) + '" y="' + f1(e.y - 15) + '" width="' + w + '" height="21" rx="5" fill="#000" fill-opacity=".85" stroke="#666"/>';
    out += '<text x="' + f1(e.x + w / 2) + '" y="' + f1(e.y) + '" fill="#fff" font-size="13" font-weight="800" text-anchor="middle">' + esc(e.testo) + "</text>";
  }

  if (st.fix) {
    const b = xy(st.fix), colore = vivo ? "#ff0000" : "#7a7a7a";
    if (Number.isFinite(st.fix.accuracy)) out += '<circle cx="' + f1(b.x) + '" cy="' + f1(b.y) + '" r="' + f1(Math.max(3, st.fix.accuracy / m)) + '" fill="#ff0000" fill-opacity=".10" stroke="#ff0000" stroke-opacity=".7" stroke-width="1.5"/>';
    if (vivo && nav.cog !== null) out += '<g transform="translate(' + f1(b.x) + " " + f1(b.y) + ") rotate(" + f1(nav.cog) + ')"><path d="M0 -20 L12 14 L0 7 L-12 14Z" fill="' + colore + '" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></g>';
    else out += '<circle cx="' + f1(b.x) + '" cy="' + f1(b.y) + '" r="10" fill="' + colore + '" stroke="#fff" stroke-width="3"/>';
  }
  const sx = 42, sy = H - 42; // sopra le tacche della bussola
  out += '<path d="M' + sx + " " + (sy - 6) + "v6h" + f1(sc.pixel) + 'v-6" fill="none" stroke="#fff" stroke-width="2"/><text x="' + f1(sx + sc.pixel / 2) + '" y="' + (sy - 10) + '" fill="#fff" font-size="13" font-weight="700" text-anchor="middle">' + sc.etichetta + "</text>";
  svg.innerHTML = out;
}

const LIMITI_MPP = [0.05, 150];
function spostaCentro(dx, dy) { const c = st.centro; if (c) st.centro = {lat: c.lat + dy / R * 180 / Math.PI, lon: c.lon + dx / (R * Math.cos(rad(c.lat))) * 180 / Math.PI}; }
function zoom(fattore, ax, ay) {
  const svg = $("carta"), W = svg.clientWidth, H = svg.clientHeight;
  if (ax === undefined) { ax = W / 2; ay = H / 2; }
  const prima = st.mpp, dopo = Math.min(LIMITI_MPP[1], Math.max(LIMITI_MPP[0], prima / fattore));
  if (!st.segui && st.centro) spostaCentro((ax - W / 2) * (prima - dopo), -(ay - H / 2) * (prima - dopo));
  st.mpp = dopo; aggiorna();
}
function inquadraTutto() {
  const punti = [st.fix, ...s.boe.map(b => b.pos), s.arrivo.estremi.a, s.arrivo.estremi.b].filter(p => p && Number.isFinite(p.lat));
  if (!punti.length) { avvisa("Nessuna posizione da inquadrare."); return; }
  const svg = $("carta"), W = svg.clientWidth, H = svg.clientHeight;
  const lat0 = punti.reduce((a, p) => a + p.lat, 0) / punti.length, k = Math.cos(rad(lat0));
  const xs = punti.map(p => rad(p.lon) * R * k), ys = punti.map(p => rad(p.lat) * R);
  const larg = Math.max(...xs) - Math.min(...xs), alt = Math.max(...ys) - Math.min(...ys);
  st.segui = false;
  st.centro = {lat: (Math.max(...ys) + Math.min(...ys)) / 2 / R * 180 / Math.PI, lon: (Math.max(...xs) + Math.min(...xs)) / 2 / (R * k) * 180 / Math.PI};
  st.mpp = Math.min(LIMITI_MPP[1], Math.max(1.2, larg / Math.max(60, W - 150), alt / Math.max(60, H - 140))); // margine per bussola e sigle
  aggiorna();
}
const carta = $("carta"), puntatori = new Map();
const puntoSvg = e => { const r = carta.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; };
carta.addEventListener("pointerdown", e => {
  carta.setPointerCapture(e.pointerId); const p = puntoSvg(e);
  if (st.disegno?.daTocco) st.disegno.ultimoTocco = Date.now();
  puntatori.set(e.pointerId, p); carta.classList.add("trascina");
  const campoVisibile = st.modo === "allenamento" || st.modo === "regata";
  if (st.disegno && puntatori.size === 1) { st.tocco = {x: p.x, y: p.y, t: Date.now(), mosso: 0}; const b = boaVicina(p); st.trascina = b ? {codice: b.codice, prima: {...b.pos}, mossa: false} : null; }
  else if (campoVisibile && puntatori.size === 1) { const b = boaVicina(p); st.tocco = b ? {x: p.x, y: p.y, t: Date.now(), mosso: 0, candidata: b.codice} : null; st.trascina = null; }
  else { st.tocco = null; st.trascina = null; }
});
carta.addEventListener("pointermove", e => {
  if (!puntatori.has(e.pointerId) || !st.centro) return;
  const prima = [...puntatori.values()], vecchio = puntatori.get(e.pointerId), nuovo = puntoSvg(e);
  puntatori.set(e.pointerId, nuovo);
  if (st.tocco) st.tocco.mosso += Math.hypot(nuovo.x - vecchio.x, nuovo.y - vecchio.y);
  if (st.disegno && st.trascina && puntatori.size === 1) {
    if (st.tocco?.mosso <= 6) return;
    const b = trovaBoa(s.boe, st.trascina.codice);
    if (b) { b.pos = {...daSchermo(nuovo), acc: null, t: Date.now(), fonte: "disegnata"}; st.trascina.mossa = true; st.selezionata = b.codice; aggiorna(); }
    return;
  }
  const dopo = [...puntatori.values()];
  if (dopo.length === 1) {
    const dx = nuovo.x - vecchio.x, dy = nuovo.y - vecchio.y;
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
    st.segui = false; spostaCentro(-dx * st.mpp, dy * st.mpp);
  } else if (dopo.length === 2) {
    const [a, b] = prima, [c, d] = dopo;
    const da = Math.hypot(a.x - b.x, a.y - b.y), dd = Math.hypot(c.x - d.x, c.y - d.y);
    const ma = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, md = {x: (c.x + d.x) / 2, y: (c.y + d.y) / 2};
    if (!st.segui) spostaCentro(-(md.x - ma.x) * st.mpp, (md.y - ma.y) * st.mpp);
    if (da > 10) zoom(dd / da, md.x, md.y);
  }
  aggiorna();
});
const rilascia = e => {
  const p = puntatori.get(e.pointerId);
  puntatori.delete(e.pointerId); if (!puntatori.size) carta.classList.remove("trascina");
  if (!st.disegno && st.tocco?.candidata && p && e.type !== "pointercancel" && st.tocco.mosso < 8 && Date.now() - st.tocco.t < 800) { const c = st.tocco.candidata; st.tocco = null; selezionaBoa(c); return; }
  if (!st.disegno || e.type === "pointercancel") { st.tocco = null; st.trascina = null; return; }
  if (st.trascina?.mossa) { st.annullaDisegno.push({tipo: "sposta", codice: st.trascina.codice, pos: st.trascina.prima, sequenza: s.campo.sequenza}); dopoDisegno("Spostata " + st.trascina.codice); }
  else if (st.tocco && p && st.tocco.mosso < 8 && Date.now() - st.tocco.t < 800) {
    if (st.trascina) { st.selezionata = st.selezionata === st.trascina.codice ? null : st.trascina.codice; disegnaBarra(); aggiorna(); }
    else metti(daSchermo(p));
  }
  st.tocco = null; st.trascina = null;
};
carta.addEventListener("pointerup", rilascia);
carta.addEventListener("pointercancel", rilascia);
carta.addEventListener("wheel", e => { e.preventDefault(); const p = puntoSvg(e); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y); }, {passive: false});

// ---------------- Disegno: liste (solo quando cambiano i dati o la scheda) ----------------
function disegnaViste() { if (st.vista === "vista-regata") { disegnaCampo(); disegnaVento(); } if (st.vista === "vista-altro") disegnaAltro(); if (st.vista === "vista-polari") disegnaPolari(); if (st.vista === "vista-guida") disegnaGuida(); if (st.vista === "vista-home") disegnaHome(); }

// ---------------- Scheda Vento ----------------
function disegnaVento() {
  const adesso = Date.now(), sv = statoVento(adesso), t = sv.tar, v = s.vento;
  $("v-medio").textContent = Number.isFinite(sv.medio) ? angolo(sv.medio) : "—";
  $("v-medio-nota").textContent = sv.nMedia ? "ultimi " + v.imp.mediaMin + " min" : t.dir !== null ? "solo riferimento" : "da tarare";
  $("v-ora").textContent = Number.isFinite(sv.recente) ? angolo(sv.recente) : "—";
  $("v-salto").textContent = Number.isFinite(sv.salto) ? (sv.salto > 0 ? "+" : sv.salto < 0 ? "−" : "") + Math.round(Math.abs(sv.salto)) + "°" : "—";
  const sn = $("v-salto-nota"), bs = Number.isFinite(sv.salto) ? st.bs : null;
  sn.textContent = bs ? bs.tipo.toUpperCase() + " mure a " + st.mura : Number.isFinite(sv.salto) ? (sv.salto > 0 ? "a destra" : "a sinistra") : "\u00a0";
  sn.className = bs?.tipo === "scarso" ? "scarso" : "";
  const motivo = st.stima?.motivo;
  $("v-stato").textContent = t.dir === null ? "Vento non tarato: fai la taratura qui sotto."
    : !gpsAttivo() ? "GPS fermo: le stime riprendono quando avvii il GPS."
    : motivo ? "Stima del vento in pausa: " + motivo + ". Le stime si raccolgono solo in bolina stretta confermata, con rotta stabile."
    : "Stima attiva: " + sv.nMedia + " stime negli ultimi " + v.imp.mediaMin + " minuti.";
  const cl = classificaVento(v.campioni, adesso);
  $("v-tipo").textContent = {"in raccolta": "In raccolta dati", oscillante: "Oscillante", persistente: "Persistente verso " + cl.lato, stabile: "Stabile"}[cl.tipo];
  $("v-tipo-testo").textContent = cl.testo;
  disegnaGraficoVento(adesso, sv.medio);
  const metodo = fonteVento(t) + (t.t ? " " + etaTesto(adesso - t.t) : "");
  $("tar-stato").textContent = t.dir === null ? "Vento non tarato."
    : "Vento di riferimento " + angolo(t.dir) + " (" + metodo + "). Boline registrate: dritta " + (v.rif.dritta ? angolo(v.rif.dritta.cog) : "—") + ", sinistra " + (v.rif.sinistra ? angolo(v.rif.sinistra.cog) : "—") +
      ". Angolo di virata " + Math.round(t.angoloVirata) + "°, " + (t.misurato ? "misurato." : "predefinito (per misurarlo registra le due boline).");
  const lp = lineaPartenza(s.boe), lf = lp && Number.isFinite(sv.medio) ? latoFavorito(lp[0], lp[1], sv.medio) : null;
  $("linea-stato").textContent = !lp ? "Segna con il GPS (o disegna sulla mappa) la barca comitato e il pin, nella sezione Boe qui sopra."
    : !lf ? "Tara il vento per sapere quale estremo è favorito."
    : lf.favorito === "neutra" ? "Linea neutra (sbilanciamento sotto i 2°). Lunga " + Math.round(lf.lunghezza) + " m."
    : (lf.favorito === "P" ? "Favorito il pin" : "Favorita la barca comitato") + ": " + Math.round(lf.sbilanciamento) + "° di sbilanciamento, " + Math.round(lf.vantaggio) + " m più sopravvento (" +
      numero(lf.vantaggio / s.barca.lunghezza, 1) + " lunghezze). Linea lunga " + Math.round(lf.lunghezza) + " m. Ricorda: l'aria libera conta più dell'estremo favorito se lo sbilanciamento è piccolo.";
  $("imp-soglia").value = String(v.imp.soglia); $("imp-durata").value = String(v.imp.durataS); $("imp-media").value = String(v.imp.mediaMin);
  if (document.activeElement !== $("imp-lunghezza")) $("imp-lunghezza").value = String(s.barca.lunghezza);
  if (document.activeElement !== $("imp-virata")) $("imp-virata").value = String(s.barca.angoloVirata);
  $("imp-audio").setAttribute("aria-pressed", String(v.imp.audio));
  $("imp-audio").textContent = "Suono dell'allarme: " + (v.imp.audio ? "sì" : "no");
  $("imp-dieci").setAttribute("aria-pressed", String(s.timer.ultimi10));
  $("imp-dieci").textContent = "Timer: beep negli ultimi 10 secondi: " + (s.timer.ultimi10 ? "sì" : "no");
}
function disegnaGraficoVento(adesso, medio) {
  const svg = $("grafico-vento"), W = svg.clientWidth, H = svg.clientHeight;
  if (!W || !H) return;
  const finestra = 30 * 60000, c = s.vento.campioni.filter(x => adesso - x.t <= finestra);
  if (!c.length || !Number.isFinite(medio)) { svg.innerHTML = '<text x="' + W / 2 + '" y="' + H / 2 + '" fill="#b5b5b5" font-size="14" text-anchor="middle">Nessuna stima ancora: serve la bolina stretta</text>'; return; }
  const ys = c.map(x => delta(x.dir, medio)), lim = Math.max(10, Math.ceil(Math.max(...ys.map(Math.abs)) / 5) * 5);
  const sx = 38, X = t => sx + (W - sx - 8) * (1 - (adesso - t) / finestra), Y = d => H / 2 - d / lim * (H / 2 - 16);
  let out = '<path d="M' + sx + " " + H / 2 + "H" + (W - 8) + '" stroke="#ff0000" stroke-width="1.5"/>';
  for (const d of [lim, -lim]) out += '<path d="M' + sx + " " + Y(d) + "H" + (W - 8) + '" stroke="#333"/><text x="4" y="' + (Y(d) + 4) + '" fill="#b5b5b5" font-size="11">' + (d > 0 ? "+" : "−") + Math.abs(d) + "°</text>";
  out += '<text x="4" y="' + (H / 2 + 4) + '" fill="#fff" font-size="11">' + angolo(medio) + "</text>";
  for (const m of [30, 15, 0]) out += '<text x="' + Math.min(W - 24, Math.max(sx, X(adesso - m * 60000))) + '" y="' + (H - 3) + '" fill="#b5b5b5" font-size="11" text-anchor="middle">' + (m ? "−" + m + " min" : "ora") + "</text>";
  out += c.map((x, i) => '<circle cx="' + X(x.t).toFixed(1) + '" cy="' + Y(ys[i]).toFixed(1) + '" r="2" fill="' + (x.mura === "dritta" ? "#fff" : "#9a9a9a") + '"/>').join("");
  svg.innerHTML = out;
}

function statoBoa(b) {
  if (b.pos?.fonte === "gps") return {testo: "GPS ±" + (b.pos.acc ?? "?") + " m · " + oraBreve(b.pos.t), classe: "gps"};
  if (b.pos?.fonte === "triangolazione") return {testo: "stimata da " + b.osservazioni.length + " rilevamenti", classe: ""};
  if (b.pos?.fonte === "istruzioni") return {testo: "indicativa, dalle istruzioni", classe: ""};
  if (b.pos?.fonte === "disegnata") return {testo: "virtuale, disegnata", classe: ""};
  const n = b.osservazioni.length;
  return {testo: n ? n + (n === 1 ? " rilevamento" : " rilevamenti") + " · posizione ignota" : "posizione ignota", classe: ""};
}
function disegnaCampo() {
  const lista = tappe(s.campo.sequenza), corrente = lista[s.tappa];
  $("campo-titolo").textContent = s.campo.nome;
  $("lista-tappe").innerHTML = lista.map((t, i) => {
    const nome = t.tipo === "arrivo" ? "Arrivo" : t.opzionale ? "(" + t.codice + ")" : t.codice;
    const cl = [i < s.tappa ? "fatta" : "", i === s.tappa && !s.arrivo.taglio ? "corrente" : "", t.opzionale ? "eventuale" : ""].join(" ");
    return '<li><button type="button" class="' + cl + '" data-tappa="' + i + '" aria-label="Tappa ' + (i + 1) + ": " + esc(nome) + '">' + esc(nome) + "</button></li>";
  }).join("");
  $("lista-boe").innerHTML = s.boe.map(b => {
    const stb = statoBoa(b), partenza = /^(CdR|P)$/i.test(b.codice);
    const corr = corrente?.tipo === "boa" && corrente.codice.toUpperCase() === b.codice.toUpperCase();
    return '<div class="boa' + (corr ? " corrente" : "") + '"><span class="sigla">' + esc(b.codice) + '</span><div class="info"><strong>' + esc(b.nome) +
      '</strong><small class="' + stb.classe + '">' + esc(stb.testo) + '</small></div><div class="comandi"><button type="button" class="segna" data-segna="' + esc(b.codice) + '">' +
      (b.pos?.fonte === "gps" ? "Aggiorna GPS" : "Segna GPS") + "</button>" + (partenza ? "" : '<button type="button" data-rileva="' + esc(b.codice) + '">Rileva</button>') +
      "</div>" + (partenza ? "" : '<button type="button" class="togli" data-togli="' + esc(b.codice) + '" aria-label="Togli la boa ' + esc(b.codice) + '">×</button>') + "</div>";
  }).join("");
  const a = s.arrivo;
  $("arrivo-estremi").innerHTML = a.ugualePartenza
    ? '<p class="aiuto">La linea d\'arrivo coincide con la linea di partenza (CdR – P): segna quei due punti nell\'elenco delle boe.</p>'
    : ["a", "b"].map((q, i) => {
      const e = a.estremi[q];
      return '<div class="estremo"><div class="info"><strong>' + esc(a.etichette[i]) + "</strong><small>" + (e ? "GPS ±" + (e.acc ?? "?") + " m · " + oraBreve(e.t) : "non registrato") +
        '</small></div><button type="button" data-estremo="' + q + '">' + (e ? "Aggiorna GPS" : "Segna GPS") + "</button></div>";
    }).join("");
  $("btn-traguardo-2").disabled = !!a.taglio;
  $("annulla-arrivo").hidden = !a.taglio;
  $("arrivo-esito").textContent = a.taglio
    ? "Arrivo registrato alle " + ora(a.taglio.t) + (a.taglio.lat != null ? " · " + coordinata(a.taglio.lat, true) + " " + coordinata(a.taglio.lon, false) : " · senza posizione GPS")
    : "Premi quando tagli la linea: registra ora e posizione della barca. Il punto della barca non disegna la linea: per quella servono i due estremi.";
  disegnaRilievo();
}
const GRADI = [5, 10, 15, 20, 30, 45, 60, 90];
function disegnaRilievo() {
  if ($("blocco-rilievo").hidden) return;
  const v = Number($("ril-angolo").value);
  $("ril-gradi").innerHTML = GRADI.map(g => '<button type="button" data-gradi="' + g + '" aria-pressed="' + (g === v) + '">' + g + "°</button>").join("");
  document.querySelectorAll("[data-lato]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.lato) === st.rilievo.lato)));
  disegnaAnteprimaRilievo(smoothNav(st.fixes));
}
function disegnaAnteprimaRilievo(nav) {
  const gradi = Number($("ril-angolo").value);
  const ok = fixVivo() && nav.cog !== null && nav.sog >= 1;
  $("ril-anteprima").textContent = !ok ? "Serve una rotta stabile: naviga ad almeno 1 nodo con il GPS attivo."
    : "Rotta " + angolo(nav.cog) + " · boa " + gradi + "° " + (st.rilievo.lato < 0 ? "a sinistra" : "a dritta") + " → rilevamento " + angolo(norm(nav.cog + st.rilievo.lato * gradi));
  $("ril-registra").disabled = !ok;
}
function disegnaAltro() {
  const sc = $("btn-schermo"), attivo = st.vuoleSchermo && !!st.wakeLock;
  sc.setAttribute("aria-pressed", String(attivo));
  sc.textContent = "Schermo sempre acceso: " + (attivo ? "sì" : st.vuoleSchermo ? "in attesa" : "no");
  const t = $("btn-traccia");
  t.setAttribute("aria-pressed", String(st.mostraTraccia));
  t.textContent = "Traccia sulla mappa: " + (st.mostraTraccia ? "sì" : "no");
  $("imp-promemoria").value = String(s.vento.imp.promemoriaMin ?? 3);
  const copia = leggiCopia(); $("btn-annulla-reset").hidden = !copia;
  if (copia) $("btn-annulla-reset").textContent = "Annulla l'ultimo reset (" + ora(copia.t) + ")";
  disegnaIntero();
  $("registro").innerHTML = s.eventi.slice(0, 40).map(e => "<li><b>" + ora(e.t) + "</b> " + esc(e.testo) + "</li>").join("") || "<li>Nessun evento.</li>";
}

// ---------------- Configurazione del campo ----------------
$("cfg-modello").innerHTML = Object.entries(MODELLI).map(([id, m]) => '<option value="' + id + '">' + esc(m.nome) + "</option>").join("");
function controllaSequenza() {
  const boe = s.campo.modello === $("cfg-modello").value ? s.boe : MODELLI[$("cfg-modello").value].boe;
  const mancanti = leggiSequenza($("cfg-sequenza").value).filter(t => t.tipo === "boa" && !trovaBoa(boe, t.codice)).map(t => t.codice);
  const note = MODELLI[$("cfg-modello").value]?.note || "";
  $("cfg-note").textContent = mancanti.length ? "Attenzione: la sequenza usa " + [...new Set(mancanti)].join(", ") + ", che non è tra le boe. " + note : note;
}
$("configura").addEventListener("toggle", () => {
  if (!$("configura").open) return;
  $("cfg-nome").value = s.campo.nome; $("cfg-modello").value = s.campo.modello; $("cfg-sequenza").value = s.campo.sequenza; controllaSequenza();
});
$("cfg-modello").addEventListener("change", () => { const m = MODELLI[$("cfg-modello").value]; $("cfg-nome").value = m.nome; $("cfg-sequenza").value = m.sequenza; controllaSequenza(); });
$("cfg-sequenza").addEventListener("input", controllaSequenza);
$("cfg-applica").addEventListener("click", () => {
  const modello = $("cfg-modello").value;
  const {sessione, perse} = applicaModello(s, modello, {nome: $("cfg-nome").value.trim(), sequenza: $("cfg-sequenza").value.trim()});
  const estremiPersi = !sessione.arrivo.estremi.a && !sessione.arrivo.estremi.b && (s.arrivo.estremi.a || s.arrivo.estremi.b);
  const avvisi = [];
  if (perse.length) avvisi.push("le boe " + perse.map(b => b.codice).join(", ") + " hanno una posizione GPS e non fanno parte del nuovo campo");
  if (estremiPersi) avvisi.push("gli estremi della linea d'arrivo verranno cancellati");
  if (s.arrivo.taglio) avvisi.push("l'arrivo registrato verrà annullato");
  if (avvisi.length && !confirm("Attenzione: " + avvisi.join("; ") + ". Procedere? Puoi annullare ed esportare prima la sessione.")) return;
  s = sessione; evento("Campo: " + s.campo.nome + " · " + s.campo.sequenza);
  $("configura").open = false;
  avvisa("Campo applicato: " + s.campo.nome); modificato();
});
$("nuova-aggiungi").addEventListener("click", () => {
  const codice = $("nuova-codice").value.trim(), nome = $("nuova-nome").value.trim() || "Boa " + codice;
  if (!codice || /[-–→,()\s]/.test(codice)) { avvisa("Scrivi un codice breve, senza spazi né trattini."); return; }
  if (trovaBoa(s.boe, codice) || /^(S|F|G)$/i.test(codice)) { avvisa("Codice già usato o riservato (S, F, G)."); return; }
  s.boe.push({codice, nome, tipo: "percorso", pos: null, storico: [], osservazioni: []});
  $("nuova-codice").value = ""; $("nuova-nome").value = "";
  evento("Aggiunta boa " + codice); avvisa("Boa " + codice + " aggiunta. Ricorda di inserirla nella sequenza del percorso."); modificato();
});

// ---------------- Collegamenti dei pulsanti ----------------
function mostraVista(id) {
  st.vista = id;
  for (const v of ["vista-home", "vista-intro", "vista-guida", "vista-nav", "vista-regata", "vista-polari", "vista-altro"]) $(v).hidden = v !== id;
  disegnaSchede(); disegnaViste(); aggiorna();
  $(id).scrollTop = 0;
}
$("schede").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.vista === "menu") vaiAllaHome(); else mostraVista(b.dataset.vista);
});
// Indice della scheda Regata: salta alla sezione (sotto la riga dell'indice, che resta in alto).
document.querySelectorAll("[data-vai]").forEach(b => b.addEventListener("click", () => {
  const sez = $(b.dataset.vai), cont = $("vista-regata"), alto = cont.querySelector(".indice").offsetHeight;
  if (sez.tagName === "DETAILS") sez.open = true;
  cont.scrollTo({top: sez.offsetTop - cont.offsetTop - alto - 8, behavior: "smooth"});
}));
$("btn-gps").addEventListener("click", avviaGps);
$("btn-passata").addEventListener("click", boaPassata);
$("btn-traguardo").addEventListener("click", tagliaTraguardo);
$("btn-traguardo-2").addEventListener("click", tagliaTraguardo);
$("annulla-arrivo").addEventListener("click", annullaArrivo);
$("pr-segna").addEventListener("click", e => { const c = e.currentTarget.dataset.codice; if (c) segnaBoa(c); });
$("pr-rileva").addEventListener("click", e => { const c = e.currentTarget.dataset.codice; if (c) apriRilievo(c); });
$("zoom-piu").addEventListener("click", () => zoom(1.5));
$("zoom-meno").addEventListener("click", () => zoom(1 / 1.5));
$("tutto").addEventListener("click", inquadraTutto);
$("segui").addEventListener("click", () => { if (!st.fix) { avvisa("Avvia il GPS per seguire la barca."); return; } st.segui = true; aggiorna(); });
$("lista-tappe").addEventListener("click", e => {
  const b = e.target.closest("[data-tappa]"); if (!b) return;
  if (s.arrivo.taglio) { avvisa("Arrivo già registrato: annullalo per cambiare tappa."); return; }
  s.tappa = Number(b.dataset.tappa); evento("Prossima tappa impostata a mano: " + b.textContent); modificato();
});
$("lista-boe").addEventListener("click", e => {
  const segna = e.target.closest("[data-segna]"), rileva = e.target.closest("[data-rileva]"), togli = e.target.closest("[data-togli]");
  if (segna) segnaBoa(segna.dataset.segna);
  else if (rileva) apriRilievo(rileva.dataset.rileva);
  else if (togli) {
    const b = trovaBoa(s.boe, togli.dataset.togli);
    if (!b || !confirm("Togliere la boa " + b.codice + (b.pos ? " e la sua posizione" : "") + "?")) return;
    s.boe = s.boe.filter(x => x !== b); evento("Tolta boa " + b.codice); modificato();
  }
});
$("arrivo-estremi").addEventListener("click", e => { const b = e.target.closest("[data-estremo]"); if (b) segnaEstremo(b.dataset.estremo); });
document.querySelectorAll("[data-lato]").forEach(b => b.addEventListener("click", () => { st.rilievo.lato = Number(b.dataset.lato); disegnaRilievo(); }));
$("ril-gradi").addEventListener("click", e => { const b = e.target.closest("[data-gradi]"); if (b) { $("ril-angolo").value = b.dataset.gradi; disegnaRilievo(); } });
$("ril-angolo").addEventListener("input", disegnaRilievo);
$("ril-registra").addEventListener("click", registraRilievo);
$("ril-chiudi").addEventListener("click", () => { $("blocco-rilievo").hidden = true; st.rilievo.codice = null; });
$("btn-schermo").addEventListener("click", cambiaSchermo);
$("btn-traccia").addEventListener("click", () => { st.mostraTraccia = !st.mostraTraccia; disegnaAltro(); aggiorna(); });
$("btn-esporta").addEventListener("click", () => {
  const d = new Date(), nome = "rr-regatta-" + d.toISOString().slice(0, 10) + "-" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0") + ".json";
  const url = URL.createObjectURL(new Blob([JSON.stringify({...s, polari: pol, esportata: d.toISOString(), app: "RR Regatta " + VERSIONE}, null, 1)], {type: "application/json"}));
  const a = document.createElement("a"); a.href = url; a.download = nome; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  evento("Sessione esportata: " + nome); avvisa("File " + nome + " scaricato."); salvaPresto(); disegnaAltro();
});
$("btn-importa").addEventListener("click", () => $("file-importa").click());
$("file-importa").addEventListener("change", async e => {
  const file = e.target.files?.[0]; e.target.value = "";
  if (!file) return;
  try {
    const obj = verifica(JSON.parse(await file.text()));
    if (!confirm("Sostituire la sessione attuale con «" + file.name + "»? Esporta prima quella attuale se vuoi conservarla.")) return;
    delete obj.esportata; delete obj.app; delete obj.polari;
    s = obj; evento("Sessione importata: " + file.name); avvisa("Sessione importata."); modificato();
  } catch (err) { avvisa("File non valido: " + err.message + "."); }
});
$("btn-nuova").addEventListener("click", () => {
  if (!confirm("Reset generale?\n\nSi cancellano vento, boe segnate, arrivo, timer, traccia e registro. Restano percorso, dati della barca e polari.")) return;
  copiaPrimaDelReset();
  const campo = s.campo, boe = s.boe, barcaDati = s.barca, impVento = s.vento.imp, dieci = s.timer.ultimi10, pref = s.preferenze;
  s = nuovaSessione(campo.modello);
  s.barca = barcaDati; s.vento = nuovoVento(impVento); s.timer = nuovoTimer(dieci); s.preferenze = pref;
  azzeraStato();
  s.campo = {...campo};
  s.boe = boe.map(b => ({...b, pos: b.pos?.fonte === "istruzioni" ? b.pos : null, storico: [], osservazioni: []}));
  evento("Reset generale · " + campo.nome); avvisa("Reset fatto."); modificato();
});
$("btn-annulla-reset").addEventListener("click", annullaReset);
$("btn-reset").addEventListener("click", () => { if (st.modo) resetModo(st.modo); });
$("btn-intero").addEventListener("click", () => schermoIntero(true));
$("imp-intero").addEventListener("click", () => { s.preferenze.schermoIntero = !s.preferenze.schermoIntero; schermoIntero(s.preferenze.schermoIntero); salvaPresto(); });

new ResizeObserver(aggiorna).observe(carta);
// Collegamenti della Fase 3
$("btn-andatura").addEventListener("click", () => { if (st.andaturaAperta) { st.andaturaAperta = false; disegnaAndatura(); } else apriAndatura(); });
$("andatura-chiudi").addEventListener("click", () => { st.andaturaAperta = false; disegnaAndatura(); });
$("griglia-andature").addEventListener("click", e => { const b = e.target.closest("[data-andatura]"); if (b) { const [n, m] = b.dataset.andatura.split("|"); dichiaraAndatura(n, m); } });
$("richiesta-giusta").addEventListener("click", () => {
  const [n, m] = ($("richiesta-andatura").dataset.andatura || "|").split("|");
  st.ultimaRichiesta = Date.now(); $("richiesta-andatura").hidden = true;
  if (n) {
    s.vento.andatura = {nome: n, mura: m, t: Date.now()};
    if (n === "Bolina stretta") { s.vento.bolina = true; st.poggiataDa = null; avvisa("Bolina stretta: l'app stima i salti di vento."); }
    evento("Andatura confermata: " + n.toLowerCase() + ", mure a " + m); salvaPresto();
  }
  aggiorna();
});
$("richiesta-cambia").addEventListener("click", apriAndatura);
$("btn-disegna-mappa").addEventListener("click", () => { if (st.disegno) fineDisegno(); else avviaDisegno(); aggiorna(); });
$("imp-promemoria").addEventListener("change", e => { s.vento.imp.promemoriaMin = Number(e.target.value); st.ultimaRichiesta = Date.now(); salvaPresto(); });
$("allarme-ok").addEventListener("click", () => {
  if ($("allarme").dataset.tipo === "scarso" && st.allScarso) { st.allScarso.riconosciuto = true; evento("Allarme scarso visto"); }
  else if (s.vento.rotazione) { const m = statoVento().medio; s.vento.rotazione = {riferimento: m, inizio: null, attivo: false, rotazione: 0}; evento("Nuovo riferimento del vento medio: " + angolo(m)); salvaPresto(); }
  aggiorna();
});
$("tar-motore").addEventListener("click", taraMotore);
$("tar-dritta").addEventListener("click", () => taraBolina("dritta"));
$("tar-sinistra").addEventListener("click", () => taraBolina("sinistra"));
$("tar-mano-ok").addEventListener("click", taraMano);
$("tar-azzera").addEventListener("click", azzeraTaratura);
const impostazione = (id, fn) => $(id).addEventListener("change", e => { fn(e.target.value); salvaPresto(); disegnaVento(); aggiorna(); });
impostazione("imp-soglia", v => { s.vento.imp.soglia = Number(v); st.allScarso = null; });
impostazione("imp-durata", v => { s.vento.imp.durataS = Number(v); });
impostazione("imp-media", v => { s.vento.imp.mediaMin = Number(v); });
impostazione("imp-lunghezza", v => { const n = Number(v); if (n >= 3 && n <= 40) s.barca.lunghezza = n; else avvisa("Lunghezza tra 3 e 40 metri."); });
impostazione("imp-virata", v => { const n = Number(v); if (n >= 60 && n <= 130) s.barca.angoloVirata = n; else avvisa("Angolo di virata tra 60 e 130 gradi."); });
$("imp-audio").addEventListener("click", () => { s.vento.imp.audio = !s.vento.imp.audio; if (s.vento.imp.audio) segnale(); salvaPresto(); disegnaVento(); });

// Polari
$("pol-registra").addEventListener("click", registraPolari);
$("pol-motore").addEventListener("click", taraMotore);
document.querySelectorAll("[data-passo]").forEach(b => b.addEventListener("click", () => {
  const v = Number(String($("pol-tws").value).replace(",", ".")) || (pol.vento?.letto ?? 0);
  $("pol-tws").value = String(Math.max(0, Math.min(60, v + Number(b.dataset.passo))));
}));
document.querySelectorAll("[data-metodo]").forEach(b => b.addEventListener("click", () => { st.polMetodo = b.dataset.metodo; disegnaPolari(); }));
$("pol-tws-ok").addEventListener("click", inserisciVento);
for (const tipo of ["prua", "randa", "portante"]) $("pol-" + tipo).addEventListener("click", e => { const b = e.target.closest("[data-" + tipo + "]"); if (b) cambiaVele(tipo, b.dataset[tipo]); });
$("pol-classi").addEventListener("click", e => { const b = e.target.closest("[data-classe]"); if (b) { st.polClasse = Number(b.dataset.classe); disegnaPolari(); } });
$("pol-config").addEventListener("change", e => { st.polConfig = e.target.value; disegnaPolari(); });
$("pol-validita").addEventListener("change", e => { pol.imp.validitaMin = Number(e.target.value); salvaPolari(); disegnaPolari(); });
$("pol-usa-virata").addEventListener("click", e => {
  const a = Number(e.currentTarget.dataset.angolo);
  if (!(a >= 60 && a <= 130)) { avvisa("Angolo di virata fuori dai limiti (60–130°)."); return; }
  if (!confirm("Usare " + a + "° come angolo di virata tipico in regata? Vale finché non registrate le due boline.")) return;
  s.barca.angoloVirata = a; evento("Angolo di virata dalle polari: " + a + "°"); avvisa("Angolo di virata tipico: " + a + "°."); modificato();
});
$("pol-esporta").addEventListener("click", () => {
  const nome = "rr-polari-" + dataFile() + ".json";
  scaricaFile(nome, JSON.stringify({...pol, esportata: new Date().toISOString(), app: "RR Regatta " + VERSIONE}), "application/json");
  evento("Polari esportate: " + nome); avvisa("File " + nome + " scaricato.");
});
$("pol-csv").addEventListener("click", () => {
  if (!pol.campioni.length) { avvisa("Nessun punto registrato."); return; }
  const scelta = configScelta(), nome = "rr-polare-" + dataFile() + ".csv";
  const titolo = "RR Regatta - polare: " + (scelta === "tutte" ? "vele migliori per ogni angolo" : nomeVele(pol.configurazioni[scelta] ?? chiaveVele(pol.vele))) + " - velocita sul fondo in nodi\r\n";
  scaricaFile(nome, "\ufeff" + titolo + tabellaCsv(pol, scelta), "text/csv;charset=utf-8");
  avvisa("Tabella " + nome + " scaricata.");
});
$("pol-importa").addEventListener("click", () => $("pol-file").click());
$("pol-file").addEventListener("change", async e => {
  const file = e.target.files?.[0]; e.target.value = "";
  if (!file) return;
  try {
    const dati = JSON.parse(await file.text());
    const altro = verificaPolari(dati.formato === "rr-regatta" ? dati.polari : dati);
    const n = unisciPolari(pol, altro);
    evento("Polari importate da " + file.name + ": " + n + " punti nuovi"); avvisa(n + " punti nuovi aggiunti alle polari."); salvaPolari(); modificato();
  } catch (err) { avvisa("File non valido: " + err.message + "."); }
});
$("pol-scarta").addEventListener("click", () => {
  const limite = Date.now() - 5 * 60000, n = pol.campioni.filter(c => c[0] > limite).length;
  if (!n) { avvisa("Nessun punto negli ultimi 5 minuti."); return; }
  if (!confirm("Scartare i " + n + " punti registrati negli ultimi 5 minuti?")) return;
  pol.campioni = pol.campioni.filter(c => c[0] <= limite);
  evento("Polari: scartati " + n + " punti degli ultimi 5 minuti"); salvaPolari(); modificato();
});
$("pol-azzera").addEventListener("click", () => {
  if (!pol.campioni.length) { avvisa("Le polari sono già vuote."); return; }
  if (!confirm("Cancellare tutte le polari (" + pol.campioni.length + " punti)? Non si può annullare: esportale prima se vuoi conservarle.")) return;
  pol = {...nuovePolari(), vele: pol.vele, imp: pol.imp, vento: pol.vento}; st.polRegistra = false;
  evento("Polari cancellate"); salvaPolari(true); modificato();
});

// Pagina iniziale e preparazione
document.querySelectorAll("[data-modo-app]").forEach(b => b.addEventListener("click", () => mostraIntro(b.dataset.modoApp)));
$("intro-conferma").addEventListener("click", () => entraModo(st.modoProposto));
$("intro-indietro").addEventListener("click", () => mostraVista("vista-home"));
$("home-altro").addEventListener("click", () => { st.modo = null; mostraVista("vista-altro"); });
$("guida-passi").addEventListener("click", e => { const b = e.target.closest("[data-guida]"); if (b) azioneGuida(b.dataset.guida); });
$("guida-vai").addEventListener("click", () => mostraVista("vista-nav"));
$("btn-registra").addEventListener("click", registraPolari);
// Timer, cronometro, disegno, campi d'allenamento
$("btn-crono").addEventListener("click", () => { st.cronoAperto = !st.cronoAperto; disegnaCrono(); });
$("crono-chiudi").addEventListener("click", () => { st.cronoAperto = false; disegnaCrono(); });
$("crono-pillola").addEventListener("click", () => { st.cronoAperto = true; st.cronoModo = Number.isFinite(s.timer.zero) ? "timer" : "cronometro"; disegnaCrono(); });
document.querySelectorAll("[data-modo]").forEach(b => b.addEventListener("click", () => { st.cronoModo = b.dataset.modo; disegnaCrono(); }));
$("timer-comandi").addEventListener("click", e => { const b = e.target.closest("[data-timer]"); if (b) comandoTimer(b.dataset.timer); });
$("cr-avvia").addEventListener("click", () => comandoCronometro("avvia"));
$("cr-parziale").addEventListener("click", () => comandoCronometro("parziale"));
$("cr-azzera").addEventListener("click", () => comandoCronometro("azzera"));
$("imp-dieci").addEventListener("click", () => { s.timer.ultimi10 = !s.timer.ultimi10; if (s.timer.ultimi10) suono("breve"); salvaPresto(); disegnaVento(); });
$("btn-disegna").addEventListener("click", avviaDisegno);
document.querySelectorAll("[data-metti]").forEach(b => b.addEventListener("click", () => { st.disegno.metti = b.dataset.metti; disegnaBarra(); avvisa($("disegno-aiuto").textContent); }));
$("disegno-annulla").addEventListener("click", annullaDisegno);
$("disegno-togli").addEventListener("click", togliSelezionata);
$("disegno-fine").addEventListener("click", fineDisegno);
$("disegno-barra").addEventListener("pointerdown", () => { if (st.disegno?.daTocco) st.disegno.ultimoTocco = Date.now(); });
$("all-tipo").addEventListener("click", e => { const b = e.target.closest("[data-tipo]"); if (b) { st.tipoAllenamento = b.dataset.tipo; disegnaAllenamento(); } });
$("allenamento").addEventListener("toggle", () => { if ($("allenamento").open) { $("all-vento").value = ""; disegnaAllenamento(); } });
$("all-crea").addEventListener("click", creaAllenamento);
setInterval(tickTimer, 200);

setInterval(aggiorna, 1000);
setInterval(() => { if (st.vista === "vista-regata") disegnaVento(); }, 2000);
setInterval(() => { if (st.vista === "vista-polari") disegnaPolariVivo(); }, 15000); // età di taratura e vento
mostraVista("vista-home"); disegnaIntero();
// Il GPS si accende da solo all'apertura, salvo se l'utente ha negato il permesso.
(async () => {
  try { const p = await navigator.permissions?.query({name: "geolocation"}); if (p?.state === "denied") { st.fase = "errore"; st.problema = "Permesso della posizione negato: abilitalo nelle impostazioni del sito in Chrome."; aggiorna(); return; } } catch {}
  if (!gpsAttivo()) avviaGps();
})();
