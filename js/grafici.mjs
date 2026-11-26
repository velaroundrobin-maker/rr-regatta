// Grafici in SVG, uguali nell'app (tema scuro) e nel rapporto PDF (tema chiaro).
export const TEMI = {
  scuro: {testo: "#ffffff", tenue: "#b5b5b5", griglia: "#333333", grigliaForte: "#4a4a4a", linea: "#ffffff", accento: "#ff0000", fondo: "none", font: "system-ui,-apple-system,Roboto,sans-serif"},
  chiaro: {testo: "#111111", tenue: "#666666", griglia: "#dddddd", grigliaForte: "#bbbbbb", linea: "#111111", accento: "#e00000", fondo: "#ffffff", font: "Helvetica,Arial,sans-serif"}
};
const f1 = x => (Math.round(x * 10) / 10).toString();
const esc = t => String(t).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const testo = (T, x, y, t, {size = 11, anchor = "start", colore = T.tenue, peso = 400} = {}) =>
  '<text x="' + f1(x) + '" y="' + f1(y) + '" fill="' + colore + '" font-size="' + size + '" font-weight="' + peso + '" font-family="' + T.font + '" text-anchor="' + anchor + '">' + esc(t) + "</text>";
const numIt = (v, d = 1) => v.toFixed(d).replace(".", ",");

// Diagramma polare: vento dall'alto, angoli dal vento a destra, distanza dal centro = velocità.
// Griglia leggera: cerchi ogni 2 nodi (ogni 4 sopra i 10), raggi ogni 30°.
// serie: [{punti, colore, spessore, tratteggio, segni}] — punti come restituiti da polare().
export function svgPolare({W, H, serie, ottimi = null, tema = "scuro", vuoto = "", vmax = null}) {
  const T = TEMI[tema];
  let out = T.fondo !== "none" ? '<rect width="' + W + '" height="' + H + '" fill="' + T.fondo + '"/>' : "";
  const tutti = serie.flatMap(s => s.punti);
  if (!tutti.length) return out + testo(T, W / 2, H / 2, vuoto, {size: 14, anchor: "middle"});
  const top = Math.max(...tutti.map(q => q.v));
  const passo = (vmax ?? top) > 10 ? 4 : 2, vm = vmax ?? Math.max(4, Math.ceil(top / passo) * passo);
  const Rg = Math.min(W - 46, H / 2 - 18), cx = Math.max(30, (W - Rg) / 2 - 10), cy = H / 2;
  const xy = (a, v) => ({x: cx + Rg * v / vm * Math.sin(a * Math.PI / 180), y: cy - Rg * v / vm * Math.cos(a * Math.PI / 180)});
  for (let v = passo; v <= vm + 1e-9; v += passo) {
    const r = Rg * v / vm;
    out += '<path d="M' + f1(cx) + " " + f1(cy - r) + "A" + f1(r) + " " + f1(r) + " 0 0 1 " + f1(cx) + " " + f1(cy + r) + '" fill="none" stroke="' + T.griglia + '"/>';
    out += testo(T, cx - 5, cy - r + 4, v + (v + passo > vm + 1e-9 ? " kn" : ""), {anchor: "end"});
  }
  out += '<path d="M' + f1(cx) + " " + f1(cy - Rg) + "L" + f1(cx) + " " + f1(cy + Rg) + '" stroke="' + T.grigliaForte + '"/>';
  for (const a of [30, 60, 90, 120, 150]) {
    const p = xy(a, vm), q = xy(a, vm * 1.04);
    out += '<path d="M' + f1(cx) + " " + f1(cy) + "L" + f1(p.x) + " " + f1(p.y) + '" stroke="' + T.griglia + '"/>';
    out += testo(T, Math.min(W - 3, q.x + 2), q.y + (a < 90 ? 0 : a === 90 ? 4 : 10), a + "°", {anchor: q.x > W - 28 ? "end" : "start"});
  }
  out += testo(T, cx + 6, 12, "VENTO ↓", {colore: T.testo, peso: 700});
  out += testo(T, 3, H - 3, "cerchi: velocità della barca", {size: 10});
  for (const s of serie) {
    const validi = s.punti.filter(q => q.valido);
    // La linea si interrompe dove mancano angoli (più di 40° senza dati): non si inventano velocità.
    if (validi.length > 1) out += '<path d="' + validi.map((q, i) => { const p = xy(q.twa, q.v); return (i && q.twa - validi[i - 1].twa <= 40 ? "L" : "M") + f1(p.x) + " " + f1(p.y); }).join("") +
      '" fill="none" stroke="' + s.colore + '" stroke-width="' + (s.spessore ?? 3) + '" stroke-linejoin="round"' + (s.tratteggio ? ' stroke-dasharray="' + s.tratteggio + '"' : "") + "/>";
    if (s.segni === false) continue;
    for (const q of s.punti) {
      const p = xy(q.twa, q.v);
      out += q.valido ? '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="3.5" fill="' + s.colore + '"/>'
        : '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="3" fill="none" stroke="' + T.tenue + '" stroke-width="1.3"/>';
    }
  }
  if (ottimi) for (const k of ["bolina", "poppa"]) if (ottimi[k]) {
    const p = xy(ottimi[k].twa, ottimi[k].v);
    out += '<path d="M' + f1(cx) + " " + f1(cy) + "L" + f1(p.x) + " " + f1(p.y) + '" stroke="' + T.linea + '" stroke-dasharray="4 4"/><circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="7" fill="none" stroke="' + T.linea + '" stroke-width="2"/>';
  }
  return out;
}

