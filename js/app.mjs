// RR Regatta · v0.5: navigazione GPS, campo di regata, vento e tattica di bolina, polari apprese in allenamento.
import {gpsFixFromPosition, gpsErrorInfo} from "./gps.mjs?v=0.5.1";
import {markVMC, norm, delta} from "./engine.mjs?v=0.5.1";
import {smoothNav, derivaMoto, statoDato, numero, angolo, coordinata, scalaGrafica} from "./nav.mjs?v=0.5.1";
import {MODELLI, leggiSequenza, tappe, trovaBoa, obiettivo, triangola, distanzaTesto, lineaPartenza, lineaArrivo, bearing, distanceMeters} from "./campo.mjs?v=0.5.1";
import {nuovaSessione, nuovoVento, applicaModello, verifica, carica, salva} from "./stato.mjs?v=0.5.1";
import {taratura, muraDa, rottaStabile, stimaDaBolina, analisiVento, buonoScarso, classificaVento, aggiornaAllarmeScarso,
  aggiornaAllarmeRotazione, bordoFavorevole, distanzaLayline, latoFavorito, boaDiBolina, rotteDiBolina} from "./vento.mjs?v=0.5.1";
import {CHIAVE_POLARI, PRUA, RANDA, PORTANTI, MAX_CAMPIONI, nuovePolari, verificaPolari, chiaveVele, nomeVele, indiceVele, ventoVero,
  classeVento, valutaPunto, polare, ottimi, velocitaPolare, classiConDati, configurazioniConDati, tabellaCsv, unisciPolari} from "./polari.mjs?v=0.5.1";

const VERSIONE = "0.5.1";
const R = 6371008.8;
const rad = d => d * Math.PI / 180;
const $ = id => document.getElementById(id);
const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const ora = t => new Date(t).toLocaleTimeString("it-IT");
const etaTesto = ms => ms < 90000 ? "adesso" : Math.round(ms / 60000) + " min fa";
const oraBreve = t => new Date(t).toLocaleTimeString("it-IT", {hour: "2-digit", minute: "2-digit"});

// Errori del programma sempre visibili: niente più schermate mute.
function mostraErrore(testo) { const el = $("avviso-errore"); el.textContent = "Errore del programma: " + testo; el.hidden = false; }
addEventListener("error", e => mostraErrore(e.message || "sconosciuto"));
addEventListener("unhandledrejection", e => mostraErrore((e.reason && e.reason.message) || String(e.reason)));
$("versione").textContent = "versione " + VERSIONE;

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
  vista: "vista-nav", rilievo: {codice: null, lato: -1},
  mura: null, ultimaVirata: 0, stima: null, bs: null, allScarso: null, poggiataDa: null, ultimoRegistro: 0, audio: null,
  polRegistra: false, polValuta: null, polUltimo: 0, polCambioVele: 0, polNuovi: 0, polClasse: null, polConfig: "attuale", polMetodo: "fermo"
};
const gpsAttivo = () => st.watch !== null;
const fixVivo = () => gpsAttivo() && st.fix && Date.now() - st.fix.received <= 5000;

