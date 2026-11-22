'use strict';
const assert=require('node:assert/strict'),make=require('../portgrid-engine');
function fixture(){let seed=3;return make({rng:()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296,
 dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});}
{
 const sim=fixture();sim.tick(.3);
 const approaches=sim.jobs.filter(j=>!j.completed&&j.stage==='TO_PICKUP');
 assert.ok(approaches.some(j=>j.vehicle.type==='agv'));
 assert.ok(approaches.some(j=>j.vehicle.type==='truck'));
 assert.ok(sim.resources.craneOccupancy().every(o=>o.operation==='YARD_RELAY'),
  'no approaching AGV or truck may own STS/RTG execution');
 // Freeze all approaches: elapsed travel time must not reserve a crane.
 for(const v of [...sim.agvs,...sim.trucks])v.speed=0;
 for(let i=0;i<100;i++)sim.tick(.1);
 assert.ok(sim.resources.craneOccupancy().every(o=>o.operation==='YARD_RELAY'));
 assert.equal(sim.status().transferOwnershipViolations,0);
 console.log('PASS: stationary approaches cannot occupy STS or RTG execution');
}
{
 const sim=fixture();let agvLifts=0,truckLifts=0,truckDepartures=0;
 for(let i=0;i<9000;i++){
  sim.tick(.1);assert.ok(sim.running,'physical scenario remains running');
  for(const o of sim.resources.craneOccupancy()){
   if(o.operation==='YARD_RELAY')continue;
   assert.ok(o.aligned&&['PICK','PLACE'].includes(o.stage),'execution requires an aligned stationary vehicle at its assigned slot');
   if(o.vehicleId.startsWith('AGV'))agvLifts++;else truckLifts++;
  }
  for(const j of sim.jobs)if(j.type==='TRUCK_PICKUP'&&j.stage==='TO_GATE'&&!j.completed){
   assert.notEqual(j.rtg.job,j.id,'departing truck cannot hold the RTG');
   assert.equal(j.vehicle.queueBay,null,'departing truck releases its logical bay');truckDepartures++;
  }
 }
 assert.ok(agvLifts&&truckLifts&&truckDepartures,'exercise real AGV, truck and gate-return handovers');
 assert.equal(sim.status().transferOwnershipViolations,0);
 console.log('PASS: aligned AGV/truck handovers and prompt truck pickup release');
}
{
 const sim=fixture();sim.tick(.3);
 const j=sim.jobs.find(j=>j.type==='IMPORT'&&!j.preposition),v=j.vehicle;
 Object.assign(v,{x:j.sts.homeX,z:j.stsDockZ,heading:Math.PI/2,route:[],routeIndex:0,state:'DOCKED'});
 sim.tick(1/30);
 assert.equal(j.sts.job,null,'a perpendicular AGV cannot acquire the crane');
 assert.ok(v.pivot,'misalignment schedules a guarded physical turn');
 const initial=v.heading;
 for(let i=0;i<10;i++)sim.tick(1/30);
 assert.notEqual(v.heading,initial,'alignment rotates the chassis physically');
 assert.ok(Math.abs(Math.sin(v.heading))>.035,'turn is gradual rather than an instantaneous heading change');
 for(let i=0;i<150;i++)sim.tick(1/30);
 assert.ok(Math.abs(Math.sin(v.heading))<.035,'the physical alignment completes');
 assert.equal(j.sts.job,j.id,'only the aligned AGV acquires STS execution');
 console.log('PASS: a misaligned AGV turns physically before acquiring STS execution');
}
{
 const sim=fixture();sim.tick(.3);
 const job=sim.jobs.find(j=>j.type==='IMPORT'&&!j.preposition);
 assert.ok(job);job.sts.job=job.id;sim.tick(.1);
 assert.equal(sim.running,false,'invalid remote crane occupancy stops execution');
 assert.ok(sim.status().transferOwnershipViolations>0);
 assert.ok(sim.eventCounts.TRANSFER_OWNERSHIP_VIOLATION>0);
 console.log('PASS: remote execution ownership is a hard failing invariant');
}
