import test from "node:test";
import assert from "node:assert/strict";
import {norm,delta,circularMean,windVMG,markVMC,isLiveFix,distanceMeters,bearing,move,estimateMarkFromBearings,bestObservedVMG,updateWindShiftAlarm,acknowledgeWindShiftAlarm} from "../js/engine.mjs";

test("angoli e media circolare attraversano lo zero",()=>{
  assert.equal(norm(-20),340);
  assert.equal(delta(5,355),10);
  assert.ok(Math.abs(circularMean([359,1]))<.01);
});
test("VMG al vento e VMC alla boa sono proiezioni diverse",()=>{
  assert.ok(Math.abs(windVMG(5,45,0)-3.5355339)<1e-5);
  assert.ok(Math.abs(markVMC(5,45,25)-4.6984631)<1e-5);
});
test("gli strumenti mostrano solo un GPS recente e attivo",()=>{
  const fix={lat:44.133,lon:8.28,cog:47,sog:5.2,time:100000};
  assert.equal(isLiveFix(fix,"gps",103000),true);
  assert.equal(isLiveFix(fix,"demo",110000),true);
  assert.equal(isLiveFix(fix,"gps",113001),false);
  assert.equal(isLiveFix(fix,"idle",100500),false);
  assert.equal(isLiveFix(null,"gps",100500),false);
});
test("due rilevamenti geometricamente validi triangolano una boa",()=>{
  const a={lat:44.133,lon:8.28};
  const b=move(a,90,180);
  const target=move(a,30,500);
  const calc=estimateMarkFromBearings({...a,bearing:bearing(a,target)},{...b,bearing:bearing(b,target)});
  assert.ok(calc);
  assert.ok(distanceMeters(calc,target)<2);
});
test("rilevamenti paralleli o senza spostamento non bastano",()=>{
  const a={lat:44,lon:8,bearing:10};
  assert.equal(estimateMarkFromBearings(a,{...a,bearing:320}),null);
});
test("l'angolo ottimale emerge da campioni a parità di condizioni",()=>{
  const now=Date.now();
  const samples=[];
  for(const [angle,sog] of [[40,4],[45,5],[50,5.4]]){
    for(let i=0;i<5;i++)samples.push({angle,sog,vmg:sog*Math.cos(angle*Math.PI/180),time:now-i*5000});
  }
  const best=bestObservedVMG(samples,now);
  assert.equal(best.angle,45);
});
test("allarme vento: distingue salto persistente da oscillazione breve",()=>{
  let alarm={reference:0,pendingSince:null,active:false};
  alarm=updateWindShiftAlarm(alarm,{recent:9,valid:true,now:1000,threshold:8,sustainMs:20000});
  assert.equal(alarm.active,false);
  alarm=updateWindShiftAlarm(alarm,{recent:4,valid:true,now:5000,threshold:8,sustainMs:20000});
  assert.equal(alarm.pendingSince,null);
  alarm=updateWindShiftAlarm(alarm,{recent:10,valid:true,now:10000,threshold:8,sustainMs:20000});
  alarm=updateWindShiftAlarm(alarm,{recent:10,valid:true,now:31000,threshold:8,sustainMs:20000});
  assert.equal(alarm.active,true);
  assert.equal(alarm.change,10);
});
test("allarme latched fino al riconoscimento e riferimento aggiornato",()=>{
  const active={reference:0,active:true,change:12,triggeredAt:31000,pendingSince:null};
  const stale=updateWindShiftAlarm(active,{recent:0,valid:false,now:90000});
  assert.equal(stale.active,true);
  const ack=acknowledgeWindShiftAlarm(stale,12);
  assert.equal(ack.active,false);
  assert.equal(ack.reference,12);
});
test("allarme scatta correttamente attraversando il nord",()=>{
  let alarm={reference:357,pendingSince:null,active:false};
  alarm=updateWindShiftAlarm(alarm,{recent:6,valid:true,now:1000,threshold:8,sustainMs:500});
  alarm=updateWindShiftAlarm(alarm,{recent:6,valid:true,now:1600,threshold:8,sustainMs:500});
  assert.equal(alarm.change,9);
});