// Traccia dell'uscita: nord in alto, scala, inizio, fine, punto della velocità massima e boe.
// punti: [[t, lat, lon, ...]]; boe: [{nome, lat, lon}]; max: {lat, lon, v}
export function svgTraccia({W, H, punti, boe = [], max = null, tema = "chiaro"}) {
  const T = TEMI[tema];
  let out = '<rect width="' + W + '" height="' + H + '" fill="' + (T.fondo === "none" ? "#000" : T.fondo) + '" stroke="' + T.grigliaForte + '"/>';
  const tutti = [...punti.map(p => [p[1], p[2]]), ...boe.map(b => [b.lat, b.lon])];
  if (tutti.length < 2) return out + testo(T, W / 2, H / 2, "Nessuna traccia registrata", {size: 14, anchor: "middle"});
  const lat0 = tutti.reduce((s, p) => s + p[0], 0) / tutti.length, k = Math.cos(lat0 * Math.PI / 180);
  const xs = tutti.map(p => p[1] * k), ys = tutti.map(p => p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const m = 28, scala = Math.min((W - 2 * m) / Math.max(maxX - minX, 1e-6), (H - 2 * m) / Math.max(maxY - minY, 1e-6));
  const ox = (W - (maxX - minX) * scala) / 2, oy = (H - (maxY - minY) * scala) / 2;
  const xy = (lat, lon) => ({x: ox + (lon * k - minX) * scala, y: H - oy - (lat - minY) * scala});
  // Griglia leggera ogni miglio (o frazione) per dare la misura.
  const mPerGrado = 111195, metriPerPx = mPerGrado / scala;
  const passi = [50, 100, 200, 250, 500, 1000, 1852, 3704, 9260], passoM = passi.find(x => x / metriPerPx >= Math.min(W, H) / 6) || 9260;
  const passoPx = passoM / metriPerPx;
  for (let x = ox % passoPx; x < W; x += passoPx) out += '<path d="M' + f1(x) + " 0V" + H + '" stroke="' + T.griglia + '" stroke-width=".6"/>';
  for (let y = H - oy % passoPx; y > 0; y -= passoPx) out += '<path d="M0 ' + f1(y) + "H" + W + '" stroke="' + T.griglia + '" stroke-width=".6"/>';
  // Traccia: si interrompe dove mancano dati per più di 30 secondi.
  let d = "", prec = null;
  for (const p of punti) { const q = xy(p[1], p[2]); d += (prec && p[0] - prec <= 30000 ? "L" : "M") + f1(q.x) + " " + f1(q.y); prec = p[0]; }
  out += '<path d="' + d + '" fill="none" stroke="' + T.linea + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>';
  for (const b of boe) {
    const q = xy(b.lat, b.lon);
    out += '<circle cx="' + f1(q.x) + '" cy="' + f1(q.y) + '" r="5" fill="none" stroke="' + T.accento + '" stroke-width="1.6"/><circle cx="' + f1(q.x) + '" cy="' + f1(q.y) + '" r="2" fill="' + T.accento + '"/>';
    out += testo(T, q.x + 8, q.y - 6, b.nome, {size: 11, colore: T.testo, peso: 700});
  }
  const a = xy(punti[0][1], punti[0][2]), z = xy(punti[punti.length - 1][1], punti[punti.length - 1][2]);
  out += '<circle cx="' + f1(a.x) + '" cy="' + f1(a.y) + '" r="5" fill="' + (T.fondo === "none" ? "#000" : T.fondo) + '" stroke="' + T.linea + '" stroke-width="2"/>' + testo(T, a.x + 8, a.y + 14, "Inizio", {colore: T.testo});
  out += '<rect x="' + f1(z.x - 4.5) + '" y="' + f1(z.y - 4.5) + '" width="9" height="9" fill="' + T.linea + '"/>' + testo(T, z.x + 8, z.y + 14, "Fine", {colore: T.testo});
  if (max) {
    const q = xy(max.lat, max.lon);
    out += '<circle cx="' + f1(q.x) + '" cy="' + f1(q.y) + '" r="5" fill="' + T.accento + '"/>' + testo(T, q.x + 8, q.y - 6, "Massima " + numIt(max.v) + " kn", {colore: T.accento, peso: 700});
  }
  // Nord e scala.
  out += '<path d="M' + (W - 22) + " 34L" + (W - 22) + ' 12M' + (W - 28) + " 20L" + (W - 22) + " 11L" + (W - 16) + ' 20" stroke="' + T.testo + '" stroke-width="2" fill="none"/>' + testo(T, W - 22, 48, "N", {anchor: "middle", colore: T.testo, peso: 700});
  const etichetta = passoM >= 1852 ? numIt(passoM / 1852, passoM % 1852 ? 1 : 0) + " M" : passoM + " m";
  out += '<path d="M14 ' + (H - 14) + "h" + f1(passoPx) + '" stroke="' + T.testo + '" stroke-width="2"/><path d="M14 ' + (H - 18) + "v8M" + f1(14 + passoPx) + " " + (H - 18) + 'v8" stroke="' + T.testo + '" stroke-width="2"/>';
  out += testo(T, 14 + passoPx / 2, H - 22, etichetta + " (quadretti)", {anchor: "middle", colore: T.testo});
  return out;
}

// Grafico nel tempo (velocità): asse orizzontale in ore e minuti, griglia ogni 2 nodi.
export function svgTempo({W, H, serie, da, a, max = null, tema = "chiaro", unita = "kn", passoY = 2}) {
  const T = TEMI[tema];
  let out = '<rect width="' + W + '" height="' + H + '" fill="' + (T.fondo === "none" ? "#000" : T.fondo) + '"/>';
  if (serie.length < 2) return out + testo(T, W / 2, H / 2, "Dati insufficienti", {size: 14, anchor: "middle"});
  const sx = 34, dx = 10, sy = 10, by = 22, top = Math.max(passoY * 2, Math.ceil((Math.max(...serie.map(p => p.v), max?.v ?? 0) + 0.2) / passoY) * passoY);
  const X = t => sx + (t - da) / Math.max(1, a - da) * (W - sx - dx), Y = v => H - by - v / top * (H - sy - by);
  for (let v = 0; v <= top + 1e-9; v += passoY) {
    out += '<path d="M' + sx + " " + f1(Y(v)) + "H" + (W - dx) + '" stroke="' + (v ? T.griglia : T.grigliaForte) + '"/>';
    out += testo(T, sx - 4, Y(v) + 4, v + (v + passoY > top + 1e-9 ? " " + unita : ""), {anchor: "end", size: 10});
  }
  const durata = a - da, passiT = [15, 30, 60, 120, 180, 240].map(x => x * 60000), passoT = passiT.find(x => durata / x <= 8) || 480 * 60000;
  const inizio = Math.ceil(da / passoT) * passoT;
  for (let t = inizio; t <= a; t += passoT) {
    const d = new Date(t), lab = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    out += '<path d="M' + f1(X(t)) + " " + sy + "V" + (H - by) + '" stroke="' + T.griglia + '"/>' + testo(T, X(t), H - 7, lab, {anchor: "middle", size: 10});
  }
  let d = "", prec = null;
  const salto = Math.max(3 * 60000, (serie[1].t - serie[0].t) * 2.5);
  for (const p of serie) { d += (prec !== null && p.t - prec <= salto ? "L" : "M") + f1(X(p.t)) + " " + f1(Y(p.v)); prec = p.t; }
  out += '<path d="' + d + '" fill="none" stroke="' + T.linea + '" stroke-width="1.4" stroke-linejoin="round"/>';
  if (max) out += '<circle cx="' + f1(X(max.t)) + '" cy="' + f1(Y(max.v)) + '" r="4" fill="' + T.accento + '"/>' + testo(T, Math.min(W - 60, X(max.t) + 6), Y(max.v) - 5, numIt(max.v) + " kn", {colore: T.accento, peso: 700, size: 10});
  return out;
}
