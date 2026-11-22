'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
function validateReport(report){
 const root=path.resolve(__dirname,'..'),cfg=report.configuration,calls=new Map(),active=new Map();
 for(const [file,hash] of Object.entries(report.sourceHashes))
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),hash,'trace must qualify the current source: '+file);
 const fields=['simulationTime','vehicleId','vesselCallId','stsId','missionId','containerId','fromState','toState','blockingReason','blockingResourceId','routeOrReservationId'];
 let previous=0,events=0,departures=0;
 for(const line of fs.readFileSync(report.traceFile,'utf8').trim().split('\n')){
  const e=JSON.parse(line);events++;
  assert.equal(e.runId,report.runId,'trace belongs to one run');
  for(const field of fields)assert.ok(Object.hasOwn(e,field),'normalized event field '+field);
  assert.ok(e.simulationTime>=previous-.011,'trace time is monotonic to logging precision');previous=e.simulationTime;
  assert.ok(e.simulationTime<=report.time+.11,'event cannot come from a later or concurrent run');
  if(e.type==='VESSEL_CALL_CREATED'){
   assert.ok(!calls.has(e.call),'vessel call identity is unique');
   calls.set(e.call,{id:e.call,discharge:e.discharge,load:e.load,imports:0,exports:0,working:e.state==='WORKING',departed:false});
  }
  if(e.type==='GATE_EXPORT_BOOKED')calls.get(e.call).load++;
  if(e.type==='VESSEL_WORKING')calls.get(e.call).working=true;
  if(e.type==='STS_DEMAND_ASSIGNED'){
   const call=calls.get(e.vesselCallId);
   assert.ok(call,'mission belongs to a known vessel');
   if(e.operationType==='EXPORT')assert.equal(call.imports,cfg.discharge,'allocation cannot bypass physical discharge completion');
   assert.ok(!active.has(e.containerId),'no duplicate active container assignment');
   active.set(e.containerId,e.missionId);
  }
  if(e.type==='VESSEL_WORK_CONFIRMED'){
   const call=calls.get(e.call);assert.ok(call);
   if(e.action==='DISCHARGE')call.imports++;else if(e.action==='LOAD'){
    assert.equal(call.imports,cfg.discharge,'loading requires physical discharge completion');call.exports++;
   }
  }
  if(e.type==='JOB_DONE'&&active.get(e.containerId)===e.missionId)active.delete(e.containerId);
  if(e.type==='VESSEL_DEPARTED'){
   const call=calls.get(e.call);assert.ok(call&&!call.departed,'one departure per call');
   assert.equal(call.imports,cfg.discharge,'departure has every configured import');
   assert.equal(call.exports,cfg.load,'departure has every configured export');
   call.departed=true;departures++;
  }
 }
 for(const call of calls.values())if(call.working||call.departed){
  assert.equal(call.discharge,cfg.discharge,'working call keeps its full discharge workload');
  assert.equal(call.load,cfg.load,'working call keeps its full export workload, including truck-booked cargo');
 }
 assert.equal(departures,report.departures,'streamed departures match the result');
 assert.equal([...calls.values()].reduce((sum,c)=>sum+c.imports,0),report.imports,'streamed imports match physical KPI');
 assert.equal([...calls.values()].reduce((sum,c)=>sum+c.exports,0),report.exports,'streamed exports match physical KPI');
 return {scenario:report.scenario,runId:report.runId,events,calls:calls.size,departures};
}
module.exports=validateReport;
if(require.main===module){
 assert.ok(process.argv.length>2,'provide scenario report names');
 for(const name of process.argv.slice(2)){
  const report=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../reports',name+'.json')));
  console.log('PASS: source/trace identity, complete workloads, phase sequencing and physical totals',JSON.stringify(validateReport(report)));
 }
}
