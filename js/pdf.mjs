// Rapporto PDF di un'uscita (v0.10): riepilogo, traccia, velocità, prove, vento, vele, polari della sessione e record,
// registro. Si crea sul telefono con jsPDF (lib/jspdf.umd.min.js, licenza MIT), caricato solo quando serve.
import {statistiche, prove, veleUsate, eventiVento, modalita, eventiUscita, dentro} from "./rapporto.mjs?v=0.10";
import {polare, ottimi, classiConDati, CLASSI_ANGOLO, nomeVele} from "./polari.mjs?v=0.10";
import {svgTraccia, svgTempo, svgPolare} from "./grafici.mjs?v=0.10";

const A4 = {w: 210, h: 297}, M = 14, L = A4.w - 2 * M, ROSSO = [224, 0, 0], GRIGIO = [110, 110, 110];
const num = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d).replace(".", ",") : "—";
const ora = t => new Date(t).toLocaleTimeString("it-IT", {hour: "2-digit", minute: "2-digit"});
const oraS = t => new Date(t).toLocaleTimeString("it-IT", {hour: "2-digit", minute: "2-digit", second: "2-digit"});
const data = t => new Date(t).toLocaleDateString("it-IT", {day: "2-digit", month: "2-digit", year: "numeric"});
const durata = ms => { if (!Number.isFinite(ms)) return "—"; const m = Math.round(ms / 60000), h = Math.floor(m / 60); return h ? h + " h " + String(m % 60).padStart(2, "0") + " min" : m + " min"; };
const tempoGara = ms => { const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s % 60).padStart(2, "0"); };
// I caratteri standard del PDF non hanno alcuni simboli: si sostituiscono con equivalenti.
const pulisci = t => String(t).replace(/−/g, "-").replace(/[′’]/g, "'").replace(/″/g, '"').replace(/≈/g, "~").replace(/★/g, "*").replace(/→/g, "->").replace(/↶/g, "").replace(/[^\x00-\xff€™–—…·•‘“”]/g, "");

let caricamento = null;
function caricaJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  caricamento ??= new Promise((ok, ko) => {
    const sc = document.createElement("script");
    sc.src = new URL("../lib/jspdf.umd.min.js?v=0.10", import.meta.url).href;
    sc.onload = () => window.jspdf?.jsPDF ? ok(window.jspdf.jsPDF) : ko(new Error("libreria PDF non disponibile"));
    sc.onerror = () => { caricamento = null; ko(new Error("libreria PDF non scaricata: serve la connessione")); };
    document.head.append(sc);
  });
  return caricamento;
}
// SVG → immagine PNG (tre volte la risoluzione, per la stampa).
async function png(svg, W, H, scala = 3) {
  const testo = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">' + svg + "</svg>";
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(testo);
  await img.decode();
  const c = document.createElement("canvas"); c.width = Math.round(W * scala); c.height = Math.round(H * scala);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}
async function logo() {
  try {
    const img = new Image(); img.src = new URL("../round-robin-logo.png", import.meta.url).href; await img.decode();
    const c = document.createElement("canvas"); c.width = c.height = 240;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 240, 240); g.drawImage(img, 0, 0, 240, 240);
    return c.toDataURL("image/png");
  } catch { return null; }
}

