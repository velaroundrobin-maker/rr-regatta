// RR Regatta · Fase 1: posizione, rotta e velocità GPS, mappa con zoom e «Barca».
import {gpsFixFromPosition, gpsErrorInfo} from "./gps.mjs";
import {smoothNav, derivaMoto, statoDato, numero, angolo, coordinata, scalaGrafica} from "./nav.mjs";

const VERSIONE = "0.2";
const R = 6371008.8;
const rad = d => d * Math.PI / 180;
const $ = id => document.getElementById(id);

const st = {
  watch: null, sessione: 0, fase: "fermo", problema: "", avviatoIl: 0,
  fix: null, fixes: [], traccia: [], origine: null,
  segui: true, centro: null, mpp: 1.2, // metri per pixel
  mostraTraccia: false, vuoleSchermo: false, wakeLock: null
};

// Errori del programma sempre visibili: niente più schermate mute.
function mostraErrore(testo) { const el = $("avviso-errore"); el.textContent = "Errore del programma: " + testo; el.hidden = false; }
addEventListener("error", e => mostraErrore(e.message || "sconosciuto"));
addEventListener("unhandledrejection", e => mostraErrore((e.reason && e.reason.message) || String(e.reason)));

$("versione").textContent = "versione " + VERSIONE;

// ---------------- GPS ----------------
function avviaGps() {
  if (st.watch !== null) { fermaGps(); return; }
  if (!("geolocation" in navigator) || !window.isSecureContext) {
    st.fase = "errore"; st.problema = "Questo browser non può usare il GPS (serve Chrome e un indirizzo https).";
    aggiorna(); return;
  }
  const sessione = ++st.sessione;
  st.fase = "cerca"; st.problema = ""; st.avviatoIl = Date.now(); st.segui = true;
  try {
    st.watch = navigator.geolocation.watchPosition(
      p => puntoRicevuto(p, sessione), e => erroreGps(e, sessione),
      {enableHighAccuracy: true, maximumAge: 0, timeout: 30000});
  } catch (e) { st.fase = "errore"; st.problema = "Impossibile avviare il GPS: " + e.message; st.watch = null; }
  aggiorna();
}
function fermaGps() {
  st.sessione++;
  if (st.watch !== null) navigator.geolocation.clearWatch(st.watch);
  st.watch = null; st.fase = "fermo";
  aggiorna();
}
function puntoRicevuto(pos, sessione) {
  if (sessione !== st.sessione) return;
  const adesso = Date.now();
  // Solo i valori forniti dal telefono; quelli mancanti si ricavano dagli spostamenti degli ultimi secondi.
  const fix = gpsFixFromPosition(pos, null, adesso);
  if (!fix) return;
  fix.fonte = {sog: Number.isFinite(fix.sog) ? "telefono" : "calcolata", cog: Number.isFinite(fix.cog) ? "telefono" : "calcolata"};
  if (!Number.isFinite(fix.sog) || !Number.isFinite(fix.cog)) {
    const d = derivaMoto(st.fixes, fix);
    if (!Number.isFinite(fix.sog)) fix.sog = d.sog;
    if (!Number.isFinite(fix.cog)) fix.cog = d.cog;
  }
  // Un punto approssimato (rete) arrivato in ritardo non deve scavalcare un buon punto satellitare.
  if (st.fix && Number.isFinite(fix.accuracy) && Number.isFinite(st.fix.accuracy) &&
      fix.accuracy > st.fix.accuracy * 3 && adesso - st.fix.received < 12000) return;
  fix.received = adesso;
  st.fix = fix; st.fase = "vivo"; st.problema = "";
  st.fixes.push(fix);
  while (st.fixes.length && adesso - st.fixes[0].received > 30000) st.fixes.shift();
  if (!st.origine) st.origine = {lat: fix.lat, lon: fix.lon};
  const u = st.traccia[st.traccia.length - 1];
  if (!u || (adesso - u.t > 2000 && metri(u, fix) > 2)) {
    st.traccia.push({lat: fix.lat, lon: fix.lon, t: adesso});
    if (st.traccia.length > 4000) st.traccia.shift();
  }
  aggiorna();
}
function erroreGps(err, sessione) {
  if (sessione !== st.sessione) return;
  const info = gpsErrorInfo(err);
  if (info.terminal) { fermaGps(); st.fase = "errore"; st.problema = info.detail; }
  else if (!st.fix) st.problema = info.detail; // la ricerca continua
  aggiorna();
}
const metri = (a, b) => Math.hypot(rad(b.lon - a.lon) * R * Math.cos(rad(a.lat)), rad(b.lat - a.lat) * R);

