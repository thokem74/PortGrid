/* PORTGRID control layer: deterministic and UI-independent.
 * Responsibilities: persistent STS demand, mission assignment, resource decisions,
 * and actionable waiting reasons. Physical motion and container lifts remain
 * the engine's responsibility and are only requested through the adapter.
 */
(function(root){'use strict';
// Parking is a shared physical resource. The ROW, not the whole parking area,
// owns a departure corridor until its lead AGV has cleared the quay feeder.
function authorizeParkingDeparture(vehicle,vehicles){
 if(vehicle.type!=='agv'||vehicle.x>=-360)return null;
 const occupied=vehicles.some(other=>other!==vehicle&&other.home.x===vehicle.home.x&&
   other.route?.length&&other.x<-308&&['sts','yard','staging'].includes(other.routeIntent?.type));
 return occupied?'PARKING_EXIT_CONFLICT':null;
}
// Import capacity admission is independent of STS demand generation.
function authorizeImportYard({outage=false,storageAvailable=true,active=0,queued=0,
 maxActive=3,maxQueued=2}){
 if(outage)return 'YARD_CRANE_OUTAGE';
 if(!storageAvailable)return 'YARD_STORAGE_FULL';
 if(active>=maxActive)return 'YARD_DELIVERY_CAPACITY_FULL';
 if(queued>=maxQueued)return 'YARD_RESERVATION_QUEUE_FULL';
 return null;
}
function createController(adapter,policy={}){
 const cfg={maxQueuedPerCrane:1,maxActiveImportsPerYard:3,maxPendingImportsPerYard:2,
  maxImportPerCrane:2,dispatchPeriod:0.2,staleSeconds:30,...policy};
 const requests=new Map(),missions=new Map(),metrics={requestsCreated:0,assigned:0,started:0,
  prepositioned:0,finished:0,blockedReasons:{},lastDispatchAt:-Infinity};
 const liveRequests=new Set(),liveMissions=new Set();
 const lastAllocation=new Map();
 const keyOf=r=>r.call.id+'|'+r.type+'|'+r.c.id;
 function updateDemand(){
  const now=adapter.now(),seen=new Set();
  // This scan never requires a free yard slot or ready RTG: need exists
  // independently of downstream equipment readiness.
  for(const candidate of adapter.demands()){
   const key=keyOf(candidate);seen.add(key);
   const existing=requests.get(key);
   if(!existing){
    const entry={key,created:now,updated:now,status:'OPEN',reason:'AWAITING_ASSIGNMENT',request:candidate};
    requests.set(key,entry);liveRequests.add(entry);metrics.requestsCreated++;
   }
   else {existing.request=candidate;existing.updated=now;
    if(existing.status==='UNAVAILABLE')existing.status='OPEN';}
  }
  for(const r of liveRequests){
   if(!seen.has(r.key)){
    if(r.request.work.state==='DONE'){r.status='DONE';r.reason=null;liveRequests.delete(r);}
    else if(r.request.work.state==='EXCEPTION'){r.status='EXCEPTION';r.reason='MANIFEST_EXCEPTION';liveRequests.delete(r);}
    else if(r.status==='OPEN') {r.status='UNAVAILABLE';r.reason='CARGO_NOT_ACCESSIBLE';}
   }
  }
 }
 function serviceStatus(m){return adapter.serviceStatus?adapter.serviceStatus(m):m.state==='RUNNING'?'HANDLING':'SUPPLYING';}
 function runningCount(stsId){return [...liveMissions].filter(m=>m.sts===stsId&&serviceStatus(m)==='HANDLING').length;}
 function waitingCount(stsId){return [...liveMissions].filter(m=>m.sts===stsId&&serviceStatus(m)==='SUPPLYING').length;}
 function authorize(r,v){
  if(r.status!=='OPEN')return 'REQUEST_NOT_OPEN';
  if(!adapter.isVehicleFree(v))return 'VEHICLE_BUSY';
  const q=r.request;
  if(runningCount(q.qc.id)>=1&&waitingCount(q.qc.id)>=cfg.maxQueuedPerCrane)return 'STS_QUEUE_FULL';
  if(waitingCount(q.qc.id)>=cfg.maxQueuedPerCrane)return 'STS_QUEUE_FULL';
  return adapter.canReserve(q,v)||null;
 }
 function score(r,v){
  const q=r.request,from=adapter.pickup(q);
  const metres=Math.abs(v.x-from.x)+Math.abs(v.z-from.z);
  if(adapter.estimateArrival){
   const arrival=adapter.estimateArrival(q,v),forecast=adapter.serviceForecast(q.qc);
   // Predict lateness against the next physical service slot. Reuse only
   // breaks close ties: an opposite-direction mission cannot hide starvation.
   const paired=v.lastCompletedType&&v.lastCompletedType!==q.type;
   return Math.max(0,arrival.seconds-forecast.readyIn)*4+arrival.seconds-(paired?1:0);
  }
  const older=Math.min(240,(adapter.now()-r.created)*0.65);
  const idle=adapter.stsWaiting(q.qc);
  const waits=Math.min(180,idle*.12);
  const last=v.lastCompletedType;
  const paired=(last==='IMPORT'&&q.type==='EXPORT'||last==='EXPORT'&&q.type==='IMPORT');
  const cross=paired&&v.lastCompletedVesselCall&&v.lastCompletedVesselCall!==q.call.id;
  return metres-older-waits-(cross?175:paired?55:0);
 }
 function step(force=false){
  const now=adapter.now();if(!force&&now-metrics.lastDispatchAt<cfg.dispatchPeriod)return;
  metrics.lastDispatchAt=now;updateDemand();
  // Active reservations are retried before new assignments. A blocked mission
  // retains its container identity and its exact blocking reason.
  for(const m of liveMissions){
   const progress=adapter.progress(m);
   if(progress==='DONE') {m.state='DONE';m.reason=null;m.finished=now;metrics.finished++;liveMissions.delete(m);continue;}
   if(progress==='RUNNING'){if(m.state!=='RUNNING'&&m.started==null){metrics.started++;m.started=now;}m.state='RUNNING';m.reason=null;continue;}
   if(progress==='BLOCKED'){m.state='BLOCKED';m.reason=adapter.waitReason(m)||'TRANSPORT_BLOCKED';metrics.blockedReasons[m.reason]=(metrics.blockedReasons[m.reason]||0)+1;continue;}
   if(progress==='MOVING'){m.state='PREPOSITIONING';m.reason=null;continue;}
   if(progress==='STAGED'){m.state='READY_FOR_STS';m.reason=adapter.waitReason(m)||'WAITING_CRANE';}
   if(progress==='CANCELLED'){m.state='CANCELLED';m.reason='CANCELLED';liveMissions.delete(m);continue;}
   const result=adapter.start(m);
   if(result===true){m.state='RUNNING';m.reason=null;m.started=now;metrics.started++;continue;}
   const moved=adapter.preposition(m);
   if(moved===true){m.state='PREPOSITIONING';m.reason=null;metrics.prepositioned++;}
   else {m.reason=typeof result==='string'?result:typeof moved==='string'?moved:'WAITING_FOR_RESOURCES';
    m.state='WAITING';metrics.blockedReasons[m.reason]=(metrics.blockedReasons[m.reason]||0)+1;}
  }
  // Persistent demand first: choose a freely available AGV per STS rather
  // than attaching all idle vehicles to speculative work orders.
  const open=[...liveRequests].filter(r=>r.status==='OPEN'&&r.request.work.state==='PLANNED');
  const available=adapter.availableVehicles().filter(adapter.isVehicleFree);
  const assigned=new Set();
  // Fairness is a hard admission rule: give every operational STS its first
  // transport opportunity before adding successors to already-served cranes.
  // Resort dynamically after each reservation, otherwise the manifest order
  // of QC-01..QC-09 starves vessels at later berths.
  while(open.length){
   open.sort((a,b)=>{
    const load=r=>runningCount(r.request.qc.id)+waitingCount(r.request.qc.id);
    const urgency=r=>adapter.serviceForecast?adapter.serviceForecast(r.request.qc).readyIn:0;
    return load(a)-load(b)||urgency(a)-urgency(b)||
     (lastAllocation.get(a.request.qc.id)??-Infinity)-(lastAllocation.get(b.request.qc.id)??-Infinity)||a.created-b.created||a.key.localeCompare(b.key);
   });
   const r=open.shift();
   const evaluated=available.filter(v=>!assigned.has(v.id)).map(v=>({v,reason:authorize(r,v),score:score(r,v)}));
   const candidates=evaluated.filter(x=>!x.reason).sort((a,b)=>a.score-b.score||a.v.id.localeCompare(b.v.id));
   if(!candidates.length){r.reason=evaluated.length?(evaluated.find(x=>x.reason)?.reason||'RESOURCE_OR_CAPACITY_LIMIT'):'NO_AVAILABLE_AGV';continue;}
   const v=candidates[0].v,result=adapter.reserve(r.request,v,{requestedAt:r.created});
   if(!result){r.reason='RESERVATION_FAILED';continue;}
   assigned.add(v.id);r.status='ASSIGNED';r.reason=null;
   const mission={id:result.orderId,requestKey:r.key,sts:r.request.qc.id,
     vehicle:v.id,call:r.request.call.id,type:r.request.type,container:r.request.c.id,
     state:'WAITING',created:now,reason:'AWAITING_PHYSICAL_AUTHORIZATION'};
   missions.set(mission.id,mission);liveMissions.add(mission);metrics.assigned++;
   lastAllocation.set(mission.sts,now);
   const started=adapter.start(mission);
   if(started===true){mission.state='RUNNING';mission.started=now;metrics.started++;}
   else {const positioned=adapter.preposition(mission);
    if(positioned===true){mission.state='PREPOSITIONING';metrics.prepositioned++;}
    else mission.reason=typeof started==='string'?started:typeof positioned==='string'?positioned:'WAITING_FOR_RESOURCES';}
  }
 }
 function snapshot({includeHistory=true}={}){
  const live=[...liveMissions];
  const byReason={};for(const m of live)if(m.reason)byReason[m.reason]=(byReason[m.reason]||0)+1;
  return {demandTotal:requests.size,demandOutstanding:liveRequests.size,
   liveMissions:live.length,missionStates:Object.fromEntries([...new Set(live.map(m=>m.state))].map(k=>[k,live.filter(m=>m.state===k).length])),
   blockingReasons:byReason,requests:[...(includeHistory?requests.values():liveRequests)].map(r=>({id:r.key,status:r.status,reason:r.reason,sts:r.request.qc.id,
    type:r.request.type,container:r.request.c.id,age:+(adapter.now()-r.created).toFixed(1)})),
   missions:live.map(m=>({...m})),metrics:{...metrics,blockedReasons:{...metrics.blockedReasons}}};
 }
 return {step,updateDemand,authorize,score,snapshot,requests,missions,
  activeRequests:()=>liveRequests.values(),activeMissions:()=>liveMissions.values(),policy:cfg};
}
root.PortGridControl={createController,authorizeParkingDeparture,authorizeImportYard};
if(typeof module!=='undefined'&&module.exports)module.exports={createController,authorizeParkingDeparture,authorizeImportYard};
})(typeof globalThis!=='undefined'?globalThis:this);
