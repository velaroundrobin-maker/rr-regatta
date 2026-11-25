// RR Regatta: ground-referenced sailing geometry. Angles clockwise from true north.
export const rad = d => d * Math.PI / 180;
export const deg = r => r * 180 / Math.PI;
export const norm = a => ((a % 360) + 360) % 360;
export const signed = a => ((a + 540) % 360) - 180;
export const delta = (a,b) => signed(a-b);
export function circularMean(values) {
  if (!values?.length) return null;
  let s=0,c=0;
  for(const a of values){s+=Math.sin(rad(a));c+=Math.cos(rad(a));}
  return Math.hypot(s,c)<1e-9?null:norm(deg(Math.atan2(s,c)));
}
export function circularSpread(values){
  const m=circularMean(values);
  if(m===null) return Infinity;
  return Math.sqrt(values.reduce((s,v)=>s+delta(v,m)**2,0)/values.length);
}
export function distanceMeters(a,b){
  const R=6371008.8;
  const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
  const s=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));
}
export function bearing(a,b){
  const f1=rad(a.lat),f2=rad(b.lat),dl=rad(b.lon-a.lon);
  return norm(deg(Math.atan2(Math.sin(dl)*Math.cos(f2),Math.cos(f1)*Math.sin(f2)-Math.sin(f1)*Math.cos(f2)*Math.cos(dl))));
}
export function toXY(point,origin){
  const mean=rad((point.lat+origin.lat)/2);
  return {x:rad(point.lon-origin.lon)*6371008.8*Math.cos(mean),y:rad(point.lat-origin.lat)*6371008.8};
}
export function fromXY(pos,origin){
  return {lat:origin.lat+deg(pos.y/6371008.8),lon:origin.lon+deg(pos.x/(6371008.8*Math.cos(rad(origin.lat))))};
}
export function move(point,bearingDegrees,meters){
  const angle=rad(bearingDegrees),d=meters/6371008.8,lat1=rad(point.lat),lon1=rad(point.lon);
  const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(angle));
  const lon2=lon1+Math.atan2(Math.sin(angle)*Math.sin(d)*Math.cos(lat1),Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
  return {lat:deg(lat2),lon:norm(deg(lon2)+180)-180};
}
export function estimateMarkFromBearings(first,second){
  if(!first||!second) return null;
  if(distanceMeters(first,second)<25) return null;
  const origin={lat:first.lat,lon:first.lon};
  const p={x:0,y:0},q=toXY(second,origin);
  const d={x:Math.sin(rad(first.bearing)),y:Math.cos(rad(first.bearing))};
  const e={x:Math.sin(rad(second.bearing)),y:Math.cos(rad(second.bearing))};
  const cross=(a,b)=>a.x*b.y-a.y*b.x;
  const divisor=cross(d,e);
  if(Math.abs(divisor)<.2) return null;
  const t=cross(q,e)/divisor,u=cross(q,d)/divisor;
  if(t<0||u<0||t>20000||u>20000)return null;
  return {...fromXY({x:p.x+t*d.x,y:p.y+t*d.y},origin),metersFromFirst:t,crossAngle:Math.abs(deg(Math.asin(divisor)))};
}
export function windVMG(sog,cog,wind){
  return Number.isFinite(sog)&&Number.isFinite(cog)&&Number.isFinite(wind)?sog*Math.cos(rad(delta(cog,wind))):null;
}
export function markVMC(sog,cog,markBearing){
  return Number.isFinite(sog)&&Number.isFinite(cog)&&Number.isFinite(markBearing)?sog*Math.cos(rad(delta(cog,markBearing))):null;
}
// A recent GPS observation is live only while acquisition is running.
// Historical fixes must never be presented as current cockpit instruments.
export function isLiveFix(nav,mode,now=Date.now(),maxAgeMs=12000){
  if(mode!=="gps"&&mode!=="demo")return false;
  if(!nav||!Number.isFinite(nav.time)||!Number.isFinite(nav.lat)||!Number.isFinite(nav.lon))return false;
  const age=now-nav.time;
  return age>=-2000&&age<=maxAgeMs;
}
export function bestObservedVMG(samples,now=Date.now()){
  const groups=new Map();
  for(const s of samples||[]){
    if(now-s.time>10*60*1000||s.angle<25||s.angle>80||s.sog<1||s.sog>25)continue;
    const bucket=Math.round(s.angle/5)*5;
    const g=groups.get(bucket)||{angle:bucket,vmg:0,n:0};
    g.vmg+=s.vmg;g.n++;groups.set(bucket,g);
  }
  const ranked=[...groups.values()].filter(x=>x.n>=3).map(x=>({...x,vmg:x.vmg/x.n})).sort((a,b)=>b.vmg-a.vmg);
  return ranked[0]||null;
}
export function averageWind(windHistory,now=Date.now(),windowMs=5*60*1000){
  return circularMean((windHistory||[]).filter(s=>now-s.time<=windowMs).map(s=>s.value));
}
// Wind-shift alarm: requires a sufficiently long, fresh run of comparable
// close-hauled observations. An alert stays latched until acknowledged.
export function updateWindShiftAlarm(previous,{recent,valid,now=Date.now(),threshold=8,sustainMs=20000}){
  const alarm={reference:null,pendingSince:null,active:false,change:null,triggeredAt:null,...(previous||{})};
  if(!Number.isFinite(alarm.reference)||!Number.isFinite(recent)){
    if(Number.isFinite(recent)&&valid)alarm.reference=recent;
    return {...alarm,pendingSince:null};
  }
  if(alarm.active)return alarm;
  if(!valid)return {...alarm,pendingSince:null};
  const change=delta(recent,alarm.reference);
  if(Math.abs(change)<threshold)return {...alarm,pendingSince:null};
  if(alarm.pendingSince===null)return {...alarm,pendingSince:now};
  if(now-alarm.pendingSince<sustainMs)return alarm;
  return {...alarm,active:true,change,triggeredAt:now,pendingSince:null};
}
export function acknowledgeWindShiftAlarm(previous,recent){
  return {...(previous||{}),reference:Number.isFinite(recent)?recent:previous?.reference,
    pendingSince:null,active:false,change:null,triggeredAt:null};
}
export function formatCoord(n,lat=false){return Math.abs(n).toFixed(5)+'° '+(lat?(n>=0?'N':'S'):(n>=0?'E':'W'));}
export function statusFromAccuracy(acc){
  if(!Number.isFinite(acc))return "precisione non disponibile";
  return "±"+Math.round(acc)+" m GPS";
}