// ---------------- Schermo sempre acceso ----------------
async function chiediSchermo() {
  try { st.wakeLock = await navigator.wakeLock.request("screen"); st.wakeLock.addEventListener("release", () => { st.wakeLock = null; aggiornaOpzioni(); }); }
  catch { st.wakeLock = null; }
  aggiornaOpzioni();
}
async function cambiaSchermo() {
  if (!("wakeLock" in navigator)) { $("btn-schermo").textContent = "Schermo acceso: non supportato"; return; }
  st.vuoleSchermo = !st.vuoleSchermo;
  if (st.vuoleSchermo) await chiediSchermo();
  else { try { await st.wakeLock?.release(); } catch {} st.wakeLock = null; aggiornaOpzioni(); }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && st.vuoleSchermo && !st.wakeLock) chiediSchermo();
  aggiorna();
});
function aggiornaOpzioni() {
  const s = $("btn-schermo"), attivo = st.vuoleSchermo && !!st.wakeLock;
  s.setAttribute("aria-pressed", String(attivo));
  s.textContent = "Schermo acceso: " + (attivo ? "sì" : st.vuoleSchermo ? "in attesa" : "no");
  const t = $("btn-traccia");
  t.setAttribute("aria-pressed", String(st.mostraTraccia));
  t.textContent = "Traccia: " + (st.mostraTraccia ? "sì" : "no");
}

// ---------------- Visualizzazione ----------------
function aggiorna() { if (!aggiorna.attesa) { aggiorna.attesa = true; requestAnimationFrame(() => { aggiorna.attesa = false; disegna(); }); } }

