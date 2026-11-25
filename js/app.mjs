// RR Regatta · v0.3: navigazione GPS, campo di regata, boe, rilevamenti, arrivo, salvataggio.
import {gpsFixFromPosition, gpsErrorInfo} from "./gps.mjs?v=0.3.1";
import {markVMC, norm} from "./engine.mjs?v=0.3.1";
import {smoothNav, derivaMoto, statoDato, numero, angolo, coordinata, scalaGrafica} from "./nav.mjs?v=0.3.1";
import {MODELLI, leggiSequenza, tappe, trovaBoa, obiettivo, triangola, distanzaTesto, lineaPartenza, lineaArrivo, bearing, distanceMeters} from "./campo.mjs?v=0.3.1";
import {nuovaSessione, applicaModello, verifica, carica, salva} from "./stato.mjs?v=0.3.1";

const VERSIONE = "0.3.1";
const R = 6371008.8;
const rad = d => d * Math.PI / 180;
const $ = id => document.getElementById(id);
const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const ora = t => new Date(t).toLocaleTimeString("it-IT");
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
addEventListener("pagehide", () => salva(memoria, s));

let timerAvviso = null;
function avvisa(testo) { const el = $("avviso"); el.textContent = testo; el.hidden = false; clearTimeout(timerAvviso); timerAvviso = setTimeout(() => el.hidden = true, 3800); }

// ---------------- Stato della navigazione (non salvato) ----------------
const st = {
  watch: null, sessione: 0, fase: "fermo", problema: "", avviatoIl: 0,
  fix: null, fixes: [], origine: null,
  segui: true, centro: null, mpp: 1.2,
  mostraTraccia: false, vuoleSchermo: false, wakeLock: null,
  vista: "vista-nav", rilievo: {codice: null, lato: -1}
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
setInterval(() => { if (gpsAttivo()) salva(memoria, s); }, 15000); // traccia salvata periodicamente

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
  mostraVista("vista-campo");
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
function aggiorna() { if (!aggiorna.attesa) { aggiorna.attesa = true; setTimeout(() => { aggiorna.attesa = false; disegnaNav(); }, 30); } }

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
  $("nota-sog").textContent = nota ?? (nav.sog === null ? "in calcolo…" : "media 3 s · " + fonte.sog);
  $("nota-cog").textContent = nota ?? (nav.cog === null ? "barca ferma o lenta" : "media 3 s · " + fonte.cog);
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

  // Pulsanti in basso
  const b = $("btn-gps");
  b.textContent = attivo ? "Ferma GPS" : "Avvia GPS";
  b.classList.toggle("attivo", attivo);
  const inRegata = attivo && !s.arrivo.taglio && ob.tappa;
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
  if (st.vista === "vista-campo" && !$("blocco-rilievo").hidden) disegnaAnteprimaRilievo(nav);
  if (st.vista === "vista-nav") disegnaCarta(nav, attivo && dato === "vivo", ob);
}

// ---------------- Mappa ----------------
function disegnaCarta(nav, vivo, ob) {
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
function disegnaViste() { if (st.vista === "vista-campo") disegnaCampo(); if (st.vista === "vista-altro") disegnaAltro(); }

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
  for (const v of ["vista-nav", "vista-campo", "vista-altro"]) $(v).hidden = v !== id;
  document.querySelectorAll(".schede button").forEach(b => { if (b.dataset.vista === id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  disegnaViste(); aggiorna();
}
document.querySelectorAll(".schede button").forEach(b => b.addEventListener("click", () => mostraVista(b.dataset.vista)));
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
  const url = URL.createObjectURL(new Blob([JSON.stringify({...s, esportata: d.toISOString(), app: "RR Regatta " + VERSIONE}, null, 1)], {type: "application/json"}));
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
    delete obj.esportata; delete obj.app;
    s = obj; evento("Sessione importata: " + file.name); avvisa("Sessione importata."); modificato();
  } catch (err) { avvisa("File non valido: " + err.message + "."); }
});
$("btn-nuova").addEventListener("click", () => {
  if (!confirm("Iniziare una nuova sessione? Restano il campo e le posizioni indicate dalle istruzioni; si cancellano boe rilevate, arrivo, traccia e registro. Esporta prima se vuoi conservarli.")) return;
  const campo = s.campo, boe = s.boe;
  s = nuovaSessione(campo.modello);
  s.campo = {...campo};
  s.boe = boe.map(b => ({...b, pos: b.pos?.fonte === "istruzioni" ? b.pos : null, storico: [], osservazioni: []}));
  evento("Nuova sessione · " + campo.nome); avvisa("Nuova sessione iniziata."); modificato();
});

new ResizeObserver(aggiorna).observe(carta);
setInterval(aggiorna, 1000);
mostraVista("vista-nav");