export async function creaRapporto({s, pol, finestra: f, versione}) {
  const JsPDF = await caricaJsPdf();
  const doc = new JsPDF({unit: "mm", format: "a4", compress: true});
  doc.setProperties({title: "RR Regatta - rapporto dell'uscita del " + data(f.da), creator: "RR Regatta " + versione + " - Round Robin Labs"});
  let y = M;
  const testo = (t, x, yy, {size = 10, bold = false, colore = [17, 17, 17], allinea = "left", larghezza = null} = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...colore);
    const righe = Array.isArray(t) ? t.map(pulisci) : larghezza ? doc.splitTextToSize(pulisci(t), larghezza) : pulisci(t);
    doc.text(righe, x, yy, {align: allinea, baseline: "alphabetic"});
    return Array.isArray(righe) ? righe.length : 1;
  };
  const nuovaPagina = () => { doc.addPage(); y = M + 2; };
  const spazio = h => { if (y + h > A4.h - 16) nuovaPagina(); };
  const sezione = (titolo, contenuto = 20) => { // il titolo non resta mai da solo in fondo alla pagina
    spazio(contenuto + 14); y += 5;
    doc.setFillColor(...ROSSO); doc.rect(M, y - 4.2, 1.4, 5.4, "F");
    testo(titolo, M + 3.5, y, {size: 13, bold: true}); y += 6;
  };
  const nota = t => { const n = doc.splitTextToSize(pulisci(t), L).length; spazio(n * 4.2 + 1); testo(t, M, y, {size: 8.5, colore: GRIGIO, larghezza: L}); y += n * 4 + 1.5; };
  // Tabella con intestazione ripetuta a ogni pagina e testo a capo nell'ultima colonna.
  const tabella = (colonne, righe, {size = 9} = {}) => {
    const lh = size * 0.42, intest = () => {
      doc.setDrawColor(150); doc.setLineWidth(0.3);
      let x = M; for (const c of colonne) { testo(c.titolo, c.destra ? x + c.w - 1 : x + 1, y, {size: size - 0.5, bold: true, colore: GRIGIO, allinea: c.destra ? "right" : "left"}); x += c.w; }
      doc.line(M, y + 1.6, M + L, y + 1.6); y += lh + 2.6;
    };
    spazio(lh * 3 + 6); intest();
    for (const r of righe) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(size);
      const ultima = doc.splitTextToSize(pulisci(r[r.length - 1] ?? ""), colonne[colonne.length - 1].w - 2);
      const h = Math.max(1, ultima.length) * lh + 1.6;
      if (y + h > A4.h - 16) { nuovaPagina(); intest(); }
      let x = M;
      colonne.forEach((c, i) => {
        const v = r[i] ?? "";
        if (i === colonne.length - 1) testo(ultima, x + 1, y, {size});
        else testo(String(v), c.destra ? x + c.w - 1 : x + 1, y, {size, bold: !!c.forte, allinea: c.destra ? "right" : "left"});
        x += c.w;
      });
      doc.setDrawColor(225); doc.setLineWidth(0.2); doc.line(M, y + h - lh + 0.2, M + L, y + h - lh + 0.2);
      y += h;
    }
    y += 1.5;
  };
  const immagine = async (svg, W, H, wmm) => {
    const hmm = wmm * H / W; spazio(hmm + 2);
    doc.addImage(await png(svg, W, H), "PNG", M, y, wmm, hmm, undefined, "FAST"); y += hmm + 3;
  };

  // ---------- Dati ----------
  const reg = s.registro || [], stat = statistiche(reg, f);
  const ev = s.eventi || [], gare = prove(ev, reg, f), vento = eventiVento(ev, f), modi = modalita(ev, f);
  const nomiCfg = pol.configurazioni.map(nomeVele), vele = veleUsate(ev, f, pol.campioni, nomiCfg);
  const punti = reg.filter(p => dentro(p[0], f) && Number.isFinite(p[1]));
  const box = punti.length ? {la0: Math.min(...punti.map(p => p[1])), la1: Math.max(...punti.map(p => p[1])), lo0: Math.min(...punti.map(p => p[2])), lo1: Math.max(...punti.map(p => p[2]))} : null;
  const vicina = b => box && b.lat > box.la0 - 0.01 && b.lat < box.la1 + 0.01 && b.lon > box.lo0 - 0.014 && b.lon < box.lo1 + 0.014; // circa 1 km
  const boe = (s.boe || []).filter(b => b.pos && Number.isFinite(b.pos.lat)).map(b => ({nome: b.codice === "CdR" ? "Comitato" : b.codice === "P" ? "Pin" : b.codice, lat: b.pos.lat, lon: b.pos.lon})).filter(vicina);

  // ---------- Pagina 1: intestazione, riepilogo, traccia ----------
  const lg = await logo();
  if (lg) doc.addImage(lg, "PNG", M, 9, 15, 15);
  testo("Rapporto dell'uscita", M + 19, 16, {size: 17, bold: true});
  testo("RR Regatta · Round Robin Labs™ · Round Robin A.S.D.", M + 19, 21.5, {size: 9, colore: GRIGIO});
  testo(data(f.da), M + L, 15.5, {size: 12, bold: true, allinea: "right"});
  testo(ora(f.da) + "–" + ora(f.a) + (data(f.a) !== data(f.da) ? " del " + data(f.a) : ""), M + L, 21.5, {size: 10, allinea: "right"});
  doc.setFillColor(...ROSSO); doc.rect(M, 26, L, 0.9, "F");
  y = 34;
  const celle = [
    ["Durata", durata(stat.durata)], ["In movimento", durata(stat.movimentoMs)], ["Distanza", num(stat.distanzaNm) + " M"],
    ["Velocità media in movimento", stat.mediaKn ? num(stat.mediaKn) + " kn" : "—"],
    ["Velocità massima (media su 10 s)", stat.max ? num(stat.max.v) + " kn alle " + ora(stat.max.t) : "—"],
    ["Bolina stretta con le stime attive", durata(stat.bolinaMs)]];
  celle.forEach(([k, v], i) => {
    const x = M + (i % 3) * (L / 3), yy = y + Math.floor(i / 3) * 14;
    testo(k, x, yy, {size: 8.5, colore: GRIGIO}); testo(v, x, yy + 6, {size: 13, bold: true});
  });
  y += 30;
  const righeInfo = [];
  if (modi.length) righeInfo.push(["Modalità", modi.join(", ")]);
  if (boe.length && s.campo?.nome) righeInfo.push(["Campo", s.campo.nome + " · " + s.campo.sequenza]);
  if (gare.length) righeInfo.push(["Prove", gare.length + (gare.some(g => g.tempo) ? " · tempo: " + gare.filter(g => g.tempo).map(g => tempoGara(g.tempo)).join(", ") : "")]);
  if (vento.length) righeInfo.push(["Vento", vento.filter(e => !/^ALLARME/.test(e.testo)).length + " tra tarature e indicazioni · " + (n => n === 1 ? "1 allarme" : n + " allarmi")(vento.filter(e => /^ALLARME/.test(e.testo)).length)]);
  for (const [k, v] of righeInfo) { testo(k, M, y, {size: 9, colore: GRIGIO}); y += testo(v, M + 30, y, {size: 9.5, larghezza: L - 30}) * 4.4 + 0.8; }
  sezione("Traccia", 136);
  await immagine(svgTraccia({W: 728, H: 520, punti, boe, max: stat.max}), 728, 520, L);
  nota("Traccia dal GPS del telefono, nord in alto. Il punto rosso è dove la barca ha tenuto la velocità più alta per 10 secondi.");

  // ---------- Velocità, prove, vento, vele ----------
  sezione("Velocità nel tempo", 64);
  await immagine(svgTempo({W: 728, H: 230, serie: stat.serie, da: f.da, a: f.a, max: stat.max}), 728, 230, L);
  nota("Velocità sul fondo in nodi, media per intervalli di " + Math.round(Math.max(30, (f.a - f.da) / 400 / 1000)) + " secondi circa.");

  if (gare.length) {
    sezione("Prove", 34);
    gare.forEach((g, i) => {
      spazio(14); testo("Prova " + (i + 1) + (g.partenza ? " · partenza alle " + oraS(g.partenza) : " · senza partenza dal timer") + (g.tempo ? " · tempo " + tempoGara(g.tempo) : g.arrivo ? "" : " · arrivo non registrato"), M, y, {size: 10, bold: true}); y += 5;
      tabella([{titolo: "Passaggio", w: 40, forte: true}, {titolo: "Ora", w: 26}, {titolo: "Tratto", w: 26, destra: true}, {titolo: "Distanza", w: 28, destra: true}, {titolo: "Media", w: 26, destra: true}, {titolo: "", w: L - 146}],
        g.passaggi.map(p => [p.nome, oraS(p.t), p.durata ? tempoGara(p.durata) : "", p.durata ? num(p.distanzaNm, 2) + " M" : "", p.mediaKn ? num(p.mediaKn) + " kn" : "", ""]));
    });
  }
  sezione("Vento");
  if (vento.length) tabella([{titolo: "Ora", w: 18}, {titolo: "Taratura, indicazione dell'equipaggio o allarme", w: L - 18}], vento.map(e => [ora(e.t), e.testo]));
  else nota("Nessuna taratura registrata in questa uscita.");
  nota("La direzione si tara con la prua al vento a motore o in bolina stretta; le altre andature sono indicazioni dell'equipaggio.");

  sezione("Vele");
  if (vele.aBordo.length) tabella([{titolo: "Vele a riva (dai cambi indicati nell'app)", w: L - 34}, {titolo: "Tempo", w: 34, destra: false}], vele.aBordo.map(v => [v.nome, durata(v.ms)]));
  if (vele.polari.length) tabella([{titolo: "Vele durante la registrazione delle polari", w: L - 34}, {titolo: "Tempo utile", w: 34}], vele.polari.map(v => [v.nome, durata(v.ms)]));
  if (!vele.aBordo.length && !vele.polari.length) nota("Vele non indicate in questa uscita (si scelgono nella scheda Polari).");

  // ---------- Polari della sessione e record ----------
  const classiS = classiConDati(pol, f);
  sezione("Polari della sessione", classiConDati(pol, f).length ? 92 : 10);
  if (!classiS.length) nota("Nessuna polare registrata in questa uscita.");
  for (const k of classiS) {
    const ses = polare(pol, k, "tutte", f), rec = polare(pol, k, "tutte"), o = ottimi(ses);
    spazio(92);
    testo("Vento vero " + k + " nodi", M, y, {size: 11, bold: true}); y += 3;
    const y0 = y;
    doc.addImage(await png(svgPolare({W: 360, H: 400, serie: [{punti: rec, colore: "#9a9a9a", spessore: 2, tratteggio: "6 5", segni: false}, {punti: ses, colore: "#e00000"}], ottimi: o, tema: "chiaro"}), 360, 400), "PNG", M, y, 76, 84.4, undefined, "FAST");
    const salva = y; y = y0 + 4;
    const xT = M + 80, colonne = [["Angolo", 15], ["Sessione", 18], ["Record", 18], ["Vele", L - 80 - 51]];
    let x = xT; for (const [t, w] of colonne) { testo(t, x, y, {size: 8, bold: true, colore: GRIGIO}); x += w; }
    y += 4.2;
    for (const q of ses) {
      const r = rec.find(z => z.twa === q.twa), nuovo = r && q.valido && r.valido && Math.abs(r.v - q.v) < 1e-9;
      x = xT;
      const vals = [q.twa + "°", q.valido ? num(q.v) : "(" + num(q.v) + ")", r ? (r.valido ? num(r.v) : "(" + num(r.v) + ")") + (nuovo ? " *" : "") : "—", nomiCfg[q.config] ?? ""];
      let righeCella = 1;
      vals.forEach((v, i) => { righeCella = Math.max(righeCella, testo(v, x, y, {size: 8, bold: i === 1 && q.valido, colore: i === 2 && nuovo ? ROSSO : [17, 17, 17], larghezza: i === 3 ? colonne[3][1] - 1 : null})); x += colonne[i][1]; });
      y += 3.4 * righeCella + 0.8;
    }
    if (o.bolina || o.poppa) { y += 1; testo((o.bolina ? "Bolina migliore " + o.bolina.twa + "°, VMC " + num(o.bolina.vmg) + " kn. " : "") + (o.poppa ? "Poppa migliore " + o.poppa.twa + "°, VMC " + num(o.poppa.vmg) + " kn." : ""), xT, y, {size: 8, larghezza: L - 80}); y += 8; }
    y = Math.max(y, salva + 86);
  }
  if (classiS.length) nota("Rosso: la sessione. Grigio tratteggiato: il record di tutte le uscite. * = record fatto in questa uscita. Tra parentesi: meno di 30 secondi di dati.");

  const classiR = classiConDati(pol);
  sezione("Polari record", 40);
  if (!classiR.length) nota("Nessuna polare registrata.");
  else {
    const tab = new Map(classiR.map(k => [k, polare(pol, k, "tutte")]));
    const angoli = CLASSI_ANGOLO.filter(a => classiR.some(k => tab.get(k).some(q => q.twa === a)));
    const wA = 22, wC = Math.min(22, (L - wA) / classiR.length);
    const righe = angoli.map(a => [a + "°", ...classiR.map(k => { const q = tab.get(k).find(z => z.twa === a); return q ? (q.valido ? num(q.v) : "(" + num(q.v) + ")") : ""; })]);
    righe.push(["Bolina", ...classiR.map(k => { const o = ottimi(tab.get(k)).bolina; return o ? o.twa + "°" : ""; })]);
    righe.push(["Poppa", ...classiR.map(k => { const o = ottimi(tab.get(k)).poppa; return o ? o.twa + "°" : ""; })]);
    tabella([{titolo: "Angolo", w: wA, forte: true}, ...classiR.map(k => ({titolo: k + " kn", w: wC, destra: true})), {titolo: "", w: L - wA - wC * classiR.length}], righe.map(r => [...r, ""]));
    nota("Velocità sul fondo in nodi per angolo dal vento (righe) e vento vero (colonne), con le vele migliori per ogni angolo. Record = la media più alta tenuta per 30 secondi in tutte le uscite. Bolina e poppa: angoli con la VMC migliore.");
  }

  // ---------- Registro ----------
  const reg2 = eventiUscita(ev, f);
  sezione("Registro");
  if (reg2.length) tabella([{titolo: "Ora", w: 18}, {titolo: "Evento", w: L - 18}], reg2.map(e => [oraS(e.t), e.testo]), {size: 8.5});
  else nota("Nessun evento.");

  // Piè di pagina.
  const n = doc.getNumberOfPages(), creato = Date.now();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    testo("RR Regatta " + versione + " · rapporto creato il " + data(creato) + " alle " + ora(creato), M, A4.h - 8, {size: 7.5, colore: GRIGIO});
    testo("Pagina " + i + " di " + n, M + L, A4.h - 8, {size: 7.5, colore: GRIGIO, allinea: "right"});
  }
  const d = new Date(f.da), nome = "rr-rapporto-" + d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + "-" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0") + ".pdf";
  return {doc, nome, pagine: n};
}