function disegna() {
  const adesso = Date.now();
  const eta = st.fix ? adesso - st.fix.received : NaN;
  const dato = st.fix ? statoDato(eta) : "assente";
  const attivo = st.watch !== null;

  // Stato GPS nella testata
  const pill = $("stato-gps"), sec = Math.floor(eta / 1000);
  let classe = "", testo = "GPS fermo";
  if (st.fase === "errore") { classe = "problema"; testo = "GPS non disponibile"; }
  else if (attivo && !st.fix) { classe = "cerca"; testo = "Ricerca GPS… " + Math.floor((adesso - st.avviatoIl) / 1000) + " s"; }
  else if (attivo && dato === "vivo") { classe = "vivo"; testo = "GPS ±" + Math.round(st.fix.accuracy ?? 0) + " m"; }
  else if (attivo) { classe = "problema"; testo = "Nessun punto da " + sec + " s"; }
  pill.className = "stato-gps " + classe;
  $("stato-gps-testo").textContent = testo;

  // Strumenti: valori solo se il dato è recente e il GPS è attivo
  const nav = smoothNav(st.fixes);
  const mostra = attivo && (dato === "vivo" || dato === "vecchio");
  const vecchio = attivo && dato === "vecchio";
  $("sog").textContent = mostra && nav.sog !== null ? numero(nav.sog, 1) : "—";
  $("cog").textContent = mostra && nav.cog !== null ? angolo(nav.cog) : "—";
  const nota = !attivo ? "GPS fermo" : !st.fix ? "in attesa del GPS" : dato === "vecchio" ? "dato vecchio · " + sec + " s" : dato === "perso" ? "segnale perso" : null;
  const fonte = st.fix?.fonte || {};
  $("nota-sog").textContent = nota ?? (nav.sog === null ? "in calcolo…" : "media 3 s · " + fonte.sog);
  $("nota-cog").textContent = nota ?? (nav.cog === null ? "barca ferma o lenta" : "media 3 s · " + fonte.cog);
  $("cella-sog").classList.toggle("vecchio", vecchio);
  $("cella-cog").classList.toggle("vecchio", vecchio);

  // Pulsante principale
  const b = $("btn-gps");
  b.textContent = attivo ? "Ferma GPS" : "Avvia GPS";
  b.classList.toggle("attivo", attivo);
  $("segui").classList.toggle("attivo", st.segui && !!st.fix);

  // Messaggio sulla mappa quando non c'è posizione
  const msg = $("mappa-messaggio");
  msg.hidden = !!st.fix;
  msg.classList.toggle("problema", st.fase === "errore" || (!!st.problema && attivo));
  if (!st.fix) {
    $("messaggio-titolo").textContent = st.fase === "errore" ? "GPS non disponibile" : attivo ? "Ricerca della posizione…" : "Premi «Avvia GPS»";
    $("messaggio-testo").textContent = st.problema || (attivo ? "Se compare la richiesta, rispondi «Consenti». All'aperto il primo punto arriva in pochi secondi." : "La posizione della barca comparirà qui.");
  }

  // Riquadro coordinate
  $("riquadro-pos").hidden = !st.fix;
  if (st.fix) {
    $("lat").textContent = coordinata(st.fix.lat, true);
    $("lon").textContent = coordinata(st.fix.lon, false);
    $("precisione").textContent = (dato === "vivo" ? "" : "ultima posizione · ") + "±" + Math.round(st.fix.accuracy ?? 0) + " m";
  }
  disegnaCarta(nav, attivo && dato === "vivo");
}

function disegnaCarta(nav, vivo) {
  const svg = $("carta"), W = svg.clientWidth, H = svg.clientHeight;
  if (!W || !H) return;
  if (!st.fix) { svg.innerHTML = ""; return; }
  if (st.segui || !st.centro) st.centro = {lat: st.fix.lat, lon: st.fix.lon};
  const c = st.centro, k = Math.cos(rad(c.lat)), m = st.mpp;
  const xy = p => ({x: W / 2 + rad(p.lon - c.lon) * R * k / m, y: H / 2 - rad(p.lat - c.lat) * R / m});
  const sc = scalaGrafica(m, Math.min(110, W * 0.28));
  let out = "";

  // Reticolo fisso sul fondo (si muove con la barca): passo uguale alla scala grafica.
  const o = st.origine, g = sc.metri;
  const cx = rad(c.lon - o.lon) * R * k, cy = rad(c.lat - o.lat) * R; // centro in metri dall'origine
  const x0 = cx - W / 2 * m, x1 = cx + W / 2 * m, y0 = cy - H / 2 * m, y1 = cy + H / 2 * m;
  let linee = "";
  for (let x = Math.ceil(x0 / g) * g; x <= x1; x += g) { const px = (W / 2 + (x - cx) / m).toFixed(1); linee += "M" + px + " 0V" + H; }
  for (let y = Math.ceil(y0 / g) * g; y <= y1; y += g) { const py = (H / 2 - (y - cy) / m).toFixed(1); linee += "M0 " + py + "H" + W; }
  out += '<path d="' + linee + '" stroke="#ffffff" stroke-opacity=".08" stroke-width="1" fill="none"/>';

  if (st.mostraTraccia && st.traccia.length > 1) {
    out += '<polyline points="' + st.traccia.map(p => { const q = xy(p); return q.x.toFixed(1) + "," + q.y.toFixed(1); }).join(" ") +
      '" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="2" stroke-linejoin="round"/>';
  }

  const b = xy(st.fix);
  if (Number.isFinite(st.fix.accuracy)) out += '<circle cx="' + b.x.toFixed(1) + '" cy="' + b.y.toFixed(1) + '" r="' + Math.max(3, st.fix.accuracy / m).toFixed(1) + '" fill="#ff0000" fill-opacity=".10" stroke="#ff0000" stroke-opacity=".7" stroke-width="1.5"/>';
  const colore = vivo ? "#ff0000" : "#7a7a7a";
  if (vivo && nav.cog !== null) {
    out += '<g transform="translate(' + b.x.toFixed(1) + " " + b.y.toFixed(1) + ") rotate(" + nav.cog.toFixed(1) + ')"><path d="M0 -20 L12 14 L0 7 L-12 14Z" fill="' + colore + '" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></g>';
  } else {
    out += '<circle cx="' + b.x.toFixed(1) + '" cy="' + b.y.toFixed(1) + '" r="10" fill="' + colore + '" stroke="#fff" stroke-width="3"/>';
  }

  // Nord e scala grafica
  out += '<g transform="translate(22 ' + (H - 58) + ')"><path d="M0 -14 L7 6 L0 2 L-7 6Z" fill="#fff"/><text x="0" y="22" fill="#fff" font-size="13" font-weight="700" text-anchor="middle">N</text></g>';
  const sx = 44, sy = H - 18;
  out += '<path d="M' + sx + " " + (sy - 6) + "v6h" + sc.pixel.toFixed(1) + 'v-6" fill="none" stroke="#fff" stroke-width="2"/>';
  out += '<text x="' + (sx + sc.pixel / 2).toFixed(1) + '" y="' + (sy - 10) + '" fill="#fff" font-size="13" font-weight="700" text-anchor="middle">' + sc.etichetta + "</text>";
  svg.innerHTML = out;
}

