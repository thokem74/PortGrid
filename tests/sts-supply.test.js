'use strict';
const assert=require('node:assert/strict');
const make=require('../portgrid-engine');
const {createController}=require('../portgrid-control');
function fixture(){let seed=3;return make({rng:()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296,
 dischargePerCall:12,loadPerCall:8,continuousVessels:false,preloadFutureCalls:false});}
{
 const sim=fixture();sim.tick(.3);
 assert.ok(sim.jobs.some(j=>j.type==='IMPORT'&&!j.preposition),'real import approach is active');
 assert.ok(sim.sts.every(q=>!q.job),'an approaching AGV must not own STS execution');
 const reserved=sim.jobs.filter(j=>!j.completed&&j.type==='IMPORT').map(j=>j.slot);
 assert.ok(reserved.every(Boolean),'every admitted import has a concrete destination storage reservation');
 assert.equal(new Set(reserved).size,reserved.length,'destination reservations are exclusive');
 console.log('PASS: approach reserves storage without claiming crane execution');
}
{
 const sim=fixture();let lifts=0,successor=false;
 // Continue into the next supply wave on the larger terminal.
 for(let i=0;i<4200;i++){
  sim.tick(.1);
  for(const q of sim.sts){
   if(!q.job)continue;
   const j=sim.jobs.find(j=>j.id===q.job);
   assert.ok(j&&['PICK','PLACE'].includes(j.stage),'STS execution belongs only to a physical lift');
   assert.equal(j.vehicle.state,'DOCKED');assert.equal(j.vehicle.route.length,0);
   lifts++;
   if(sim.jobs.some(other=>!other.completed&&other!==j&&other.order?.crane===q.id&&other.type==='IMPORT'&&
    !other.pickupCraneReleased&&other.vehicle.route.length))successor=true;
  }
  for(const j of sim.jobs)if(!j.completed&&j.type==='EXPORT'&&j.pickupCraneReleased)
   assert.equal(j.vehicle.queueBay,null,'yard pickup bay is released during the outbound journey');
 }
 assert.ok(lifts>0,'fixture reaches physical handling');
 assert.ok(successor,'a crane can have its next AGV approaching during handling');
 assert.equal(sim.status().unsafeAgvBodyOverlaps,0);
 assert.equal(sim.eventCounts.JOB_ERROR||0,0);
 console.log('PASS: physical STS ownership and bounded successor supply overlap');
}
{
 // A served mission still delivering to the yard must not consume STS supply.
 const qc={id:'QC-TEST'},call={id:'CALL'},vehicles=[{id:'A',x:0,z:0},{id:'B',x:0,z:0}];
 const requests=[0,1].map(i=>({qc,call,c:{id:'C'+i},type:'IMPORT',work:{state:'PLANNED'}}));
 let serial=0;
 const controller=createController({now:()=>0,demands:()=>requests,availableVehicles:()=>vehicles,
  isVehicleFree:v=>!v.pending,pickup:()=>({x:0,z:0}),stsWaiting:()=>0,canReserve:()=>null,
  reserve:(r,v)=>{r.work.state='RESERVED';v.pending='O'+(++serial);return {orderId:v.pending};},
  progress:()=> 'RUNNING',start:()=>true,preposition:()=>false,waitReason:()=>null,
  serviceStatus:()=> 'SERVED',estimateArrival:()=>({seconds:10,distance:20}),serviceForecast:()=>({readyIn:0})});
 controller.step(true);
 assert.equal(controller.snapshot().liveMissions,2,'delivery tail does not suppress the next crane request');
 console.log('PASS: supply accounting excludes completed STS service');
}
{
 const sim=fixture(),v=sim.agvs[0];
 const [left,right]=sim.agvGuideGraph.columns;
 const z=sim.agvGuideGraph.quayTravelRows[1];
 Object.assign(v,{x:left,z,route:[{x:left,z},{x:right,z}],routeIndex:1,state:'RETURNING',load:null});
 assert.equal(sim.resources.isVehicleDispatchable(v),true,'an empty return is reusable at a graph node');
 v.x=left+.5;assert.equal(sim.resources.isVehicleDispatchable(v),false,'mid-edge diversion is forbidden');
 v.x=left;v.load='FIXTURE';assert.equal(sim.resources.isVehicleDispatchable(v),false,'loaded vehicles are never dispatchable');
 v.load=null;
 const call=sim.vesselCalls[0],work=call.discharge[0],q={type:'IMPORT',qc:sim.sts[0],c:sim.containers.get(work.container),call,work};
 const status=sim.status(),before=JSON.stringify(sim.agvs);
 const prediction=sim.routing.estimateArrival(q,v);
 assert.ok(Number.isFinite(prediction.seconds)&&prediction.seconds>=0);
 assert.equal(JSON.stringify(sim.agvs),before,'arrival prediction does not alter physical state');
 assert.equal(sim.status().gridRoutes,status.gridRoutes,'prediction never invokes the execution route planner');
 console.log('PASS: safe return reuse and observational arrival forecasts');
}
