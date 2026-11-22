'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {createHash,randomUUID}=require('node:crypto');
const sourceHashes=Object.fromEntries(['portgrid-engine.js','portgrid-control.js','portgrid-monitor.js','PORTGRID_Standalone.html'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex')]));
const PortGridEngine=require('../portgrid-engine.js');
const scenarios=[
 {name:'complete-small-seed3',seed:3,discharge:3,load:2,seconds:900,departures:3,imports:9,exports:6,waitMax:30},
 {name:'complete-small-seed7',seed:7,discharge:3,load:2,seconds:900,departures:3,imports:9,exports:6,waitMax:30},
 ...[3,7,11].map(seed=>({name:'complete-normal-seed'+seed,seed,discharge:12,load:8,seconds:2400,departures:3,imports:36,exports:24,waitMax:100,kpiTarget:true})),
 ...[3,7,11].map(seed=>({name:'continuous-normal-seed'+seed,seed,discharge:12,load:8,seconds:10800,departures:9,imports:108,exports:72,waitMax:100,continuous:true,kpiTarget:true})),
 {name:'loaded-delivery-outage',seed:3,discharge:3,load:2,seconds:1500,departures:3,imports:9,exports:6,waitMax:100,loadedOutage:true},
 {name:'full-storage-recovery',seed:7,discharge:3,load:2,seconds:3600,departures:3,imports:9,exports:6,waitMax:100,fullStorage:true},
 {name:'temporary-yard-outage',seed:3,discharge:3,load:2,seconds:1200,departures:3,imports:9,exports:6,waitMax:100,craneOutages:{'YC-A01':90,'YC-A02':90,'YC-A03':90}},
 {name:'blocked-parking-release',seed:7,discharge:3,load:2,seconds:1200,departures:3,imports:9,exports:6,waitMax:100,stalledUntil:90},
 {name:'continuous-small-seed7',seed:7,discharge:3,load:2,seconds:3000,departures:9,imports:27,exports:18,waitMax:100,continuous:true},
 {name:'complete-high-seed3',seed:3,discharge:18,load:12,seconds:3600,departures:3,imports:54,exports:36,waitMax:100},
 {name:'normal-load-first-service',seed:3,discharge:12,load:8,seconds:300,imports:9,waitMax:90}
];
function latencySummary(values){values.sort((a,b)=>a-b);return {count:values.length,min:values[0]??null,median:values[Math.floor(values.length*.5)]??null,p95:values[Math.min(values.length-1,Math.floor(values.length*.95))]??null,max:values.at(-1)??null};}
const chosen=process.argv[2]||'complete-small-seed3';
if(chosen==='list'){console.log(scenarios.map(s=>s.name).join('\n'));process.exit(0);}
const cfg=scenarios.find(c=>c.name===chosen);assert.ok(cfg, 'unknown scenario '+chosen);
const reportDir=path.join(__dirname,'..','reports');fs.mkdirSync(reportDir,{recursive:true});
const runId=randomUUID(),traceDir=path.join(reportDir,'runs');fs.mkdirSync(traceDir,{recursive:true});
const traceFile=path.join(traceDir,cfg.name+'-'+runId+'.events.ndjson');fs.writeFileSync(traceFile,'');let traceBuffer=[];
const flushTrace=()=>{if(traceBuffer.length){fs.appendFileSync(traceFile,traceBuffer.join('\n')+'\n');traceBuffer=[];}};
const traceSummary={lastCargoCompletionTime:0,departureTimes:[],doubleCycleAssignments:0,crossVesselDoubleCycles:0};
const recordEvent=e=>{traceBuffer.push(JSON.stringify({runId,...e}));if(e.type==='VESSEL_WORK_CONFIRMED')traceSummary.lastCargoCompletionTime=e.simulationTime;if(e.type==='VESSEL_DEPARTED')traceSummary.departureTimes.push({call:e.call,time:e.simulationTime});if(e.type==='AGV_DOUBLE_CYCLE_ASSIGNED'){traceSummary.doubleCycleAssignments++;if(e.crossVessel)traceSummary.crossVesselDoubleCycles++;}};
const begun=performance.now(),samples=[];let nextSample=0;
let rngState=cfg.seed;const rng=()=>((rngState=Math.imul(rngState,1664525)+1013904223|0)>>>0)/4294967296;
const sim=PortGridEngine({rng,dischargePerCall:cfg.discharge,loadPerCall:cfg.load,
 continuousVessels:!!cfg.continuous,preloadFutureCalls:false,craneOutages:cfg.craneOutages,onEvent:recordEvent});
if(cfg.fullStorage){
 let serial=0;
 for(const slot of sim.yardSlots.filter(s=>s.yard<3&&s.x<=-45))while(slot.stack.length<3){
  const id='FULL-STORAGE-'+(++serial);
  sim.containers.set(id,{id,site:'yard',yard:slot.yard,slot:slot.yard+'-'+slot.bay+'-'+slot.row,x:slot.x,z:slot.z,y:1.45+slot.stack.length*2.8,direction:'inbound',order:null,history:[]});slot.stack.push(id);
 }
}
assert.equal(sim.control.demandOutstanding>=9,true,'each of nine STS should have initial demand');
let failure=null,duplicateAssignments=0,prematureLoads=0,lastVesselProgress=0,lastVesselMoves=0,loadedOutageAt=null;
const stalled=cfg.stalledUntil?sim.agvs[0]:null;
if(stalled)stalled.speed=0;
for(let i=0;i<cfg.seconds*10;i++){
 if(stalled&&sim.time>=cfg.stalledUntil)stalled.speed=15;
 sim.tick(0.1);
 if(cfg.loadedOutage&&loadedOutageAt==null){
  const job=sim.jobs.find(j=>j.type==='IMPORT'&&j.vehicle.load===j.container.id&&j.stage==='TO_DROPOFF');
  if(job){loadedOutageAt=sim.time;job.rtg.downUntil=sim.time+90;}
 }
 if(sim.time>=nextSample){
  const k=sim.getKPI(),s=sim.status(),d=sim.reliabilityDiagnostics();
  const live=sim.orders.filter(o=>!['DONE','CANCELLED'].includes(o.status));
  duplicateAssignments+=live.length-new Set(live.map(o=>o.container)).size;
  for(const call of sim.vesselCalls)for(const load of call.load)if(load.startedAt!=null&&call.discharge.some(w=>w.completed==null||w.completed>load.startedAt+1e-6))prematureLoads++;
  if(k.importMoves+k.exportMoves!==lastVesselMoves){lastVesselMoves=k.importMoves+k.exportMoves;lastVesselProgress=sim.time;}
  if(sim.time-lastVesselProgress>=600&&sim.vesselCalls.some(c=>c.state==='WORKING'&&[...c.discharge,...c.load].some(w=>w.state!=='DONE')))failure='VESSEL_NO_PROGRESS_600_SECONDS';
  flushTrace();
  samples.push({kpi:k,time:sim.time,imports:k.importMoves,exports:k.exportMoves,departures:s.vesselsDeparted,control:sim.control.missionStates,cycles:d.cycles,stalled:d.vehicles.filter(v=>v.active&&v.waitingDuration>=60)});
  fs.writeFileSync(path.join(reportDir,cfg.name+'.progress.json'),JSON.stringify({scenario:cfg,wallSeconds:(performance.now()-begun)/1000,samples,last:sim.diagnostics()},null,2));
  console.error(cfg.name,sim.time.toFixed(1),k.importMoves,k.exportMoves,s.vesselsDeparted,'cycles',d.cycles.length);
  nextSample+=60;
  if(failure)break;
  if(d.vehicles.some(v=>v.active&&(v.vehicleType==='agv'||v.destination)&&v.waitingDuration>=300)){failure='VEHICLE_NO_PROGRESS_300_SECONDS';break;}
 }
 if(!sim.running){failure='ENGINE_STOPPED';break;}
}

flushTrace();
const st=sim.status(),kpi=sim.getKPI(),info=sim.control;
const safety={routeFailures:st.gridRouteFailures,bodyOverlaps:st.unsafeAgvBodyOverlaps,
 manifestViolations:st.manifestViolations,jobErrors:sim.eventCounts.JOB_ERROR||0,
 duplicateAssignments,prematureLoads,railViolations:st.craneRailViolations,transferOwnershipViolations:st.transferOwnershipViolations};
const result={runId,scenario:cfg.name,configuration:cfg,sourceHashes,traceSummary,wallSeconds:(performance.now()-begun)/1000,failure,kpi,traceFile,latencySeconds:latencySummary(sim.orders.filter(o=>o.status==='DONE'&&['IMPORT','EXPORT'].includes(o.type)).map(o=>o.completed-o.assigned)),diagnostics:sim.diagnostics(),samples,time:+sim.time.toFixed(1),imports:kpi.importMoves,exports:kpi.exportMoves,
 departures:st.vesselsDeparted,stsGrossWaitingPct:+kpi.avoidableSTSPercent.toFixed(2),
 schedulerDelaySeconds:+kpi.schedulerDelaySeconds.toFixed(1),stsWaitBreakdown:kpi.stsWaitBreakdown,
 stageLatencySeconds:Object.fromEntries([
  ['requestToAllocation','requestedAt','assigned'],['allocationToDeparture','assigned','departedAt'],
  ['departureToPickupArrival','departedAt','pickupArrivedAt'],['requestToSTSArrival','requestedAt','stsArrivedAt'],
  ['pickupArrivalToPickup','pickupArrivedAt','pickedUpAt'],['pickupToDelivery','pickedUpAt','deliveredAt'],
  ['deliveryToCompletion','deliveredAt','completed'],['stsArrivalToHandling','stsArrivedAt','stsServiceStartedAt'],
  ['requestToCompletion','requestedAt','completed']
 ].map(([name,from,to])=>[name,latencySummary(sim.orders.filter(o=>['IMPORT','EXPORT'].includes(o.type)&&o[from]!=null&&o[to]!=null).map(o=>o[to]-o[from]))])),
 completedByCrane:kpi.sts.map(x=>({id:x.id,completed:x.completed})),
 activeMissions:info.liveMissions,blocking:info.blockingReasons,unsafe:safety};
console.log(JSON.stringify({...result,kpi:undefined,diagnostics:undefined,samples:undefined},null,2));
try{
assert.equal(failure,null,'watchdog / engine failure');
assert.ok(sim.running,'simulation must not stop on errors');
const fleet=kpi.fleet;
const fleetTotal=['loadedTravelPercent','emptyTravelPercent','craneHandlingPercent','parkedAssignedPercent','queueWaitPercent','trafficWaitPercent','parkedUnassignedPercent'].reduce((sum,key)=>sum+fleet[key],0);
assert.ok(Math.abs(fleetTotal-100)<1e-6,'fleet states partition the common observation window');
for(const row of kpi.sts){assert.ok(Math.abs(Object.values(row.waitCauses).reduce((a,b)=>a+b,0)-row.avoidableIdle)<1e-6,'gross waiting cause arithmetic');}
for(const row of kpi.sts)assert.ok(Math.abs(Object.values(row.stateSeconds).reduce((a,b)=>a+b,0)-row.workingSeconds)<1e-6,'all working STS time is partitioned');
assert.ok(kpi.unclassifiedSTSSeconds<1e-6,'no unclassified STS time');
for(const summary of Object.values(result.stageLatencySeconds))if(summary.count)assert.ok(summary.min>=-1e-6,'physical stage durations cannot be negative');
if(cfg.loadedOutage)assert.notEqual(loadedOutageAt,null,'outage must actually interrupt loaded import transport');

for(const [name,value] of Object.entries(safety))assert.equal(value,0,name);
assert.ok(kpi.importMoves>=cfg.imports,'discharge throughput acceptance');
if(cfg.exports!=null)assert.ok(kpi.exportMoves>=cfg.exports,'loading throughput acceptance');
if(cfg.departures!=null)assert.ok(st.vesselsDeparted>=cfg.departures,'all vessels must depart');
assert.ok(kpi.avoidableSTSPercent<cfg.waitMax,'gross STS waiting share acceptance');
if(cfg.name==='normal-load-first-service'){
 const perBerth=[0,0,0];for(const x of kpi.sts)perBerth[x.berth-1]+=x.completed;
 assert.ok(perBerth.every(x=>x>0),'all three vessels must receive discharge service');
 assert.ok(kpi.sts.every(x=>x.completed>0),'all nine STS must receive service');
}
if(cfg.departures===3)assert.equal(info.liveMissions,0,'no active missions after final cargo completion');
if(cfg.kpiTarget){
 const checkWindow=(label,end,start=null)=>{
  const exposure=end.sts.reduce((sum,q)=>sum+q.workingSeconds,0)-(start?.sts.reduce((sum,q)=>sum+q.workingSeconds,0)||0);
  const moves=end.sts.reduce((sum,q)=>sum+q.completed,0)-(start?.sts.reduce((sum,q)=>sum+q.completed,0)||0);
  const metrics={grossMovesPerCraneHour:moves*3600/exposure,
   estimatedSchedulerShare:100*(end.schedulerDelaySeconds-(start?.schedulerDelaySeconds||0))/exposure,
   evidencedSchedulerShare:100*(end.evidencedSchedulerSeconds-(start?.evidencedSchedulerSeconds||0))/exposure};
  result.kpiQualification??={};result.kpiQualification[label]=metrics;
  assert.ok(metrics.grossMovesPerCraneHour>=25,label+': at least 25 gross moves/crane-hour');
  assert.ok(metrics.estimatedSchedulerShare<10,label+': estimated scheduler delay under 10%');
  assert.ok(metrics.evidencedSchedulerShare<10,label+': evidenced scheduler delay under 10%');
 };
 checkWindow('fullHorizon',kpi);
 if(cfg.continuous){
  const warm=samples.find(sample=>sample.time>=2400);checkWindow('afterWarmup',kpi,warm.kpi);
  for(const call of sim.vesselCalls){
   if(call.workStarted!=null&&call.workStarted<=sim.time-2400)assert.equal(call.state,'DEPARTED','admitted call completes within its window');
   if(call.departure!=null)assert.ok(call.departure-call.workStarted<=2400,'bounded call completion');
  }
 }
}
result.outcome='PASS';console.log('ACCEPTANCE PASSED',cfg.name);
}catch(error){result.outcome=failure?'WATCHDOG_FAILURE':'ASSERTION_FAILURE';result.validationError=String(error);console.error(error);process.exitCode=1;}
finally{fs.writeFileSync(path.join(reportDir,cfg.name+'.json'),JSON.stringify(result,null,2));}

