'use strict';
const assert=require('node:assert/strict');
const createEngine=require('../portgrid-engine.js');

const seed=3, dischargePerCall=12, loadPerCall=8;
const warmupSeconds=90, windowSeconds=60, addedRecords=1000, repetitions=7;

function measure(archiveSize){
 let state=seed;
 const rng=()=>((state=Math.imul(state,1664525)+1013904223|0)>>>0)/4294967296;
 const events=[];
 const sim=createEngine({rng,dischargePerCall,loadPerCall,continuousVessels:false,
  preloadFutureCalls:false,onEvent:event=>events.push(event)});
 for(let i=0;i<warmupSeconds*10;i++)sim.tick(.1);
 const firstEvent=events.length;
 const initialJobs=new Set(sim.jobs.map(job=>job.id));
 const initialOrders=new Set(sim.orders.map(order=>order.id));
 const retainedJobs=[],retainedOrders=[];
 // Populate only the audit arrays. These fixtures represent unrelated closed
 // records and must never participate in the current run's physical work.
 for(let i=0;i<archiveSize;i++){
  const order={id:'ARCHIVED-ORDER-'+i,type:'IMPORT',status:'DONE',container:'ARCHIVED-CARGO-'+i,job:'ARCHIVED-JOB-'+i};
  const job={id:order.job,type:order.type,completed:true,order,slot:sim.yardSlots[i%sim.yardSlots.length]};
  retainedJobs.push(job);retainedOrders.push(order);
 }
 sim.jobs.unshift(...retainedJobs);
 sim.orders.unshift(...retainedOrders);
 const start=performance.now();
 for(let i=0;i<windowSeconds*10;i++)sim.tick(.1);
 const milliseconds=performance.now()-start;
 assert.ok(sim.running);
 assert.deepEqual(sim.jobs.slice(0,archiveSize),retainedJobs);
 assert.deepEqual(sim.orders.slice(0,archiveSize),retainedOrders);
 const kpi=sim.getKPI(), status=sim.status();
 for(const count of [status.gridRouteFailures,status.unsafeAgvBodyOverlaps,status.craneRailViolations,
  status.manifestViolations,status.transferOwnershipViolations,sim.eventCounts.JOB_ERROR||0])assert.equal(count,0);
 const run={
  events:events.slice(firstEvent),
  orders:sim.orders.slice(archiveSize),
  jobs:sim.jobs.slice(archiveSize).map(({id,completed,stage,order})=>({id,completed,stage,order:order.id})),
  history:sim.history,
  containers:[...sim.containers.values()].map(({id,site,history})=>({id,site,history})),
  kpi,status,control:sim.control
 };
 const newOrders=run.orders.filter(order=>!initialOrders.has(order.id)).length;
 const newJobs=run.jobs.filter(job=>!initialJobs.has(job.id)).length;
 assert.ok(newOrders>0&&newJobs>0,'the measured window must include dispatch');
 assert.ok(run.events.some(event=>event.type==='VESSEL_WORK_CONFIRMED'),'the measured window must include vessel cargo completion');
 return {milliseconds,run,newOrders,newJobs};
}

const samples={baseline:[],enlarged:[]};
const warmup=measure(0);
for(let trial=0;trial<repetitions;trial++){
 const sizes=trial%2?[addedRecords,0]:[0,addedRecords];
 for(const size of sizes){
  const {milliseconds,run}=measure(size);
  assert.deepEqual(run,warmup.run);
  samples[size?'enlarged':'baseline'].push(milliseconds);
 }
}
const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
const medians=Object.fromEntries(Object.entries(samples).map(([name,values])=>[name,median(values)]));
const ratio=medians.enlarged/medians.baseline;
console.log(JSON.stringify({seed,dischargePerCall,loadPerCall,warmupSeconds,windowSeconds,addedRecords,repetitions,
 samplesMilliseconds:samples,mediansMilliseconds:medians,ratio,ordersCreated:warmup.newOrders,jobsCreated:warmup.newJobs,
 events:warmup.run.events.length,imports:warmup.run.kpi.importMoves,exports:warmup.run.kpi.exportMoves},null,2));
assert.ok(ratio<=1.25,'adding completed jobs and orders raised median tick time by more than 25%');
console.log('PASS: archive size and deterministic physical behavior');
