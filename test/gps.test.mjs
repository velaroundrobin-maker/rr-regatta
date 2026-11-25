import test from 'node:test';
import assert from 'node:assert/strict';
import {gpsFixFromPosition,gpsErrorInfo} from '../js/gps.mjs';

const now=1_800_000_000_000;
const position=(latitude,longitude,options={})=>({
  timestamp:options.timestamp??now,
  coords:{latitude,longitude,accuracy:options.accuracy??8,speed:options.speed??null,heading:options.heading??null}
});

test('first stationary fix preserves latitude and longitude without heading or speed',()=>{
  const fix=gpsFixFromPosition(position(44.13306,8.28031),null,now);
  assert.equal(fix.lat,44.13306);
  assert.equal(fix.lon,8.28031);
  assert.equal(fix.sog,null);
  assert.equal(fix.cog,null);
  assert.equal(fix.accuracy,8);
});

test('successive stationary fixes can show zero speed without inventing a course',()=>{
  const first=gpsFixFromPosition(position(44.13306,8.28031),null,now);
  const second=gpsFixFromPosition(position(44.133061,8.28031,{timestamp:now+5000}),first,now+5000);
  assert.equal(second.sog,0);
  assert.equal(second.cog,null);
});

test('course and speed are inferred when motion is greater than GPS uncertainty',()=>{
  const prev=gpsFixFromPosition(position(44.13306,8.28031),null,now);
  const fix=gpsFixFromPosition(position(44.13306,8.28156,{timestamp:now+10000}),prev,now+10000);
  assert.ok(fix.sog>18&&fix.sog<21);
  assert.ok(fix.cog>89&&fix.cog<91);
});

test('reported zero degrees is a valid heading; negative invalid heading is ignored',()=>{
  assert.equal(gpsFixFromPosition(position(44,8,{heading:0,speed:0}),null,now).cog,0);
  assert.equal(gpsFixFromPosition(position(44,8,{heading:-1}),null,now).cog,null);
});

test('non-finite, out-of-range and old geolocation reports are rejected',()=>{
  assert.equal(gpsFixFromPosition(position(NaN,8),null,now),null);
  assert.equal(gpsFixFromPosition(position(91,8),null,now),null);
  assert.equal(gpsFixFromPosition(position(44,181),null,now),null);
  assert.equal(gpsFixFromPosition(position(44,8,{timestamp:now-60000}),null,now),null);
});

test('permission denial is terminal, but temporary location failures are retried',()=>{
  assert.equal(gpsErrorInfo({code:1}).terminal,true);
  assert.match(gpsErrorInfo({code:1}).detail,/posizione precisa/i);
  assert.equal(gpsErrorInfo({code:2}).terminal,false);
  assert.equal(gpsErrorInfo({code:3}).terminal,false);
});
