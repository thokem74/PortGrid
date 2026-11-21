'use strict';
const assert=require('node:assert/strict');
const {createController,authorizeParkingDeparture,authorizeImportYard}=require('../portgrid-control.js');

function fixture(){
 let clock=0,capacity=true,next=0;
 const cranes=Array.from({length:9},(_,i)=>({id:'QC-'+String(i+1).padStart(2,'0')}));
 const calls=Array.from({length:3},(_,i)=>({id:'VC-'+(i+1)}));
 const requests=cranes.map((qc,i)=>({qc,call:calls[Math.floor(i/3)],type:'IMPORT',
  c:{id:'PG-'+i},work:{state:'PLANNED'}}));
 const vehicles=Array.from({length:24},(_,i)=>({id:'AGV-'+String(i+1).padStart(2,'0'),x:-444,z:i*12,
   speed:15,completed:0,lastCompletedType:null}));
 const orders=new Map();
 const adapter={
  now:()=>clock,demands:()=>requests.filter(r=>r.work.state!=='DONE'),
  availableVehicles:()=>vehicles,isVehicleFree:v=>!v.pending,
  pickup:r=>({x:r.qc.id.endsWith('1')?-264:0,z:-60}),stsWaiting:()=>20,
  canReserve:()=>capacity?null:'DOWNSTREAM_CAPACITY',
  reserve:(r,v)=>{if(r.work.state!=='PLANNED')return null;
   const id='ORD-'+(++next);r.work.state='RESERVED';v.pending=id;
   orders.set(id,{request:r,vehicle:v,status:'ASSIGNED_WAITING'});return {orderId:id};},
  progress:m=>orders.get(m.id)?.status==='DONE'?'DONE':orders.get(m.id)?.status==='BLOCKED'?'BLOCKED':
   orders.get(m.id)?.status==='RUNNING'?'RUNNING':'WAITING',
  start:m=>{const order=orders.get(m.id);if(order.status==='BLOCKED')return 'RESOURCE_BLOCKED';
   order.status='RUNNING';return true;},
  preposition:()=>false,waitReason:()=> 'RESOURCE_BLOCKED'
 };
 const scheduler=createController(adapter);
 return {scheduler,requests,vehicles,orders,setClock:n=>clock=n,setCapacity:v=>capacity=v};
}

{
 const f=fixture();f.setCapacity(false);f.scheduler.step();
 assert.equal(f.scheduler.snapshot().demandOutstanding,9,'demand must persist without yard capacity');
 assert.equal(f.scheduler.snapshot().liveMissions,0,'no speculative assignment without safe destination');
 f.setCapacity(true);f.setClock(1);f.scheduler.step();
 assert.equal(f.scheduler.snapshot().liveMissions,9,'each of nine STS receives one mission');
 assert.equal(f.vehicles.filter(v=>v.pending).length,9,'not all 24 AGVs must be assigned');
 assert.deepEqual(new Set(f.scheduler.snapshot().missions.map(m=>m.sts)).size,9,'serve all cranes');
}
{
 const f=fixture();f.scheduler.step();
 const [id,order]=[...f.orders][0];order.status='DONE';order.request.work.state='DONE';
 f.setClock(1);f.scheduler.step();
 assert.equal(f.scheduler.missions.get(id).state,'DONE');
 assert.equal(f.scheduler.requests.get(f.scheduler.missions.get(id).requestKey).status,'DONE');
}
{
 const f=fixture();f.scheduler.step();const order=[...f.orders.values()][0];
 order.status='BLOCKED';f.setClock(1);f.scheduler.step();
 assert.ok(f.scheduler.snapshot().blockingReasons.RESOURCE_BLOCKED>=1,'blocker remains observable');
}
{
 const f=fixture();const [r]=f.requests;
 const parked={id:'AGV-P',x:-444,z:90,speed:15,completed:2};
 const recycled={id:'AGV-R',x:-221,z:170,speed:15,completed:2,lastCompletedType:'EXPORT',lastCompletedVesselCall:'VC-OTHER'};
 const scoreParked=f.scheduler.score({request:r,created:0},parked);
 const scoreReused=f.scheduler.score({request:r,created:0},recycled);
 assert.ok(scoreReused<scoreParked,'vehicle already in terminal receives real distance/reuse preference');
}
console.log('PASS: persistent demand, admission, fairness, mission completion, blocking, and reuse scoring');

{
 const a={type:'agv',x:-444,z:19,home:{x:-444}};
 const b={type:'agv',x:-462,z:29,home:{x:-444},route:[{x:-308,z:-24}],routeIntent:{type:'sts'}};
 const c={type:'agv',x:-414,z:29,home:{x:-396},route:[{x:-308,z:-36}],routeIntent:{type:'sts'}};
 assert.equal(authorizeParkingDeparture(a,[a,b,c]),'PARKING_EXIT_CONFLICT');
 assert.equal(authorizeParkingDeparture(a,[a,c]),null,'different row departs independently');
 assert.equal(authorizeParkingDeparture(a,[a,{...b,x:-280}]),null,'corridor released after clearing the quay');
 assert.equal(authorizeImportYard({outage:true}),'YARD_CRANE_OUTAGE');
 assert.equal(authorizeImportYard({storageAvailable:false}),'YARD_STORAGE_FULL');
 assert.equal(authorizeImportYard({active:3}),'YARD_DELIVERY_CAPACITY_FULL');
 assert.equal(authorizeImportYard({active:1,queued:1}),null);
}
console.log('PASS: physical parking and import-yard resource authorization');
