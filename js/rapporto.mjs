// Statistiche di un'uscita per il rapporto PDF (v0.10). Tutto si calcola dai dati salvati sul telefono:
// registro (un punto ogni 2 s: [t, lat, lon, velocità kn, rotta, precisione m, bolina 0/1]), eventi, punti delle polari.
export const PAUSA_USCITA_MS = 2 * 3600000; // più di 2 ore senza dati separano due uscite
export const VELOCITA_MOTO = 1;             // nodi: sotto, la barca è ferma
const R = 6371000, rad = x => x * Math.PI / 180;
const metri = (p, q) => Math.hypot(rad(q[2] - p[2]) * R * Math.cos(rad(p[1])), rad(q[1] - p[1]) * R);

// Uscite: gruppi di istanti senza pause più lunghe di 2 ore. La più recente è l'ultima.
export function uscite(tempi, pausa = PAUSA_USCITA_MS) {
  const o = tempi.filter(Number.isFinite).sort((a, b) => a - b), out = [];
  for (const t of o) { const u = out[out.length - 1]; if (u && t - u.a <= pausa) u.a = t; else out.push({da: t, a: t}); }
  return out;
}
export const tempiDati = (s, pol) => [...(s.registro || []).map(p => p[0]), ...(s.traccia || []).map(p => p.t), ...(pol?.campioni || []).map(c => c[0])];
export const dentro = (t, f, margine = 0) => t >= f.da - margine && t <= f.a + margine;

// Distanza, tempo in movimento, velocità media e massima (media su 10 s), tempo in bolina stretta, serie per il grafico.
export function statistiche(registro, f) {
  const r = registro.filter(p => dentro(p[0], f) && Number.isFinite(p[1]) && Number.isFinite(p[2]));
  let distanza = 0, movimento = 0, bolina = 0, max = null;
  for (let i = 1; i < r.length; i++) {
    const p = r[i - 1], q = r[i], dt = q[0] - p[0];
    if (dt <= 0 || dt > 10000) continue;
    if (q[6] === 1) bolina += dt;
    if ((p[5] ?? 0) > 30 || (q[5] ?? 0) > 30) continue; // posizioni imprecise: non si contano
    if (((p[3] ?? 0) + (q[3] ?? 0)) / 2 >= VELOCITA_MOTO) { distanza += metri(p, q); movimento += dt; }
  }
  // Velocità massima: la media più alta su 10 secondi di punti consecutivi (niente punte isolate del GPS).
  let i = 0, somma = 0;
  for (let j = 0; j < r.length; j++) {
    if (!Number.isFinite(r[j][3])) { i = j + 1; somma = 0; continue; }
    if (j > i && r[j][0] - r[j - 1][0] > 4500) { i = j; somma = 0; }
    somma += r[j][3];
    while (i < j && r[j][0] - r[i][0] > 10000) { somma -= r[i][3]; i++; }
    if (r[j][0] - r[i][0] >= 8000) { const v = somma / (j - i + 1); if (!max || v > max.v) max = {v, t: r[j][0], lat: r[j][1], lon: r[j][2]}; }
  }
  // Serie per il grafico: media per intervalli (almeno 30 s, al massimo circa 400 intervalli).
  const passo = Math.max(30000, Math.ceil((f.a - f.da) / 400 / 30000) * 30000), gruppi = new Map();
  for (const p of r) if (Number.isFinite(p[3])) { const k = Math.floor((p[0] - f.da) / passo); const g = gruppi.get(k) || [0, 0]; g[0] += p[3]; g[1]++; gruppi.set(k, g); }
  const serie = [...gruppi].sort((a, b) => a[0] - b[0]).map(([k, g]) => ({t: f.da + (k + 0.5) * passo, v: g[0] / g[1]}));
  return {da: f.da, a: f.a, durata: f.a - f.da, distanzaNm: distanza / 1852, movimentoMs: movimento,
    mediaKn: movimento > 60000 ? distanza / 1852 / (movimento / 3600000) : null, max, bolinaMs: bolina, serie, punti: r.length};
}
// Distanza percorsa in movimento fra due istanti.
function distanzaFra(registro, t0, t1) {
  let d = 0, prec = null;
  for (const q of registro) {
    if (q[0] < t0 || q[0] > t1) continue;
    if (prec && q[0] - prec[0] <= 10000 && ((prec[3] ?? 0) + (q[3] ?? 0)) / 2 >= VELOCITA_MOTO) d += metri(prec, q);
    prec = q;
  }
  return d / 1852;
}