// ---------------- Interazione con la mappa ----------------
const LIMITI_MPP = [0.05, 150];
function spostaCentro(dxMetri, dyMetri) {
  const c = st.centro; if (!c) return;
  st.centro = {lat: c.lat + dyMetri / R * 180 / Math.PI, lon: c.lon + dxMetri / (R * Math.cos(rad(c.lat))) * 180 / Math.PI};
}
function zoom(fattore, ax, ay) {
  const svg = $("carta"), W = svg.clientWidth, H = svg.clientHeight;
  if (ax === undefined) { ax = W / 2; ay = H / 2; }
  const prima = st.mpp, dopo = Math.min(LIMITI_MPP[1], Math.max(LIMITI_MPP[0], prima / fattore));
  if (!st.segui && st.centro) spostaCentro((ax - W / 2) * (prima - dopo), -(ay - H / 2) * (prima - dopo));
  st.mpp = dopo; aggiorna();
}
const carta = $("carta"), puntatori = new Map();
const puntoSvg = e => { const r = carta.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; };
carta.addEventListener("pointerdown", e => { carta.setPointerCapture(e.pointerId); puntatori.set(e.pointerId, puntoSvg(e)); carta.classList.add("trascina"); });
carta.addEventListener("pointermove", e => {
  if (!puntatori.has(e.pointerId) || !st.fix) return;
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

$("zoom-piu").addEventListener("click", () => zoom(1.5));
$("zoom-meno").addEventListener("click", () => zoom(1 / 1.5));
$("segui").addEventListener("click", () => { st.segui = true; aggiorna(); });
$("btn-gps").addEventListener("click", avviaGps);
$("btn-schermo").addEventListener("click", cambiaSchermo);
$("btn-traccia").addEventListener("click", () => { st.mostraTraccia = !st.mostraTraccia; aggiornaOpzioni(); aggiorna(); });
new ResizeObserver(aggiorna).observe(carta);
setInterval(aggiorna, 1000); // età del dato e tempo di ricerca
aggiornaOpzioni();
aggiorna();