// ---------------- GPS ----------------
function avviaGps() {
  if (gpsAttivo()) {
    if (confirm("Fermare il GPS? Rotta, velocità e boa non saranno più aggiornate.")) fermaGps();
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

function rottaPerTaratura() {
  if (!fixVivo()) { avvisa("Serve il GPS attivo con una posizione recente."); return null; }
  const r = rottaStabile(st.fixes, Date.now(), {finestraMs: 10000, maxDispersione: 8});
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
  avvisa("Vento di riferimento registrato: " + angolo(c) + "." + (st.vista === "vista-polari" ? " Riaccendi «Registra» quando navigate a vela." : ""));
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
  st.polValuta = valutaPunto({fixes: st.fixes, adesso, rif: {dir: t.dir, t: t.t}, vento: pol.vento,
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
    if (!gpsAttivo()) { avvisa("Avvia prima il GPS dalla scheda Navigazione."); return; }
    if (tar().dir === null) avvisa("Tara la direzione del vento: prua al vento a motore oppure le due boline.");
    else if (!pol.vento) avvisa("Inserisci l'intensità del vento letta con l'anemometro.");
  }
  st.polRegistra = !st.polRegistra; st.polValuta = null;
  evento("Polari: registrazione " + (st.polRegistra ? "avviata · " + nomeVele(chiaveVele(pol.vele)) : "fermata"));
  salvaPolari(); modificato();
}
function inserisciVento() {
  const letto = Number(String($("pol-tws").value).replace(",", "."));
  if ($("pol-tws").value === "" || !Number.isFinite(letto) || letto < 0 || letto > 60) { avvisa("Scrivi il vento letto, in nodi."); return; }
  const sog = st.polMetodo === "motore" ? (fixVivo() ? st.fix.sog : null) : 0;
  if (st.polMetodo === "motore" && !Number.isFinite(sog)) { avvisa("A motore serve il GPS attivo: l'app toglie la velocità della barca."); return; }
  const tws = ventoVero(letto, st.polMetodo, sog);
  pol.vento = {tws: +tws.toFixed(1), letto, metodo: st.polMetodo, sog: Number.isFinite(sog) ? +sog.toFixed(1) : null, t: Date.now()};
  pol.letture.push({...pol.vento});
  evento("Vento letto " + numero(letto, 1) + " kn" + (st.polMetodo === "motore" ? " a motore (barca " + numero(sog, 1) + " kn)" : " a barca ferma") + " → vento vero " + numero(tws, 1) + " kn");
  avvisa("Vento vero " + numero(tws, 1) + " nodi" + (classeVento(tws) ? " (classe " + classeVento(tws) + " nodi)." : ": troppo poco per le polari."));
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
  r.textContent = "Registra le polari: " + (st.polRegistra ? "sì" : "no");
  const val = st.polValuta, nConfig = pol.campioni.filter(c => c[4] === pol.configurazioni.indexOf(chiaveVele(pol.vele))).length;
  const el = $("pol-stato");
  el.className = "pol-stato" + (st.polRegistra && val && !val.ok ? " pausa" : "");
  el.textContent = !st.polRegistra ? "Registrazione ferma. " + pol.campioni.length + " punti salvati in tutto."
    : !gpsAttivo() ? "In pausa: GPS fermo."
    : !val ? "In attesa del GPS…"
    : val.ok ? "Registro: " + nConfig + " punti con queste vele (" + Math.round(nConfig * 2 / 60) + " min)."
    : "In pausa: " + val.motivo + ".";
  const vivo = fixVivo(), twa = vivo && t.dir !== null && Number.isFinite(st.fix.cog) && st.fix.sog >= 0.5 ? delta(st.fix.cog, t.dir) : null;
  $("pol-twa").textContent = twa === null ? "—" : Math.round(Math.abs(twa)) + "°";
  $("pol-twa-nota").textContent = twa === null ? (t.dir === null ? "vento da tarare" : " ") : "mure a " + (twa >= 0 ? "sinistra" : "dritta");
  $("pol-sog").textContent = vivo && Number.isFinite(st.fix.sog) ? numero(st.fix.sog, 1) : "—";
  const classe = classeVento(pol.vento?.tws), punti = classe ? polare(pol, classe, veleAttuali()) : [];
  const vp = twa === null ? null : velocitaPolare(punti, twa);
  $("pol-rif").textContent = vp ? numero(vp, 1) : "—";
  $("pol-rif-nota").textContent = vp && vivo ? Math.round(st.fix.sog / vp * 100) + "% della polare" : classe ? "ancora pochi dati" : " ";
  $("pol-vento-stato").textContent = "Direzione: " + (t.dir === null ? "da tarare" : angolo(t.dir) + " (" + (t.fonte === "boline" ? "dalle due boline" : t.fonte) + (t.t ? ", " + etaTesto(adesso - t.t) : "") + ")") +
    ". Intensità: " + (pol.vento ? numero(pol.vento.tws, 1) + " kn vero (" + (pol.vento.metodo === "motore" ? "letto " + numero(pol.vento.letto, 1) + " a motore" : "a barca ferma") + ", " + etaTesto(adesso - pol.vento.t) + ")" : "da inserire") + ".";
  $("versione").textContent = "versione " + VERSIONE + (st.polRegistra ? " · polari" : "");
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
function aggiorna() { if (!aggiorna.attesa) { aggiorna.attesa = true; setTimeout(() => { aggiorna.attesa = false; disegnaNav(); if (st.vista === "vista-polari") disegnaPolariVivo(); }, 30); } }

function descriviFonte(ob) {
  switch (ob.fonte) {
    case "gps": return "posizione GPS ±" + (ob.pos.acc ?? "?") + " m";
    case "triangolazione": return "posizione stimata da due rilevamenti";
    case "istruzioni": return "posizione indicativa dalle istruzioni";
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
  ps.hidden = !boaTappa;
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
    : sv.nMedia ? "media " + s.vento.imp.mediaMin + " min" : "riferimento";

  // Tattica: lato favorito della linea, bordo favorevole, lay-line
  const tattica = []; let forte = false;
  if (s.tappa === 0 && !s.arrivo.taglio && Number.isFinite(W)) {
    const lp = lineaPartenza(s.boe), lf = lp && latoFavorito(lp[0], lp[1], W);
    const vicino = lp && barca && distanceMeters(barca, {lat: (lp[0].lat + lp[1].lat) / 2, lon: (lp[0].lon + lp[1].lon) / 2}) < 500;
    if (lf && vicino) tattica.push(lf.favorito === "neutra" ? "Linea neutra" : "Linea: favorita " + (lf.favorito === "P" ? "la boa P" : "la barca CdR") + " di " + Math.round(lf.vantaggio) + " m");
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
      let txt = bf.vantaggio < 2 ? "Bordi equivalenti" : "Favorite mure a " + bf.mura + " (+" + Math.round(bf.vantaggio) + "°)";
      if (ob.pos && st.mura) {
        const rotta = rotteDiBolina(W, off)[st.mura];
        const d = distanzaLayline(barca, ob.pos, st.mura, W, off), soglia = Math.max(2 * s.barca.lunghezza, 15);
        if (Math.abs(delta(rlv, rotta)) <= 4) txt = "Sulla lay-line: boa dritta di prua";
        else if (d !== null && Math.abs(d) <= soglia) { txt = "IN LAY-LINE: VIRA"; forte = true; }
        else if (d !== null && d < 0) txt += " · oltre la lay-line di " + distanzaTesto(-d);
        else if (d !== null) txt += " · lay-line tra " + distanzaTesto(d);
      }
      tattica.push(txt);
    }
  }
  const pt = $("pr-tattica");
  pt.hidden = !tattica.length; pt.textContent = tattica.join(" · "); pt.classList.toggle("forte", forte);

  // Allarmi
  const al = $("allarme"), rot = s.vento.rotazione;
  if (st.allScarso?.attivo && !st.allScarso.riconosciuto) {
    al.hidden = false; al.className = "allarme"; al.dataset.tipo = "scarso";
    $("allarme-titolo").textContent = "SCARSO " + Math.round(st.allScarso.gradi) + "°";
    $("allarme-testo").textContent = "Vento oltre la media da " + Math.round((adesso - st.allScarso.inizio) / 1000) + " s: valuta la virata.";
  } else if (rot?.attivo) {
    al.hidden = false; al.className = "allarme rotazione"; al.dataset.tipo = "rotazione";
    $("allarme-titolo").textContent = "VENTO RUOTATO " + (rot.rotazione > 0 ? "+" : "−") + Math.round(Math.abs(rot.rotazione)) + "°";
    $("allarme-testo").textContent = "Il vento medio è girato a " + (rot.rotazione > 0 ? "destra" : "sinistra") + ". Possibile rotazione persistente.";
  } else al.hidden = true;

  // Pulsanti in basso
  const b = $("btn-gps");
  b.textContent = attivo ? "Ferma GPS" : "Avvia GPS";
  b.classList.toggle("attivo", attivo);
  const inRegata = attivo && !s.arrivo.taglio && ob.tappa;
  const bb = $("btn-bolina");
  bb.hidden = !attivo; bb.setAttribute("aria-pressed", String(!!s.vento.bolina));
  bb.textContent = s.vento.bolina ? "BOLINA ✓" : "Bolina stretta?";
  $("btn-traguardo").hidden = !(ob.tappa?.tipo === "arrivo" && !s.arrivo.taglio && attivo);
  $("btn-passata").hidden = !(inRegata && ob.tappa.tipo !== "arrivo");
  if (ob.tappa) $("btn-passata").textContent = ob.tappa.tipo === "cancello" ? "Cancello passato ›" : ob.tappa.opzionale ? ob.tappa.codice + " passata o assente ›" : "Boa " + ob.tappa.codice + " passata ›";
  $("segui").classList.toggle("attivo", st.segui && !!st.fix);

  const msg = $("mappa-messaggio");
  msg.hidden = !!st.fix || !!st.centro;
  msg.classList.toggle("problema", st.fase === "errore" || (!!st.problema && attivo));
  if (!msg.hidden) {
    $("messaggio-titolo").textContent = st.fase === "errore" ? "GPS non disponibile" : attivo ? "Ricerca della posizione…" : "Premi «Avvia GPS»";
    $("messaggio-testo").textContent = st.problema || (attivo ? "Se compare la richiesta, rispondi «Consenti». All'aperto il primo punto arriva in pochi secondi." : "La posizione della barca comparirà qui.");
  }
  $("riquadro-pos").hidden = !st.fix;
  if (st.fix) {
    $("lat").textContent = coordinata(st.fix.lat, true);
    $("lon").textContent = coordinata(st.fix.lon, false);
    $("precisione").textContent = (dato === "vivo" ? "" : "ultima posizione · ") + "±" + Math.round(st.fix.accuracy ?? 0) + " m";
  }
  if (st.vista === "vista-regata" && !$("blocco-rilievo").hidden) disegnaAnteprimaRilievo(nav);
  if (st.vista === "vista-nav") disegnaCarta(nav, attivo && dato === "vivo", ob, {W, off, rlv});
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

  const segmento = (a, b, colore, spessore) => { const p = xy(a), q = xy(b); return '<path d="M' + f1(p.x) + " " + f1(p.y) + "L" + f1(q.x) + " " + f1(q.y) + '" stroke="' + colore + '" stroke-width="' + spessore + '" stroke-linecap="round"/>'; };
  const lp = lineaPartenza(s.boe);
  if (lp) out += segmento(lp[0], lp[1], "#ff0000", 4);
  const la = lineaArrivo(s);
  if (la && !s.arrivo.ugualePartenza) out += segmento(la[0], la[1], "#ffffff", 4);
  for (const e of [s.arrivo.estremi.a, s.arrivo.estremi.b]) if (e && !s.arrivo.ugualePartenza) { const p = xy(e); out += '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="6" fill="#fff" stroke="#000" stroke-width="2"/>'; }

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
  if (Number.isFinite(vento.W)) {
    out += '<g transform="translate(' + (W - 92) + ' 34) rotate(' + f1(vento.W + 180) + ')"><path d="M0 -16 L0 14 M-7 6 L0 15 L7 6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></g>';
    out += '<text x="' + (W - 92) + '" y="68" fill="#fff" font-size="12" font-weight="800" text-anchor="middle">VENTO ' + angolo(vento.W) + "</text>";
  }

  const etichette = [];
  for (const b of s.boe) {
    if (!b.pos) continue;
    const p = xy(b.pos), corrente = ob?.boa === b, certo = b.pos.fonte === "gps";
    if (corrente) out += '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="17" fill="none" stroke="#ff0000" stroke-width="3"/>';
    out += '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="9" fill="' + (certo ? "#fff" : "#101010") + '" stroke="' + (certo ? "#ff0000" : "#fff") + '" stroke-width="2.5"/>';
    etichette.push({x: p.x + 13, y: p.y - 13, testo: b.codice + (certo ? "" : b.pos.fonte === "istruzioni" ? " (IdR)" : " ~")});
  }
  if (ob && (ob.fonte === "linea" || ob.fonte === "estremo") && ob.pos) { const p = xy(ob.pos); out += '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="15" fill="none" stroke="#ff0000" stroke-width="3"/>'; }
  if (s.arrivo.taglio?.lat != null) { const p = xy(s.arrivo.taglio); out += '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="7" fill="#fff"/><circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="16" fill="none" stroke="#fff" stroke-width="2.5"/>'; }
  // Sigle delle boe: se due si sovrappongono, la seconda si sposta sotto o a sinistra del suo punto.
  const occupate = [];
  for (const e of etichette) {
    const w = 10 + e.testo.length * 8;
    const prove = [[0, 0], [0, 30], [-w - 26, 0], [-w - 26, 30], [0, -24]];
    const libero = ([dx, dy]) => !occupate.some(r => e.x + dx < r.x + r.w + 3 && e.x + dx + w + 3 > r.x && e.y + dy - 15 < r.y + 24 && e.y + dy + 9 > r.y);
    const [dx, dy] = prove.find(libero) || prove[0];
    e.x += dx; e.y += dy; occupate.push({x: e.x, y: e.y - 15, w});
    out += '<rect x="' + f1(e.x) + '" y="' + f1(e.y - 15) + '" width="' + w + '" height="21" rx="5" fill="#000" fill-opacity=".85" stroke="#666"/>';
    out += '<text x="' + f1(e.x + w / 2) + '" y="' + f1(e.y) + '" fill="#fff" font-size="13" font-weight="800" text-anchor="middle">' + esc(e.testo) + "</text>";
  }

  if (st.fix) {
    const b = xy(st.fix), colore = vivo ? "#ff0000" : "#7a7a7a";
    if (Number.isFinite(st.fix.accuracy)) out += '<circle cx="' + f1(b.x) + '" cy="' + f1(b.y) + '" r="' + f1(Math.max(3, st.fix.accuracy / m)) + '" fill="#ff0000" fill-opacity=".10" stroke="#ff0000" stroke-opacity=".7" stroke-width="1.5"/>';
    if (vivo && nav.cog !== null) out += '<g transform="translate(' + f1(b.x) + " " + f1(b.y) + ") rotate(" + f1(nav.cog) + ')"><path d="M0 -20 L12 14 L0 7 L-12 14Z" fill="' + colore + '" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></g>';
    else out += '<circle cx="' + f1(b.x) + '" cy="' + f1(b.y) + '" r="10" fill="' + colore + '" stroke="#fff" stroke-width="3"/>';
  }
  out += '<g transform="translate(20 ' + (H - 56) + ')"><path d="M0 -14 L7 6 L0 2 L-7 6Z" fill="#fff"/><text x="0" y="22" fill="#fff" font-size="13" font-weight="700" text-anchor="middle">N</text></g>';
  const sx = 42, sy = H - 16;
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
  st.mpp = Math.min(LIMITI_MPP[1], Math.max(1.2, larg / Math.max(60, W - 120), alt / Math.max(60, H - 90)));
  aggiorna();
}
const carta = $("carta"), puntatori = new Map();
const puntoSvg = e => { const r = carta.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; };
carta.addEventListener("pointerdown", e => { carta.setPointerCapture(e.pointerId); puntatori.set(e.pointerId, puntoSvg(e)); carta.classList.add("trascina"); });
carta.addEventListener("pointermove", e => {
  if (!puntatori.has(e.pointerId) || !st.centro) return;
  const prima = [...puntatori.values()], vecchio = puntatori.get(e.pointerId), nuovo = puntoSvg(e);
  puntatori.set(e.pointerId, nuovo);
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
const rilascia = e => { puntatori.delete(e.pointerId); if (!puntatori.size) carta.classList.remove("trascina"); };
carta.addEventListener("pointerup", rilascia);
carta.addEventListener("pointercancel", rilascia);
carta.addEventListener("wheel", e => { e.preventDefault(); const p = puntoSvg(e); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y); }, {passive: false});

// ---------------- Disegno: liste (solo quando cambiano i dati o la scheda) ----------------
function disegnaViste() { if (st.vista === "vista-regata") { disegnaCampo(); disegnaVento(); } if (st.vista === "vista-altro") disegnaAltro(); if (st.vista === "vista-polari") disegnaPolari(); }

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
  $("v-stato").textContent = t.dir === null ? "Vento non tarato: usa uno dei tre metodi qui sotto."
    : !gpsAttivo() ? "GPS fermo: le stime riprendono quando avvii il GPS."
    : motivo ? "Stima del vento in pausa: " + motivo + ". Le stime si raccolgono solo in bolina stretta confermata, con rotta stabile."
    : "Stima attiva: " + sv.nMedia + " stime negli ultimi " + v.imp.mediaMin + " minuti.";
  const cl = classificaVento(v.campioni, adesso);
  $("v-tipo").textContent = {"in raccolta": "In raccolta dati", oscillante: "Oscillante", persistente: "Persistente verso " + cl.lato, stabile: "Stabile"}[cl.tipo];
  $("v-tipo-testo").textContent = cl.testo;
  disegnaGraficoVento(adesso, sv.medio);
  const metodo = (t.fonte === "boline" ? "dalle due boline" : t.fonte) + (t.t ? ", " + etaTesto(adesso - t.t) : "");
  $("tar-stato").textContent = t.dir === null ? "Vento non tarato."
    : "Riferimento " + angolo(t.dir) + " (" + metodo + "). Boline: dritta " + (v.rif.dritta ? angolo(v.rif.dritta.cog) : "—") + ", sinistra " + (v.rif.sinistra ? angolo(v.rif.sinistra.cog) : "—") +
      ". Angolo di virata " + Math.round(t.angoloVirata) + "° " + (t.misurato ? "misurato." : "predefinito (registra le due boline per misurarlo).");
  const lp = lineaPartenza(s.boe), lf = lp && Number.isFinite(sv.medio) ? latoFavorito(lp[0], lp[1], sv.medio) : null;
  $("linea-stato").textContent = !lp ? "Segna con il GPS la barca CdR e la boa P nella sezione Boe, qui sopra."
    : !lf ? "Tara il vento per sapere quale estremo è favorito."
    : lf.favorito === "neutra" ? "Linea neutra (sbilanciamento sotto i 2°). Lunga " + Math.round(lf.lunghezza) + " m."
    : "Favorita " + (lf.favorito === "P" ? "la boa P" : "la barca CdR") + ": " + Math.round(lf.sbilanciamento) + "° di sbilanciamento, " + Math.round(lf.vantaggio) + " m più sopravvento (" +
      numero(lf.vantaggio / s.barca.lunghezza, 1) + " lunghezze). Linea lunga " + Math.round(lf.lunghezza) + " m. Ricorda: l'aria libera conta più dell'estremo favorito se lo sbilanciamento è piccolo.";
  $("imp-soglia").value = String(v.imp.soglia); $("imp-durata").value = String(v.imp.durataS); $("imp-media").value = String(v.imp.mediaMin);
  if (document.activeElement !== $("imp-lunghezza")) $("imp-lunghezza").value = String(s.barca.lunghezza);
  if (document.activeElement !== $("imp-virata")) $("imp-virata").value = String(s.barca.angoloVirata);
  $("imp-audio").setAttribute("aria-pressed", String(v.imp.audio));
  $("imp-audio").textContent = "Suono dell'allarme: " + (v.imp.audio ? "sì" : "no");
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
  for (const v of ["vista-nav", "vista-regata", "vista-polari", "vista-altro"]) $(v).hidden = v !== id;
  document.querySelectorAll(".schede button").forEach(b => { if (b.dataset.vista === id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  disegnaViste(); aggiorna();
}
document.querySelectorAll(".schede button").forEach(b => b.addEventListener("click", () => mostraVista(b.dataset.vista)));
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
  if (!confirm("Iniziare una nuova sessione? Restano il campo e le posizioni indicate dalle istruzioni; si cancellano boe rilevate, arrivo, traccia e registro. Esporta prima se vuoi conservarli.")) return;
  const campo = s.campo, boe = s.boe, barcaDati = s.barca, impVento = s.vento.imp;
  s = nuovaSessione(campo.modello);
  s.barca = barcaDati; s.vento = nuovoVento(impVento); st.allScarso = null;
  s.campo = {...campo};
  s.boe = boe.map(b => ({...b, pos: b.pos?.fonte === "istruzioni" ? b.pos : null, storico: [], osservazioni: []}));
  evento("Nuova sessione · " + campo.nome); avvisa("Nuova sessione iniziata."); modificato();
});

new ResizeObserver(aggiorna).observe(carta);
// Collegamenti della Fase 3
$("btn-bolina").addEventListener("click", () => {
  s.vento.bolina = !s.vento.bolina;
  evento(s.vento.bolina ? "Bolina stretta confermata" : "Bolina stretta terminata");
  if (s.vento.bolina && !tar().off) avvisa("Bolina confermata, ma il vento non è tarato: vai in Regata → Taratura.");
  salvaPresto(); aggiorna();
});
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
$("pol-dritta").addEventListener("click", () => taraBolina("dritta"));
$("pol-sinistra").addEventListener("click", () => taraBolina("sinistra"));
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

setInterval(aggiorna, 1000);
setInterval(() => { if (st.vista === "vista-regata") disegnaVento(); }, 2000);
setInterval(() => { if (st.vista === "vista-polari") disegnaPolariVivo(); }, 15000); // età di taratura e vento
mostraVista("vista-nav");