const ordinati = (eventi, f, margine = 10 * 60000) => [...eventi].filter(e => dentro(e.t, f, margine)).sort((a, b) => a.t - b.t);

// Prove: dalla partenza (timer) alle boe passate e all'arrivo, con durata, distanza e velocità media di ogni tratto.
export function prove(eventi, registro, f) {
  const out = [];
  let prova = null;
  const tappa = (nome, t) => {
    const ultimo = prova.passaggi[prova.passaggi.length - 1];
    const durata = t - ultimo.t, nm = distanzaFra(registro, ultimo.t, t);
    prova.passaggi.push({nome, t, durata, distanzaNm: nm, mediaKn: durata > 0 ? nm / (durata / 3600000) : null});
  };
  for (const e of ordinati(eventi, f)) {
    const passata = /^Passata (\S+)/.exec(e.testo), cancello = /^Cancello/.test(e.testo);
    if (/^PARTENZA/.test(e.testo)) { prova = {partenza: e.t, passaggi: [{nome: "Partenza", t: e.t}], arrivo: null}; out.push(prova); }
    else if (passata || cancello) {
      if (!prova || prova.arrivo) { prova = {partenza: null, passaggi: [{nome: passata ? "Boa " + passata[1] : "Cancello", t: e.t}], arrivo: null}; out.push(prova); }
      else tappa(passata ? "Boa " + passata[1] : "Cancello", e.t);
    } else if (/^ARRIVO/.test(e.testo) && prova && !prova.arrivo) { tappa("Arrivo", e.t); prova.arrivo = e.t; }
  }
  for (const p of out) p.tempo = p.partenza && p.arrivo ? p.arrivo - p.partenza : null;
  return out;
}

// Vele usate: dai cambi di vele e di propulsione registrati (eventi «Vele: …», «Propulsione: a motore / a vela»)
// e dai punti delle polari della sessione.
export function veleUsate(eventi, f, puntiPolari = [], nomi = []) {
  const cambi = [...eventi].filter(e => /^(Vele: |Propulsione: )/.test(e.testo)).sort((a, b) => a.t - b.t);
  const durate = new Map(), ordine = [];
  const somma = (nome, ms) => { if (ms <= 0) return; if (!durate.has(nome)) { durate.set(nome, 0); ordine.push(nome); } durate.set(nome, durate.get(nome) + ms); };
  let vele = null, motore = false, da = f.da;
  const attuale = () => motore ? "A motore" : vele;
  const applica = e => { if (e.testo.startsWith("Vele: ")) { vele = e.testo.slice(6); motore = false; } else motore = /a motore/.test(e.testo); };
  for (const e of cambi) {
    if (e.t <= f.da) { applica(e); continue; }
    if (e.t > f.a) break;
    if (attuale()) somma(attuale(), e.t - da);
    applica(e); da = e.t;
  }
  if (attuale()) somma(attuale(), f.a - da);
  const polari = new Map();
  for (const c of puntiPolari) if (dentro(c[0], f)) polari.set(c[4], (polari.get(c[4]) || 0) + 2000);
  return {aBordo: ordine.map(nome => ({nome, ms: durate.get(nome)})), polari: [...polari].map(([k, ms]) => ({k, nome: nomi[k] ?? "?", ms})).sort((a, b) => b.ms - a.ms)};
}

// Finestre per i rapporti e per le polari della sessione: le registrazioni (la più recente per ultima);
// per i dati di versioni senza registrazioni, le uscite separate da pause di oltre 2 ore.
export function finestre(s, pol, adesso = Date.now()) {
  const reg = (s.registrazioni || []).map(r => ({da: r.inizio, a: r.fine ?? adesso, modo: r.modo, inCorso: r.fine === null}));
  if (reg.length) return reg;
  return uscite(tempiDati(s, pol)).map(u => ({...u, modo: null, inCorso: false}));
}

// Eventi del vento (tarature, andature dichiarate, intensità, allarmi) e modalità usate.
const VENTO = /^(Vento a motore|Bolina stretta mure|Bolina mure|Andatura dichiarata|Andatura confermata|Nuovo riferimento|Vento impostato a mano|Taratura del vento azzerata|Vento a barca ferma|ALLARME|Angolo di virata)/;
export const eventiVento = (eventi, f) => ordinati(eventi, f).filter(e => VENTO.test(e.testo));
export const modalita = (eventi, f) => [...new Set(ordinati(eventi, f).map(e => /^Modalità (.+)/.exec(e.testo)?.[1]).filter(Boolean))];
export const eventiUscita = (eventi, f) => ordinati(eventi, f);
