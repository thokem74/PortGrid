/* PORTGRID simulation engine. No Three.js or DOM dependency. */
/* Executes the enclosed helper or event callback */
( function(root){'use strict';
const PortGridControl=typeof module!=='undefined'&&module.exports?require('./portgrid-control.js'):root.PortGridControl;
const {createMonitor}=typeof module!=='undefined'&&module.exports?require('./portgrid-monitor.js'):root.PortGridMonitor;
const TRAVEL_PITCH=36, PARKING_CONNECTOR_X=-308;
const QUAY_TRAVEL_ROWS=[0,36,72,108];
const [QUAY_WESTBOUND_Z,QUAY_EASTBOUND_Z]=QUAY_TRAVEL_ROWS;
const YARD_MOUTH_Z=QUAY_TRAVEL_ROWS.at(-1);
const QUAY_COLUMNS=Array.from({length:21},(_,i)=>PARKING_CONNECTOR_X+i*TRAVEL_PITCH);
const STS_ACCESS=Array.from({length:9},(_,i)=>{
 const west=QUAY_COLUMNS[1+2*i+Math.floor(i/3)];
 const east=west+TRAVEL_PITCH;
 return {west,east,x:(west+east)/2,berth:Math.floor(i/3),id:'STS-SERVICE-'+(i+1)};
});
const STS_RAIL_GAP=32, STS_LIFT_CLEARANCE=28;
const SHIP_BAY_PITCH=10.8, SHIP_BAYS=18;
const BLOCK_GRID_X=QUAY_COLUMNS.slice(0,8);
const YARD_INCOMING_X=BLOCK_GRID_X.slice(0,4), YARD_OUTGOING_X=BLOCK_GRID_X.slice(4);
const YARD_SERVICE_X=BLOCK_GRID_X.at(-1)+TRAVEL_PITCH;
const YARD_X_SHIFT=237;
const L={
 shipX:[STS_ACCESS[1].x,STS_ACCESS[4].x,STS_ACCESS[7].x],stsX:STS_ACCESS.map(access=>access.x),
 shipZ:-152,stsZ:-95,stsDockZ:-60,stsRailGap:STS_RAIL_GAP,stsWheelOffsetsZ:[-18,11],
 shipHullLength:232,shipDeckLength:225,shipBridgeOffset:-105,shipBridgeLength:14,
 yards:Array.from({length:6},(_,i)=>{
  const inbound=i<3;
  return {id:(inbound?'IN':'OUT')+'-0'+(i%3+1),type:inbound?'inbound':'outbound',z:180+i*72};
 }),
 agvDockX:-221+YARD_X_SHIFT,truckDockX:221+YARD_X_SHIFT,
 truckInX:297+YARD_X_SHIFT,truckOutX:317+YARD_X_SHIFT,gateZ:579,
 agvOuterWestZ:-72,agvWestZ:-60,agvEastZ:-48,agvOuterEastZ:-36,
 yardStorageFirstX:-202+YARD_X_SHIFT,yardStorageStepX:12.25,yardStorageBays:34,yardTransferWidth:14,
 agvStorageMaxX:-40+YARD_X_SHIFT,truckStorageMinX:45+YARD_X_SHIFT
};
const STS_DOCK_LANES=[L.agvOuterWestZ,L.agvWestZ,L.agvEastZ,L.agvOuterEastZ];
const SHIP_STACKS=L.shipX.map(center=>Array.from({length:SHIP_BAYS},(_,bay)=>
 Array.from({length:5},(_,row)=>({x:center+(bay-(SHIP_BAYS-1)/2)*SHIP_BAY_PITCH,z:L.shipZ+(row-2)*6}))
).flat());
const YARD_SLOT_OFFSETS=[-10.5,-3.5,3.5,10.5];
/* Evaluates callback for YARD_SLOT_OFFSETS.map using dz, lane */
const  YARD_AGV_BAYS=L.yards.map( y=>YARD_SLOT_OFFSETS.map( (dz,lane)=>({x:L.agvDockX,z:y.z+dz,lane,yard:y.id,side:'agv'}))); /* AGV-accessible crane transfer positions for each yard block */
/* Evaluates callback for L.yards.map using y */
/* Evaluates callback for YARD_SLOT_OFFSETS.map using dz, lane */
const  YARD_TRUCK_BAYS=L.yards.map( y=>YARD_SLOT_OFFSETS.map( (dz,lane)=>({x:L.truckDockX,z:y.z+dz,lane,yard:y.id,side:'truck'}))); /* Truck-accessible crane transfer positions for each yard block */

const  dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z); /* Computes planar distance between two objects */
const  point=(x,z)=>({x,z});const  clone=p=>({x:p.x,z:p.z}); /* Builds a two-dimensional X/Z position */ /* Copies an X/Z position */
/* Constructs and owns the independent terminal simulation engine */
 function makeEngine(options={}){
 const  BODY_LONG=7.5, BODY_WIDE=2.65; /* Local value for body long in makeEngine() */ /* Local value for body wide in makeEngine() */
 const  bodyBounds=heading=>Math.abs(Math.cos(heading))>=Math.abs(Math.sin(heading))? /* Computes body bounds for the current simulation operation */
   {hx:BODY_LONG,hz:BODY_WIDE}:{hx:BODY_WIDE,hz:BODY_LONG};

 let  t=0, serial=0, jobSeq=0, orderSeq=0, moveCount=0, started=true, roadBlocked=0, craneWaits=0, truckOwner=null; /* Elapsed simulation time in seconds */ /* Counter used to issue unique container IDs */ /* Counter used to issue unique job IDs */ /* Counter used to issue unique order IDs */ /* Number of completed physical moves */ /* Whether simulation time advances */ /* Accumulated blocked traffic steps */ /* Count of crane-related waits */ /* Local value for west owner in makeEngine() */ /* Local value for truck owner in makeEngine() */
 const  containers=new Map(), history=[], jobs=[], orders=[], events=[], agvs=[], trucks=[], cranes=[], yardSlots=[]; /* Container records indexed by unique container ID */ /* Chronological container movement audit trail */ /* Physical handling and transport jobs */ /* Container transport orders */ /* Simulation events and diagnostic history */ /* Fleet of autonomous guided vehicles */ /* Fleet of gate trucks */ /* All physical crane equipment instances */ /* Physical yard storage slots with container stacks */
 const jobsById=new Map(), ordersById=new Map();
 const liveJobs=new Set(), liveOrders=new Set(), slotClaims=new Map();
 const completedByType={IMPORT:0,EXPORT:0,TRUCK_DELIVERY:0,TRUCK_PICKUP:0,YARD_RELAY:0};
 function claimSlot(job,slot){
  if(!slot)return;
  let owners=slotClaims.get(slot);
  if(!owners)slotClaims.set(slot,owners=new Set());
  owners.add(job);
 }
 function releaseSlot(job,slot){
  const owners=slotClaims.get(slot);
  if(!owners)return;
  owners.delete(job);
  if(!owners.size)slotClaims.delete(slot);
 }
 function currentSlotClaimed(slot){
  const owners=slotClaims.get(slot);
  if(owners)for(const job of owners)if(job.slot===slot)return true;
  return false;
 }
 function setJobSlot(job,slot){
  if(job.slot!==job.finalSlot&&job.slot!==job.buffer)releaseSlot(job,job.slot);
  job.slot=slot;
  claimSlot(job,slot);
 }
 function registerJob(job){
  jobs.push(job);
  jobsById.set(job.id,job);
  liveJobs.add(job);
  claimSlot(job,job.slot);
  claimSlot(job,job.finalSlot);
  claimSlot(job,job.buffer);
 }
 function completeJob(job){
  job.completed=true;
  liveJobs.delete(job);
  releaseSlot(job,job.slot);
  releaseSlot(job,job.finalSlot);
  releaseSlot(job,job.buffer);
  completedByType[job.type]++;
 }
 function jobForOrder(orderId){return jobsById.get(ordersById.get(orderId)?.job);}
 function liveJob(id){
  const job=jobsById.get(id);
  return job&&!job.completed?job:undefined;
 }
 const monitor=createMonitor({threshold:options.noProgressSeconds??60,emit:e=>log(e.type,e)});
 let lastMonitorAt=-Infinity;
 const eventCounts={};
 const arrivalDistances=new Map(),serviceSamples=new Map();
 const cycleMetrics={completed:0,actualEmptyMeters:0,unpairedGraphMeters:0,savedMeters:0};
 const yardMetrics=new Map();
 const turnReservations=new Map(), serviceReservations=new Map();
 let transferOwnershipViolations=0;
 function recordService(q,j){
  const started=q.type==='sts'?j.stsServiceStarted:j.rtgServiceStarted;
  if(started!=null){const duration=t-started,old=serviceSamples.get(q.id);serviceSamples.set(q.id,old==null?duration:.75*old+.25*duration);}
 }
 function serviceForecast(q){
  const cycle=serviceSamples.get(q.id)??75;
  const j=q.job?jobsById.get(q.job):null;
  const returnTime=q.type==='sts'&&!j?Math.abs(q.x-q.homeX)/9:0;
  return {readyIn:j?Math.max(0,cycle-(t-(j.stsServiceStarted??t))):returnTime,cycleSeconds:cycle};
 }
 // Static directed graph distances are cached by destination. Forecasting
 // never calls the mutating route planner, consumes RNG or grants movement.
 function graphDistance(from,to){
  const goal=gKey(to.x,to.z),allowParking=from.x<PARKING_CONNECTOR_X||to.x<PARKING_CONNECTOR_X;
  const apronBerth=p=>p.z<0?L.shipX.findIndex(x=>Math.abs(p.x-x)<=90):-1;
  const origin=apronBerth(from),target=apronBerth(to),cacheKey=goal+'|'+allowParking+'|'+origin;
  if(!arrivalDistances.has(cacheKey)){
   const reverse=new Map();
   for(const [id,edges] of AGV_GRID.edges)for(const edge of edges){
    if(!allowParking&&edge.zone.startsWith('PARKING'))continue;
    if(edge.section.berth!==null&&edge.section.berth!==origin&&edge.section.berth!==target)continue;
    if(!reverse.has(edge.to))reverse.set(edge.to,[]);
    reverse.get(edge.to).push({to:id,cost:dist(AGV_GRID.nodes.get(id),AGV_GRID.nodes.get(edge.to))});
   }
   const distances=new Map([[goal,0]]),open=[goal],done=new Set();
   while(open.length){
    let best=0;for(let i=1;i<open.length;i++)if(distances.get(open[i])<distances.get(open[best]))best=i;
    const id=open.splice(best,1)[0];if(done.has(id))continue;done.add(id);
    for(const edge of reverse.get(id)||[]){const cost=distances.get(id)+edge.cost;if(cost<(distances.get(edge.to)??Infinity)){distances.set(edge.to,cost);open.push(edge.to);}}
   }
   arrivalDistances.set(cacheKey,distances);
  }
  const nodes=arrivalDistances.get(cacheKey),key=gKey(from.x,from.z);
  if(nodes.has(key))return nodes.get(key);
  const nearest=[...AGV_GRID.nodes.values()].reduce((a,b)=>dist(from,b)<dist(from,a)?b:a);
  return dist(from,nearest)+(nodes.get(gKey(nearest.x,nearest.z))??Infinity);
 }
 function estimateArrival(q,v){
  const stsStand={x:q.qc.homeX,z:L.stsDockZ};
  let distance,handling=0;
  const approach=target=>{
   if(v.x<-360&&v.z>-40&&v.z<170){
    const west=v.home.x<-420,exitX=west?-462:-414,exitZ=west?-24:-36;
    return Math.abs(v.x-exitX)+Math.abs(v.z-exitZ)+Math.abs(exitX+308)+graphDistance({x:-308,z:exitZ},target);
   }
   return graphDistance(v,target);
  };
  if(q.type==='IMPORT')distance=approach(stsStand);
  else {
   const bi=q.c.yard,bay=YARD_AGV_BAYS[bi][0];
   distance=approach(bay)+graphDistance(bay,stsStand);
   const crane=rtgAgv[bi],job=jobsById.get(crane.job);
   const cycle=serviceSamples.get(crane.id)??30;
   handling=cycle+(job?Math.max(0,cycle-(t-(job.rtgServiceStarted??t))):0);
  }
  const congestion=Math.min(30,agvs.filter(a=>a!==v&&a.route.length&&dist(a,v)<50).length*2);
  let exitWait=0;
  if(v.x<-360)for(const other of agvs){
   if(other===v||other.home.x!==v.home.x||other.x>=-308)continue;
   const west=other.home.x<-420,exitX=west?-462:-414,exitZ=west?-24:-36;
   if(other.pending||other.route.length&&['sts','yard','staging'].includes(other.routeIntent?.type))
    exitWait+=(Math.abs(other.x-exitX)+Math.max(0,other.z-exitZ)+Math.abs(exitX+308))/Math.max(.1,other.speed);
  }
  return {distance,seconds:distance/Math.max(.1,v.speed)+handling+congestion+exitWait};
 }
 const  rng=options.rng||Math.random; /* Local value for rng in makeEngine() */
 // Time-integrated equipment KPIs: a reserved crane is not necessarily lifting.
 let  kpiSampleAccumulator=0;const  kpiCrane=new Map();const  kpiFleet={movingLoaded:0,movingEmpty:0,craneHandling:0,parkedAssigned:0,parkedUnassigned:0,trafficWait:0,queueWait:0,productive:0,observation:0}; /* Accumulator controlling periodic KPI sampling */ /* Elapsed working, lifting, and waiting times recorded per STS crane */ /* Time-integrated AGV movement, handling, parking, and queue occupancy */
 /* Returns or initializes the KPI accumulator for a specified crane */
  function craneMetric(q){if(!kpiCrane.has(q.id))kpiCrane.set(q.id,{working:0,lifting:0,waitingAGV:0,waitingWork:0,unavailable:0,readyIdle:0,waitCauses:{},stateSeconds:{},evidencedSchedulerSeconds:0});return kpiCrane.get(q.id)}
 function observeSTS(q,call){
  const owned=q.job?liveJob(q.job):null;
  const pending=[...call.discharge,...call.load].filter(w=>w.crane===q.id&&w.state!=='DONE');
  const supply=[...liveJobs].filter(j=>j.order?.crane===q.id&&!(j.type==='IMPORT'&&j.pickupCraneReleased));
  const selected=supply.find(j=>j.vehicle?.state==='DOCKED')||supply[0],v=selected?.vehicle;
  const result=(state,resource=null,evidence=null)=>({state,blockingResourceId:resource,job:selected?.id||null,vehicleId:v?.id||null,evidence});
  if(q.downUntil>t)return result('CRANE_OUTAGE',q.id);
  if(owned&&((owned.type==='IMPORT'&&owned.stage==='PICK')||(owned.type==='EXPORT'&&owned.stage==='PLACE')))return result('HANDLING');
  if(!owned&&stsSweeps.has(q.id))return result('STS_RAIL_RETURN',q.id);
  if(selected?.stsRailBlocker)return result('STS_RAIL_CLEARANCE',selected.stsRailBlocker);
  if(!pending.length)return result('WORKLIST_EXHAUSTED');
  if(v){
   if(v.route.length)return result(v.blockedTime>4?'TRAFFIC_CONSTRAINT':'AGV_TRANSIT',v.trafficBlock?.resource||v.id);
   if(v.x<-350)return result('PARKING_DISPATCH',agvs.find(a=>a!==v&&a.home.x===v.home.x&&a.route.length&&a.x<-308)?.id||v.id);
   if(selected.preposition)return result('RESOURCE_AUTHORIZATION',selected.order.id);
   if(selected.type==='EXPORT'&&['TO_PICKUP','PICK'].includes(selected.stage))return result('YARD_SERVICE',selected.rtg?.id);
   if(!q.job&&alignedAtSTS(v,q,selected.stsDockZ)&&t-(selected.stsArrivedAt??t)>.25)
    return result('SCHEDULER_DELAY',q.id,{action:'BEGIN_ALIGNED_HANDOVER',missionId:selected.order.id,vehicleId:v.id});
   return result('TRANSFER_CLEARANCE',q.id);
  }
  const phase=vesselWorkPhase(call);
  if(phase==='DISCHARGING'&&!topShip(q).length){
   const delivering=[...liveJobs].find(j=>j.order?.crane===q.id&&j.type==='IMPORT'&&j.pickupCraneReleased);
   return result(delivering?'DISCHARGE_DELIVERY_BARRIER':'VESSEL_PHASE_BARRIER',delivering?.rtg?.id||call.id);
  }
  const open=[...coordinator.activeRequests()].find(r=>r.status==='OPEN'&&r.request.qc.id===q.id&&r.request.work.state==='PLANNED');
  if(!open)return result('INACCESSIBLE_CARGO',pending[0].container);
  const free=agvs.filter(vehicleDispatchable);
  const feasible=free.find(v=>parkingDepartureAuthorized(v)&&coordinator.authorize(open,v)===null);
  if(feasible&&t-open.created>.25)return result('SCHEDULER_DELAY',q.id,{action:'ALLOCATE_FREE_AGV',vehicleId:feasible.id,requestKey:open.key});
  if(!free.length)return result('FLEET_CAPACITY','AGV_FLEET');
  return result('YARD_OR_STAND_CAPACITY',open.reason||'YARD_ADMISSION');
 }
 /* Accumulates time spent in crane and AGV operational states */
  function sampleKPI(dt){
   for(const  q of sts){ /* Current crane or queued item in sampleKPI() */
     const  m=craneMetric(q), call=activeCall(q.ship);
     const previousCause=m.currentCause;m.currentCause=null; /* Local value for m in sampleKPI() */ /* Vessel call being processed in sampleKPI() */
     if(!call){m.unavailable+=dt;continue;}
     m.working+=dt;
     const observed=observeSTS(q,call);
     m.stateSeconds[observed.state]=(m.stateSeconds[observed.state]||0)+dt;
     if(observed.evidence)m.evidencedSchedulerSeconds+=dt;
     if(m.observation?.state!==observed.state||m.observation?.blockingResourceId!==observed.blockingResourceId)
      log('STS_STATE_CHANGED',{sts:q.id,call:call.id,fromState:m.observation?.state||null,toState:observed.state,
       blockingReason:observed.state==='HANDLING'?null:observed.state,blockingResourceId:observed.blockingResourceId,
       vehicle:observed.vehicleId,job:observed.job,evidence:observed.evidence});
     m.observation=observed;
     if(q.downUntil>t){m.unavailable+=dt;continue;}
     const  job=liveJob(q.job); /* Transport or crane job being processed in sampleKPI() */
     const  lifting=job&&(job.type==='IMPORT'&&job.stage==='PICK'||job.type==='EXPORT'&&job.stage==='PLACE'); /* Local value for lifting in sampleKPI() */
     if(lifting){m.lifting+=dt;continue;}
     /* Evaluates callback for call.discharge.some using w */
     /* Evaluates callback for call.load.some using w */
     const  pending=call.discharge.some( w=>w.crane===q.id&&w.state!=='DONE')||call.load.some( w=>w.crane===q.id&&w.state!=='DONE'); /* Local value for pending in sampleKPI() */
     if(!pending){m.waitingWork+=dt;continue;}
     /* Evaluates callback for call.load.some using w */
     const  ready=topShip(q).length>0||(vesselWorkPhase(call)==='LOADING'&&call.load.some( w=>w.crane===q.id&&w.state==='PLANNED')); /* Local value for ready in sampleKPI() */
     if(job||ready||observed.state==='STS_RAIL_CLEARANCE'){
       // The legacy aggregate remains available, but every waiting interval is
       // now attributed to a concrete cause for controller optimization.
       m.waitingAGV+=dt;
       const matching=[...coordinator.activeMissions()].filter(x=>{
        const job=jobForOrder(x.id);
        return x.sts===q.id&&!(job?.type==='IMPORT'&&job.pickupCraneReleased);
       });
       const mission=matching.find(x=>x.state==='RUNNING')||matching[0];
       const request=[...coordinator.activeRequests()].find(r=>r.request.qc.id===q.id&&r.status==='OPEN'&&r.request.work.state==='PLANNED');
       const vehicle=mission?agvs.find(v=>v.id===mission.vehicle):null;
       const yardBlocked=L.yards.filter(y=>y.type==='inbound').every((y,bi)=>
         !freeSlot(bi,'agv',false)||[...liveJobs].filter(j=>!j.preposition&&j.type==='IMPORT'&&j.order.yard===bi).length>=TRANSPORT_POLICY.maxActiveImportsPerYard);
       const reason=observed.state==='STS_RAIL_CLEARANCE'?'STS_RAIL_CLEARANCE':vehicle?.blockedTime>4?'TRAFFIC_OBSTRUCTION':
         vehicle?.route.length?'AGV_IN_TRANSIT':
         vehicle?.x<-350?'PARKING_DISPATCH_WAIT':
         mission?.reason||
         request?.reason||
         (yardBlocked?'DOWNSTREAM_YARD_CAPACITY':'STS_UNSERVED_DEMAND');
       m.currentCause=reason;if(previousCause!==reason)m.waitStarted=t-dt;
       m.waitCauses[reason]=(m.waitCauses[reason]||0)+dt;
       continue;
     }
     m.readyIdle+=dt;
   }
   kpiFleet.observation+=dt;
   for(const crane of rtgs){
    let m=yardMetrics.get(crane.id);
    if(!m){m={observed:0,busy:0,moving:0,x:crane.hook.x,y:crane.hook.y,z:crane.hook.z};yardMetrics.set(crane.id,m);}
    m.observed+=dt;if(crane.job&&crane.downUntil<=t)m.busy+=dt;
    if(Math.hypot(crane.hook.x-m.x,crane.hook.y-m.y,crane.hook.z-m.z)>.01)m.moving+=dt;
    m.x=crane.hook.x;m.y=crane.hook.y;m.z=crane.hook.z;
   }
   for(const  v of agvs){ /* Current vehicle or value being processed in sampleKPI() */
     const  assigned=!!(v.job||v.pending||v.pipelineJob); /* Items currently assigned to equipment in sampleKPI() */
     const  moving=v.route.length&&activePermits.has(v.id); /* Local value for moving in sampleKPI() */
     const  job=v.job?liveJob(v.job):null; /* Transport or crane job being processed in sampleKPI() */
     const handlingCrane=job&&(job.stage==='PICK'?(job.type==='IMPORT'?job.sts:job.rtg):job.type==='IMPORT'?job.rtg:job.sts);
     const atCrane=job&&!job.preposition&&['PICK','PLACE'].includes(job.stage)&&job.phase&&
      handlingCrane?.job===job.id&&handlingCrane.downUntil<=t&&!v.route.length&&v.x>-350;
     // Mutually exclusive AGV fleet-time states; never count a reserved
     // but parked AGV as doing a crane handover.
     if(moving){if(v.load)kpiFleet.movingLoaded+=dt;else kpiFleet.movingEmpty+=dt;}
     else if(assigned&&v.x<-350&&!v.route.length)kpiFleet.parkedAssigned+=dt;
     else if(atCrane)kpiFleet.craneHandling+=dt;
     else if(v.route.length)kpiFleet.trafficWait+=dt;
     else if(assigned)kpiFleet.queueWait+=dt;
     else kpiFleet.parkedUnassigned+=dt;
     if(moving||atCrane)kpiFleet.productive+=dt;
   }
 }
 /* Computes canonical time-integrated terminal performance measurements */
  function getKPI(){
   /* Evaluates callback for sts.map using q */
   const  craneRows=sts.map( q=>{const  m=craneMetric(q), call=activeCall(q.ship), hours=m.working/3600; /* Local value for crane rows in getKPI() */ /* Local value for m in getKPI() */ /* Vessel call being processed in getKPI() */ /* Local value for hours in getKPI() */
     const  reason=!call?'NO WORKING VESSEL':q.downUntil>t?'CRANE OUTAGE':q.job?'CRANE JOB '+q.job:'WAITING FOR AGV / AVAILABLE WORK'; /* Local value for reason in getKPI() */
     return {id:q.id,berth:q.ship+1,completed:q.completed,grossMPH:hours?q.completed/hours:0,
       utilization:m.working?100*m.lifting/m.working:0,avoidableIdle:m.waitingAGV,liftSeconds:m.lifting,workingSeconds:m.working,
       noWorkSeconds:m.waitingWork,blockedSeconds:m.readyIdle,unavailableSeconds:m.unavailable,waitCauses:{...m.waitCauses},state:reason,
       stateSeconds:{...m.stateSeconds},evidencedSchedulerSeconds:m.evidencedSchedulerSeconds,observation:m.observation||null,
       serviceForecast:serviceForecast(q)};
   });
   /* Evaluates callback for craneRows.reduce using v, r */
   const  total=craneRows.reduce( (v,r)=>v+r.avoidableIdle,0); /* Local value for total in getKPI() */
   const  observed=Math.max(1,kpiFleet.observation*agvs.length); /* Local value for observed in getKPI() */
   /* Evaluates callback for craneRows.reduce using a, r */
   /* Evaluates callback for craneRows.reduce using a, r */
   return {time:t,sts:craneRows,avoidableSTSSecs:total,avoidableSTSPercent:craneRows.reduce( (a,r)=>a+r.workingSeconds,0)?100*total/craneRows.reduce( (a,r)=>a+r.workingSeconds,0):0,
      /* Evaluates callback for craneRows.reduce using a, r */
      /* Evaluates callback for craneRows.reduce using a, r */
      craneGrossMovesPerHour:craneRows.reduce( (a,r)=>a+r.completed,0)/Math.max(1,craneRows.reduce( (a,r)=>a+r.workingSeconds,0))*3600,
      fleet:{productivePercent:100*kpiFleet.productive/observed,parkedAssignedPercent:100*kpiFleet.parkedAssigned/observed,
        loadedTravelPercent:100*kpiFleet.movingLoaded/observed,emptyTravelPercent:100*kpiFleet.movingEmpty/observed,
        craneHandlingPercent:100*kpiFleet.craneHandling/observed,queueWaitPercent:100*kpiFleet.queueWait/observed,trafficWaitPercent:100*kpiFleet.trafficWait/observed,parkedUnassignedPercent:100*kpiFleet.parkedUnassigned/observed,observationVehicleSeconds:observed},
      /* Evaluates callback for rtgs.map using q */
      yard:rtgs.map(q=>({id:q.id,yard:q.yard+1,side:q.role,completed:q.completed,throughput:3600*q.completed/Math.max(1,t),currentJob:q.job||'IDLE',
       queueLength:[...liveJobs].filter(j=>j.rtg===q&&j.vehicle?.state==='DOCKED'&&j.id!==q.job).length,
       busySeconds:yardMetrics.get(q.id)?.busy||0,hookMotionSeconds:yardMetrics.get(q.id)?.moving||0,
       utilizationPercent:100*(yardMetrics.get(q.id)?.busy||0)/Math.max(1,yardMetrics.get(q.id)?.observed||0),
       serviceCycleSeconds:serviceSamples.get(q.id)??null})),
      totalMoves:moveCount,importMoves:completedByType.IMPORT,exportMoves:completedByType.EXPORT,
      /* Evaluates callback for events.filter using e */
      /* Evaluates callback for agvs.reduce using n, v */
      /* Evaluates callback for agvs.reduce using n, v */
      stsWaitBreakdown:(()=>{const total={};for(const row of craneRows)for(const [name,seconds] of Object.entries(row.waitCauses))total[name]=(total[name]||0)+seconds;return total;})(),
      schedulerDelaySeconds:craneRows.reduce((sum,row)=>sum+Object.entries(row.waitCauses).filter(([name])=>
        ['STS_UNSERVED_DEMAND','PARKING_DISPATCH_WAIT','PARKING_EXIT_CONFLICT','TRAFFIC_OBSTRUCTION'].includes(name)).reduce((v,[,sec])=>v+sec,0),0),
      evidencedSchedulerSeconds:craneRows.reduce((sum,row)=>sum+row.evidencedSchedulerSeconds,0),
      doubleCycleDistance:{...cycleMetrics},
      unclassifiedSTSSeconds:craneRows.reduce((sum,row)=>sum+Math.max(0,row.workingSeconds-Object.values(row.stateSeconds).reduce((a,b)=>a+b,0)),0),
       dualCycles:eventCounts.AGV_DOUBLE_CYCLE_ASSIGNED||0,agvEmptyShare:( ()=>{const  a=agvs.reduce( (n,v)=>n+v.emptyMeters,0), b=agvs.reduce( (n,v)=>n+v.loadedMeters,0);return a+b?100*a/(a+b):0})()}; /* Evaluates inline calculation callback */ /* First item being compared in getKPI() */ /* Second item being compared in getKPI() */
 }
 /* Appends a structured simulation event for auditing and troubleshooting */
  function log(type,detail={}){
   const actor=[...agvs,...trucks].find(v=>v.id===(detail.vehicle||detail.agv));
   const jobId=Object.hasOwn(detail,'job')?detail.job:actor?.job||actor?.pipelineJob;
   const job=jobId?jobsById.get(jobId):null;
   const order=job?.order||(detail.order?ordersById.get(detail.order):null)||
    (!Object.hasOwn(detail,'job')&&actor?.pending?ordersById.get(actor.pending):null);
   const e={simulationTime:+t.toFixed(2),time:+t.toFixed(2),type,vehicleId:detail.vehicle||detail.agv||job?.vehicle?.id||null,
    vesselCallId:detail.call||order?.vesselCall||null,stsId:detail.sts||order?.crane||null,missionId:order?.id||null,
    containerId:detail.container||job?.container?.id||null,fromState:null,toState:null,blockingReason:null,blockingResourceId:null,routeOrReservationId:order?.id||null,...detail,
    type,operationType:detail.type&&detail.type!==type?detail.type:null};eventCounts[type]=(eventCounts[type]||0)+1;events.push(e);if(options.onEvent)options.onEvent(e);if(events.length>7000)events.shift();return e} /* Configuration or state record for e */
 /* Creates an identified physical container with initial location and metadata */
  function cont(site,position,opts={}){
  const  id='PG'+String(++serial).padStart(8,'0'); const  c={id,site,x:position.x,z:position.z,y:opts.y||1.45,level:opts.level||0, /* Identifier of the selected entity in cont() */ /* Current container or item being processed in cont() */
   color:opts.color||Math.floor(rng()*7),direction:opts.direction||'inbound',ship:opts.ship??null,yard:opts.yard??null,
   slot:opts.slot??null,carrier:null,order:null,history:[]};containers.set(id,c);trace(c,'INITIAL',site);return c;
 }
 /* Records a container movement in per-container and global audit histories */
  function trace(c,action,location){const  ev={time:+t.toFixed(2),action,location,carrier:c.carrier?.id||null,x:+c.x.toFixed(1),z:+c.z.toFixed(1)};c.history.push(ev);history.push({container:c.id,...ev});if(history.length>150000)history.shift();} /* Configuration or state record for ev */
 /* Transfers container ownership to the specified equipment */
  function moveCargo(c,owner,action){c.site=owner.type;c.carrier=owner;c.ship=null;c.yard=null;c.slot=null;trace(c,action,owner.id)}
 /* Builds the state model of a ship-to-shore or yard crane */
  function makeCrane(kind,id,x,z,opts={}){const  k={type:kind,id,x,z,homeX:x,homeZ:z,hook:{x,z,y:22,heading:0},target:null,carrying:null,job:null,stage:'IDLE',ship:opts.ship,yard:opts.yard,role:opts.role||null,downUntil:options.craneOutages?.[id]??0,completed:0};cranes.push(k);return k} /* Current loop key or index in makeCrane() */
 /* Evaluates callback for L.stsX.map using x, i */
 const  sts=L.stsX.map( (x,i)=>makeCrane('sts','QC-'+String(i+1).padStart(2,'0'),x,L.stsZ,{ship:Math.floor(i/3)})); /* Nine ship-to-shore cranes, three allocated to each berth */
 /* Evaluates callback for L.yards.map using y, i */
 const  rtgAgv=L.yards.map( (y,i)=>makeCrane('rtg','YC-A'+String(i+1).padStart(2,'0'),YARD_X_SHIFT-86,y.z,{yard:i,role:'agv'})); /* Yard cranes assigned to AGV-side operations */
 /* Evaluates callback for L.yards.map using y, i */
 const  rtgTruck=L.yards.map( (y,i)=>makeCrane('rtg','YC-T'+String(i+1).padStart(2,'0'),YARD_X_SHIFT+86,y.z,{yard:i,role:'truck'})); /* Yard cranes assigned to truck-side operations */
 const  rtgs=[...rtgAgv,...rtgTruck]; /* All yard cranes serving AGVs and trucks */
 const  YARD_RAIL_GAP=40; // minimum gantry-centre separation on common rails /* Minimum permitted separation between shared-rail yard cranes */
 // Both RTGs may use the entire working block, with outer sidings to yield.
 // The AGV-side crane must remain to the left of the truck-side crane.
 // The gantry itself travels onto the AGV and truck transfer positions.
 const railLimits={min:L.agvDockX,max:L.truckDockX};
 const YARD_LIMITS={agv:railLimits,truck:railLimits}; /* Physical travel limits of both yard-crane gantries */
 const  YARD_AGV_CLEAR_X=YARD_X_SHIFT-70, YARD_TRUCK_CLEAR_X=YARD_X_SHIFT+70; /* World-coordinate value for yard agv clear x */ /* World-coordinate value for yard truck clear x */
 let  completedRelays=0; /* Local value for completed relays in makeEngine() */
 const  lastRelayAt=Array(L.yards.length).fill(-400); /* Simulation timestamp for last relay at */
 const  yardCraneIncidents=[]; /* Collection of yard crane incidents */
 const stsSweeps=new Map();
 let stsRailViolations=0;
 const berthCranes=L.shipX.map((_,berth)=>sts.filter(q=>q.ship===berth));
 const stsNeighbors=new Map(berthCranes.flatMap(group=>group.map((q,i)=>
  [q,[group[i-1],group[i+1]].filter(Boolean)])));
 const shipBays=SHIP_STACKS.map((stacks,berth)=>stacks.map(stack=>{
  const [primary,neighbor]=berthCranes[berth].slice().sort((a,b)=>
   Math.abs(a.homeX-stack.x)-Math.abs(b.homeX-stack.x));
  const clearance=q=>stsNeighbors.get(q).every(other=>Math.abs(other.homeX-stack.x)>=STS_RAIL_GAP);
  if(!clearance(primary))throw Error('Unreachable ship bay '+stack.x);
  return {...stack,cranes:[primary,...(clearance(neighbor)?[neighbor]:[])]};
 }));
 const shipBayByX=shipBays.map(stacks=>new Map(stacks.map(stack=>[stack.x,stack])));
 function stsSweepBlocker(crane,sweep){
  return stsNeighbors.get(crane).find(other=>{
   const adjacent=stsSweeps.get(other.id)||{min:other.x,max:other.x};
   return other.homeX<crane.homeX?sweep.min-adjacent.max<STS_RAIL_GAP-1e-6:
    adjacent.min-sweep.max<STS_RAIL_GAP-1e-6;
  });
 }
 /* Checks whether an RTG can reach a horizontal position */
  function craneReachable(crane,x){
  if(!crane||crane.type!=='rtg')return true;
  const  lim=YARD_LIMITS[crane.role];return !!lim&&x>=lim.min-.001&&x<=lim.max+.001; /* Local value for lim in craneReachable() */
 }
 /* Checks whether the RTG hook can reach a requested pickup coordinate */
  function craneHookReachable(crane,x){
  // The RTG spreader stays directly beneath its travelling gantry body.
  return craneReachable(crane,x);
 }
 /* Prevents two gantries from violating separation on shared rails */
  function craneRailSafe(crane,nextX){
  if(!craneReachable(crane,nextX))return false;
  const  other=(crane.role==='agv'?rtgTruck:rtgAgv)[crane.yard]; /* Local value for other in craneRailSafe() */
  if(!other)return false;
  // Cranes on the same longitudinal rails cannot pass or occupy the same envelope.
  if(crane.role==='agv'&&nextX+YARD_RAIL_GAP>other.x+1e-6)return false;
  if(crane.role==='truck'&&nextX-YARD_RAIL_GAP<other.x-1e-6)return false;
  return true;
 }

 function populateShip(berth,z,initial){
  const ids=[];
  for(const stack of shipBays[berth]){
   const tiers=initial?(options.dischargePerCall>120?4:2+Math.floor(rng()*2)):
    (vesselConfig.dischargePerCall>90?4:2);
   for(let tier=0;tier<tiers;tier++){
    ids.push(cont('ship',point(stack.x,stack.z+z-L.shipZ),{
     y:5.7+tier*2.8,level:tier,ship:berth,direction:'inbound'
    }).id);
   }
  }
  return ids;
 }
 const initialShipCargo=L.shipX.map((_,berth)=>populateShip(berth,L.shipZ,true));
 // Each yard has two separate transfer corridors (outside the storage footprint):
 // AGV at x=L.agvDockX, truck at x=L.truckDockX. Everything between the
 // corridors is a real container-storage grid with NO missing middle bays.
 // The serviceZone on storage slots is a crane-access designation, not an
 // empty transfer area: even end service-zone columns hold real containers.
 for(let  bi=0;bi<L.yards.length;bi++){ /* Index of the current yard block in makeEngine() */
  const  y=L.yards[bi];for(let  bay=0;bay<L.yardStorageBays;bay++)for(let  row=0;row<4;row++){ /* Vertical world coordinate in makeEngine() */ /* Local value for bay in makeEngine() */ /* Current grid row or formatted table record in makeEngine() */
   const  x=L.yardStorageFirstX+bay*L.yardStorageStepX, z=y.z+(row-1.5)*3.1; /* Horizontal world coordinate in makeEngine() */ /* Longitudinal world coordinate in makeEngine() */
   const  zone=bay<=1?'agv':bay>=L.yardStorageBays-2?'truck':'shared'; /* Local value for zone in makeEngine() */
   yardSlots.push({yard:bi,bay,row,x,z,zone,stack:[]});
  }
 }
 // Verify the visual transfer corridors cannot overlap container footprints.
 const  minStorageX=L.yardStorageFirstX-5, maxStorageX=L.yardStorageFirstX+(L.yardStorageBays-1)*L.yardStorageStepX+5; /* World-coordinate value for min storage x */ /* World-coordinate value for max storage x */
 if(!(minStorageX>L.agvDockX+L.yardTransferWidth/2&&maxStorageX<L.truckDockX-L.yardTransferWidth/2))
  throw Error('Yard storage overlaps an AGV or truck transfer corridor');
 for(const  slot of yardSlots){ /* Current storage or transfer slot in makeEngine() */
  // Use the full yard for storage. Only narrow end areas support direct
  // AGV and truck handoff, while the rest of the block stores containers.
  const  r=rng(); /* Local value for r in makeEngine() */
  let  count=r<.025?0:r<.38?1:r<.84?2:3; /* Local value for count in makeEngine() */
  // Incoming blocks keep some stacking capacity for vessels, not a wide gap.
  if(L.yards[slot.yard].type==='inbound'&&count===3&&rng()<.55)count=2;
  for(let  lev=0;lev<count;lev++){ /* Local value for lev in makeEngine() */
   const  c=cont('yard',point(slot.x,slot.z),{y:1.45+lev*2.8,level:lev,yard:slot.yard,slot:slot.yard+'-'+slot.bay+'-'+slot.row,direction:L.yards[slot.yard].type});slot.stack.push(c.id); /* Current container or item being processed in makeEngine() */
  }
 }
 // 24 AGVs, compact parking grid remains inland; active waiting happens at
 // dedicated standby pockets beside the STS apron, not on the live transfer lanes.
 for(let  i=0;i<24;i++){ /* Loop index for the current collection in makeEngine() */
  const  row=i%12, col=Math.floor(i/12), x=col?-396:-444, z=7+row*12; /* Current grid row or formatted table record in makeEngine() */ /* Current grid column in makeEngine() */ /* Horizontal world coordinate in makeEngine() */ /* Longitudinal world coordinate in makeEngine() */
  agvs.push({id:'AGV-'+String(i+1).padStart(2,'0'),type:'agv',x,z,heading:0,speed:15,job:null,load:null,route:[],routeIndex:0,
    state:'PARKED',home:point(x,z),completed:0,loadedMeters:0,emptyMeters:0,blocked:0,blockedTime:0,priority:0});
 }
 // Truck parking is outside the yard, on the landside apron.
 for(let  i=0;i<12;i++){ /* Loop index for the current collection in makeEngine() */
  const  x=L.truckOutX+31+Math.floor(i/6)*19, z=L.yards[i%6].z-5+Math.floor(i/6)*16; /* Horizontal world coordinate in makeEngine() */ /* Longitudinal world coordinate in makeEngine() */
  trucks.push({id:'TRK-'+String(i+1).padStart(2,'0'),type:'truck',x,z,heading:0,speed:12,job:null,load:null,route:[],routeIndex:0,
   state:'GATE',home:point(x,z),completed:0,loadedMeters:0,emptyMeters:0,blocked:0,blockedTime:0,priority:0});
 }
 // Vessel-call planning: three physical berths, manifest-owned cargo orders and
 // stateful approach / mooring / working / departure. No timer can complete cargo.
 const  vesselCalls=[], berths=Array(3).fill(null); /* All scheduled, working, and completed vessel calls */ /* Current vessel occupying each of the three berths */
 let  vesselSerial=0, completedVesselCalls=0, manifestViolations=0; /* Local value for vessel serial in makeEngine() */ /* Local value for completed vessel calls in makeEngine() */ /* Local value for manifest violations in makeEngine() */
 const  FUTURE_STATES=new Set(['SCHEDULED','WAITING_BERTH','APPROACHING']); /* States identifying vessels that are not yet operating at the berth */
 const  vesselConfig={dischargePerCall:options.dischargePerCall??12, /* Workload, arrival, approach, and departure settings for vessel calls */
   loadPerCall:options.loadPerCall??8,arrivalDelay:options.arrivalDelay??70,
   approachSpeed:options.approachSpeed??3.5,departureSpeed:options.departureSpeed??4.5};
 /* Adds a discharge or load task to a vessel manifest */
  function appendManifest(call,kind,c,stow=null){
  const  rec={container:c.id,action:kind,state:'PLANNED',bay:Math.round(c.x),row:Math.round(c.z),tier:Math.round(c.y),plannedPosition:stow}; /* Configuration or state record for rec */
  if(kind==='DISCHARGE')rec.crane=shipBayByX[call.berth].get(c.x).cranes[0].id;
  (kind==='DISCHARGE'?call.discharge:call.load).push(rec);
  if(kind==='DISCHARGE')c.dischargeCall=call.id;
  else c.loadCall=call.id;
  return rec;
 }
 /* Reserves eligible outbound containers for a vessel work list */
  function bookExports(call){
  const  qty=Math.max(0,vesselConfig.loadPerCall-(call.state==='SCHEDULED'?(options.truckExportQuota??1):0)); /* Local value for qty in bookExports() */
  /* Evaluates callback for yardSlots.filter using s */
  const blocks=L.yards.flatMap((yard,bi)=>{
   if(yard.type!=='outbound')return [];
   const candidates=yardSlots.filter(slot=>slot.yard===bi&&slot.x<=L.agvStorageMaxX&&slot.stack.length)
     .map(slot=>containers.get(slot.stack.at(-1)));
   const committed=candidates.filter(c=>c.loadCall&&c.site==='yard').length;
   const available=candidates.filter(c=>!c.loadCall&&!c.order&&c.site==='yard').sort((a,b)=>a.x-b.x);
   return [{bi,committed,available}];
  });
  for(let i=0;i<qty;i++){
   const next=blocks.filter(block=>block.available.length)
    .sort((a,b)=>a.committed-b.committed||a.bi-b.bi)[0];
   if(!next)break;
   appendManifest(call,'LOAD',next.available.shift());
   next.committed++;
  }
 }
 /* Assigns loading tasks to STS territories and ship stowage positions */
  function planStowage(call){
  /* Evaluates callback for call.discharge.map using w */
  const  discharged=new Set(call.discharge.map( w=>w.container)); /* Unique values for discharged */
  const remainingTops=new Map();
  for(const id of call.shipContainers){
   const c=containers.get(id);
   if(!c||discharged.has(id))continue;
   const key=gKey(c.x,c.z);
   remainingTops.set(key,Math.max(remainingTops.get(key)||5.7,c.y+2.8));
  }
  const stacks=shipBays[call.berth].map(({x,z,cranes})=>({
   x,z,y:remainingTops.get(gKey(x,z+call.z-L.shipZ))||5.7,crane:cranes[0]
  }));
  for(let  i=0;i<call.load.length;i++){ /* Loop index for the current collection in planStowage() */
   const  w=call.load[i]; /* Local value for w in planStowage() */
   const crane=berthCranes[call.berth][i%3];
   const choices=stacks.filter(p=>p.y<21);
   if(!choices.length){w.state='EXCEPTION';w.reason='NO_STOWAGE_CAPACITY';continue}
   choices.sort((a,b)=>Number(b.crane===crane)-Number(a.crane===crane)||a.y-b.y||
    Math.abs(a.x-crane.homeX)-Math.abs(b.x-crane.homeX));
   const chosen=choices[0];w.crane=chosen.crane.id;
   w.plannedPosition={x:chosen.x,z:chosen.z,y:chosen.y};
   chosen.y+=2.8;
  }
 }
 /* Creates a scheduled vessel and its physical discharge/load manifest */
  function makeVesselCall(berth,initial=false,etaOverride=null){
  const  id='VC-'+String(++vesselSerial).padStart(4,'0'); /* Identifier of the selected entity in makeVesselCall() */
  const  call={id,name:'PORTGRID '+String(vesselSerial).padStart(3,'0'),berth, /* Vessel call being processed in makeVesselCall() */
    eta:initial?0:(etaOverride??t+vesselConfig.arrivalDelay),actualArrival:initial?0:null,
    departure:null,state:initial?'WORKING':'SCHEDULED',x:L.shipX[berth],z:initial?L.shipZ:-345,
    discharge:[],load:[],created:t,shipContainers:[],workStarted:initial?0:null};
  vesselCalls.push(call);
  // Initial vessels use the already populated physical stowage. Replacements
  // carry their own actual shipboard containers while entering the channel.
  call.shipContainers=initial?initialShipCargo[berth]:populateShip(berth,call.z,false);
  for(const id of call.shipContainers)containers.get(id).callId=call.id;
  // Manifest contains physically accessible upper-tier import containers in
  // each crane's bay, leaving through cargo aboard for onward sailing.
  /* Evaluates callback for call.shipContainers.map using k */
  const  available=call.shipContainers.map( k=>containers.get(k)); /* Eligible items after filtering operational constraints in makeVesselCall() */
  const  count=Math.min(vesselConfig.dischargePerCall,available.length); /* Local value for count in makeVesselCall() */
  if(count<=SHIP_STACKS[berth].length){
   /* Evaluates callback for available.filter using c */
   /* Evaluates callback for available.some using o */
   const  upper=available.filter( c=>!available.some( o=>o!==c&&Math.abs(o.x-c.x)<.1&&Math.abs(o.z-c.z)<.1&&o.y>c.y+.1)); /* Local value for upper in makeVesselCall() */
   /* Evaluates callback for upper.sort using a, b */
   upper.sort( (a,b)=>a.x-b.x||a.z-b.z);
   for(let  n=0;n<count;n++)appendManifest(call,'DISCHARGE',upper[Math.floor((n+.5)*upper.length/count)]); /* Current counter, result, or node in this calculation in makeVesselCall() */
  }else{
   // Bigger cargo lists follow top-to-bottom dependencies for every stack.
   /* Evaluates callback for available.sort using a, b */
   available.sort( (a,b)=>b.y-a.y||a.x-b.x||a.z-b.z);
   for(const  c of available.slice(0,count))appendManifest(call,'DISCHARGE',c); /* Current container or item being processed in makeVesselCall() */
  }
  bookExports(call);planStowage(call);
  log('VESSEL_CALL_CREATED',{call:id,berth,state:call.state,discharge:call.discharge.length,load:call.load.length});
  if(initial)berths[berth]=call;
  return call;
 }
 for(let  b=0;b<3;b++)makeVesselCall(b,true); /* Second item being compared in makeEngine() */
 if(options.preloadFutureCalls!==false)for(let  b=0;b<3;b++)makeVesselCall(b,false,450+b*80); /* Second item being compared in makeEngine() */
 /* Associates a truck-delivered export container with a future vessel */
  function bookTruckExport(c){
  // A gate receipt may reserve a real container for a FUTURE, not yet working,
  // vessel call. This creates a load-list entry before the vessel berths.
  /* Evaluates callback for vesselCalls.filter using k */
  const  call=vesselCalls.filter( k=>k.state==='SCHEDULED'||k.state==='WAITING_BERTH') /* Vessel call being processed in bookTruckExport() */
    /* Evaluates callback for lls.filter(k=>k.state==='SCHEDULED'||k.state==='WAITING_BERTH') .filter using k */
    /* Evaluates callback for WAITING_BERTH') .filter(k=>k.load.length<vesselConfig.loadPerCall).sort using a, b */
    .filter( k=>k.load.length<vesselConfig.loadPerCall).sort( (a,b)=>a.eta-b.eta)[0];
  if(!call){c.awaitingVesselBooking=true;return null;}
  appendManifest(call,'LOAD',c);planStowage(call);c.awaitingVesselBooking=false;
  log('GATE_EXPORT_BOOKED',{call:call.id,container:c.id});return call.id;
 }
 /* Returns the working vessel currently occupying a berth */
  function activeCall(berth){const  call=berths[berth];return call?.state==='WORKING'?call:null} /* Vessel call being processed in activeCall() */
 /* Moves a vessel and its onboard containers during arrival or departure */
  function shiftVessel(call,dz){
  call.z+=dz;
  for(const  id of call.shipContainers){const  c=containers.get(id);if(c?.site==='ship'&&c.callId===call.id)c.z+=dz} /* Identifier of the selected entity in shiftVessel() */ /* Current container or item being processed in shiftVessel() */
 }
 // Always maintain a new, independently manifested call behind the active
 // vessel at each berth. This is planning only: a ship still cannot enter an
 // occupied berth and cannot depart before every listed physical move is DONE.
 /* Creates a future vessel call when a berth needs a replacement */
  function maintainVesselPipeline(){
  if(options.continuousVessels===false)return;
  for(let  berth=0;berth<berths.length;berth++){ /* Local value for berth in maintainVesselPipeline() */
   const  incumbent=berths[berth]; /* Local value for incumbent in maintainVesselPipeline() */
   // At most one future ship per berth; no duplicate booking of waiting calls.
   /* Evaluates callback for vesselCalls.some using c */
   if(vesselCalls.some( c=>c.berth===berth&&FUTURE_STATES.has(c.state)))continue;
   // Do not create another call at startup ahead of the initial vessels.
   if(incumbent?.state==='WORKING'||incumbent?.state==='UNBERTHING'||incumbent?.state==='DEPARTING'||!incumbent){
    const  replacement=makeVesselCall(berth,false,Math.max(t+vesselConfig.arrivalDelay,t+30)); /* Local value for replacement in maintainVesselPipeline() */
    log('NEXT_VESSEL_PLANNED',{berth,call:replacement.id,eta:replacement.eta,
      discharge:replacement.discharge.length,load:replacement.load.length});
   }
  }
 }
 /* Advances vessel arrival, mooring, work, departure, and completion states */
  function tickVessels(dt){
  maintainVesselPipeline();
  for(const  call of vesselCalls){ /* Vessel call being processed in tickVessels() */
   if(call.state==='SCHEDULED'&&t>=call.eta&&berths[call.berth]){call.state='WAITING_BERTH';log('VESSEL_BERTH_WAIT',{call:call.id,berth:call.berth})}
   if((call.state==='SCHEDULED'||call.state==='WAITING_BERTH')&&t>=call.eta&&!berths[call.berth]){
    call.state='APPROACHING';berths[call.berth]=call;
    log('VESSEL_APPROACH',{call:call.id,berth:call.berth});
   }
   if(call.state==='APPROACHING'){
    const  step=Math.min(vesselConfig.approachSpeed*dt,L.shipZ-call.z); /* Local value for step in tickVessels() */
    if(step>0)shiftVessel(call,step);
    if(call.z>=L.shipZ-.001){call.z=L.shipZ;call.state='MOORING';call.moorAt=t+12;
      log('VESSEL_MOORING',{call:call.id})}
   }else if(call.state==='MOORING'&&t>=call.moorAt){
    call.state='WORKING';call.actualArrival=t;call.workStarted=t;
    log('VESSEL_WORKING',{call:call.id});
   }else if(call.state==='WORKING'){
    /* Evaluates callback for [...call.discharge,...call.load].every using w */
    const  done=[...call.discharge,...call.load].every( w=>w.state==='DONE'); /* Local value for done in tickVessels() */
    /* Evaluates callback for sts.slice(call.berth*3,call.berth*3+3).every using q */
    const free=berthCranes[call.berth].every(q=>!q.job&&!stsSweeps.has(q.id));
    const  noActive=[...liveJobs].every(j=>j.order?.vesselCall!==call.id); /* Local value for no active in tickVessels() */
    if(done&&free&&noActive&&t-call.workStarted>=1){
     call.state='UNBERTHING';call.unmoorAt=t+12;
     log('VESSEL_WORK_COMPLETED',{call:call.id,discharged:call.discharge.length,loaded:call.load.length});
    }
   }else if(call.state==='UNBERTHING'&&t>=call.unmoorAt){call.state='DEPARTING';log('VESSEL_DEPARTING',{call:call.id})}
   else if(call.state==='DEPARTING'){
    const  step=Math.min(vesselConfig.departureSpeed*dt,Math.max(0,call.z+345)); /* Local value for step in tickVessels() */
    if(step>0)shiftVessel(call,-step);
    if(call.z<=-345+.001){
     call.state='DEPARTED';call.departure=t;completedVesselCalls++;
     for(const  id of call.shipContainers){const  c=containers.get(id); /* Identifier of the selected entity in tickVessels() */ /* Current container or item being processed in tickVessels() */
      if(c?.site==='ship'&&c.callId===call.id){c.site='SAILED';c.ship=null;trace(c,'VESSEL_DEPARTED',call.id)}}
     berths[call.berth]=null;
     log('VESSEL_DEPARTED',{call:call.id,berth:call.berth});
     // The independently planned next vessel is already waiting offshore.
     // If a future call was absent (e.g. after a reset or a manifest revision),
     // the pipeline replenisher will create it on the next simulation tick.
    }
   }
  }
 }
 /* Formats vessel summaries for the dashboard */
 /* Evaluates callback for vesselCalls.map using c */
  function vesselRows(){return vesselCalls.map( c=>({id:c.id,name:c.name,berth:c.berth+1,state:c.state,eta:c.eta,arrival:c.actualArrival,departure:c.departure,
   /* Evaluates callback for c.discharge.filter using w */
   phase:vesselWorkPhase(c),dischargeTotal:c.discharge.length,dischargeDone:c.discharge.filter( w=>w.state==='DONE').length,
   /* Evaluates callback for c.load.filter using w */
   loadTotal:c.load.length,loadDone:c.load.filter( w=>w.state==='DONE').length,z:c.z}));}
 /* Returns the complete discharge/load work list for a vessel */
 /* Evaluates callback for vesselCalls.find using c */
 /* Evaluates callback for [...call.discharge,...call.load].map using w */
  function vesselWorklist(callId){const  call=vesselCalls.find( c=>c.id===callId);return call?[...call.discharge,...call.load].map( w=>({...w,call:call.id})):[];} /* Vessel call being processed in vesselWorklist() */
 /* Finds accessible top containers for an RTG at a given yard */
  function topYard(bi,requireType,role){const  matches=[];for(const  slot of yardSlots){ /* Collection of matches */ /* Current storage or transfer slot in topYard() */
  if(slot.yard!==bi||role==='agv'&&slot.x>Math.min(L.agvStorageMaxX,rtgTruck[bi].x-YARD_RAIL_GAP-8)||
   role==='truck'&&slot.x<Math.max(L.truckStorageMinX,rtgAgv[bi].x+YARD_RAIL_GAP+8)||!slot.stack.length||currentSlotClaimed(slot))continue;
  const  c=containers.get(slot.stack.at(-1)); /* Current container or item being processed in topYard() */
  if(!c||c.site!=='yard'||c.order||requireType&&c.direction!==requireType)continue;
  matches.push(c);
 }return matches}
 /* Chooses an eligible physical storage slot for a container */
  function freeSlot(bi,role,choose=true){
  /* Evaluates callback for yardSlots.filter using s */
  const available=yardSlots.filter(s=>s.yard===bi&&(role==='agv'?s.x<=Math.min(L.agvStorageMaxX,rtgTruck[bi].x-YARD_RAIL_GAP-8):role==='truck'?s.x>=Math.max(L.truckStorageMinX,rtgAgv[bi].x+YARD_RAIL_GAP+8):true)&&s.stack.length<3&&
    (!s.stack.length||(!containers.get(s.stack.at(-1))?.order&&!containers.get(s.stack.at(-1))?.loadCall))&&
    !slotClaims.has(s));
  /* Evaluates callback for available.sort using a, b */
  if(!available.length)return null;available.sort( (a,b)=>role==='agv'?a.x-b.x:role==='truck'?b.x-a.x:0);return available[choose?Math.floor(rng()*Math.min(8,available.length)):0];
 }
 /* Finds physically accessible discharge containers assigned to an STS */
  function topShip(crane){
  const  call=activeCall(crane.ship);if(!call)return []; /* Vessel call being processed in topShip() */
  const  available=[]; /* Eligible items after filtering operational constraints in topShip() */
  for(const  work of call.discharge){ /* Local value for work in topShip() */
   if(work.state!=='PLANNED'||work.crane!==crane.id)continue;
   const  c=containers.get(work.container); /* Current container or item being processed in topShip() */
   if(!c||c.site!=='ship'||c.order||!shipBayByX[crane.ship].get(c.x)?.cranes.includes(crane))continue;
   /* Evaluates callback for call.shipContainers.some using id */
   if(call.shipContainers.some( id=>{const  o=containers.get(id);return o&&o!==c&&o.site==='ship'&& /* Local value for o in topShip() */
      Math.abs(o.x-c.x)<.1&&Math.abs(o.z-c.z)<.1&&o.y>c.y+.1}))continue;
   available.push(c);
  }
  return available;
 }
 /* Checks whether a manifest-directed loading slot is available on the ship */
  function shipPlace(crane,cargo=null){
  const  call=activeCall(crane.ship);if(!call||crane.downUntil>t)return null; /* Vessel call being processed in shipPlace() */
  /* Evaluates callback for call.load.filter using w */
  const  items=call.load.filter( w=>['PLANNED','RESERVED','IN_PROGRESS'].includes(w.state)&&w.crane===crane.id&&(!cargo||w.container===cargo.id)); /* Local value for items in shipPlace() */
  for(const  w of items){ /* Local value for w in shipPlace() */
   const  plan=w.plannedPosition;if(!plan)continue; /* Local value for plan in shipPlace() */
   let  top=5.7; /* Local value for top in shipPlace() */
   for(const  id of call.shipContainers){const  c=containers.get(id); /* Identifier of the selected entity in shipPlace() */ /* Current container or item being processed in shipPlace() */
    if(c?.site==='ship'&&Math.abs(c.x-plan.x)<.2&&Math.abs(c.z-plan.z)<.2)top=Math.max(top,c.y+2.8)}
   if(Math.abs(top-plan.y)<.1)return {...plan};
  }
  return null;
 }
 /* Creates and reserves a container-specific transport order */
  function createOrder(type,c,crane,yard,truck=null){const  o={id:'ORD-'+String(++orderSeq).padStart(5,'0'),type,container:c.id,source:c.site, /* Configuration or state record for o */
    dest:type==='IMPORT'||type==='TRUCK_DELIVERY'?'yard':type==='EXPORT'?'ship':'gate',status:'QUEUED',crane:crane?.id||null,yard,vehicle:null,job:null,created:t};o.vesselCall=type==='IMPORT'?c.dischargeCall:type==='EXPORT'?c.loadCall:null;orders.push(o);ordersById.set(o.id,o);liveOrders.add(o);c.order=o.id;return o}
 /* Checks whether an AGV occupies an STS handoff lane */
 /* Evaluates callback for STS_DOCK_LANES.some using z */
  function agvAtStsLane(v){return STS_DOCK_LANES.some( z=>Math.abs(v.z-z)<1.5)}
 /* Finds and reserves a safe available STS transfer lane */
  function freeStsLane(qc){
  qc._laneCycle=(qc._laneCycle||0)%STS_DOCK_LANES.length;
  for(let  k=0;k<STS_DOCK_LANES.length;k++){ /* Current loop key or index in freeStsLane() */
   const  lane=STS_DOCK_LANES[(qc._laneCycle+k)%STS_DOCK_LANES.length]; /* Index or coordinate of the selected lane in freeStsLane() */
   // A slot belongs to its approaching AGV as soon as admitted, not only
   // after the physical vehicle reaches the crane; likewise an active job
   // owns its destination lane throughout approach and lift.
   /* Evaluates callback for agvs.some using v */
   const  reserved=agvs.some( v=>v.stageBay?.side==='sts'&&v.stageBay.crane===qc.id&&v.stageBay.z===lane)|| /* Already claimed work or transfer resources in freeStsLane() */
     [...liveJobs].some(j=>!j.preposition&&j.sts?.id===qc.id&&j.stsDockZ===lane&&!(j.type==='IMPORT'&&j.pickupCraneReleased));
   /* Evaluates callback for agvs.some using v */
   const  occupied=agvs.some( v=>Math.abs(v.x-qc.homeX)<12&&Math.abs(v.z-lane)<8); /* Currently occupied or reserved positions in freeStsLane() */
   if(!reserved&&!occupied&&!stsStandHasThroughRoute(qc.homeX,lane)){
    qc._laneCycle=(qc._laneCycle+k+1)%STS_DOCK_LANES.length;return lane;
   }
  }
  return null;
 }
 /* Selects a non-conflicting yard-crane transfer position */
  function availableDockBay(side,bi,vehicle){
  const  bays=(side==='agv'?YARD_AGV_BAYS:YARD_TRUCK_BAYS)[bi]; /* Local value for bays in availableDockBay() */
  const  claimed=side==='agv'?agvs:trucks; /* Local value for claimed in availableDockBay() */
  /* Evaluates callback for bays.some using b */
  if(vehicle?.stageBay&&bays.some( b=>b.x===vehicle.stageBay.x&&b.z===vehicle.stageBay.z))return vehicle.stageBay;
  /* Evaluates callback for claimed.filter using v */
  /* Evaluates callback for claimed.filter(v=>v!==vehicle&&(v.queueBay||v.stageBay?.side===side)).map using v */
  const  assigned=claimed.filter( v=>v!==vehicle&&(v.queueBay||v.stageBay?.side===side)).map( v=>v.queueBay||v.stageBay); /* Items currently assigned to equipment in availableDockBay() */
  /* Evaluates callback for bays.find using b */
  /* Evaluates callback for claimed.some using v */
  return bays.find(b=>!assigned.some(other=>side==='truck'?Math.hypot(other.x-b.x,other.z-b.z)<13:other===b)&&
    !claimed.some(v=>v!==vehicle&&(side==='truck'?Math.hypot(v.x-b.x,v.z-b.z)<13:rectangularOverlap({x:b.x,z:b.z,heading:0},v))))||null;
 }
 /* Creates an executable transport mission and claims required equipment */
  function stageJob(kind,o,vehicle,srcCrane,destCrane,target,slot){const  sts=srcCrane?.type==='sts'?srcCrane:destCrane?.type==='sts'?destCrane:null; /* Nine ship-to-shore cranes, three allocated to each berth */
   const  rtg=srcCrane?.type==='rtg'?srcCrane:destCrane?.type==='rtg'?destCrane:null; /* Local value for rtg in stageJob() */
   if(rtg){
    const  requiredRole=vehicle.type==='agv'?'agv':'truck'; /* Local value for required role in stageJob() */
    if(rtg.role!==requiredRole)throw Error('Wrong RTG assigned to '+vehicle.id);
    if(!craneRailSafe(rtg,rtg.x))throw Error('RTG initial gantry separation unsafe');
    const  source=containers.get(o.container); /* Source location or graph node in stageJob() */
    if(source?.site==='yard'&&!craneHookReachable(rtg,source.x))throw Error('Container outside assigned RTG territory');
    if(slot&&!craneHookReachable(rtg,slot.x))throw Error('Destination outside RTG reachable rails');
   }
   const  dockBay=availableDockBay(vehicle.type==='agv'?'agv':'truck',o.yard,vehicle); /* Local value for dock bay in stageJob() */
   if(!dockBay)throw Error('No free yard-side transfer position for '+vehicle.id);
   const  placeholder=vehicle.pipelineJob?jobsById.get(vehicle.pipelineJob):null; /* Local value for placeholder in stageJob() */
   const  j=placeholder||{id:'JOB-'+String(++jobSeq).padStart(5,'0')}; /* Loop index for the current nested collection in stageJob() */
   Object.assign(j,{type:kind,order:o,container:containers.get(o.container),
     vehicle,sts,rtg,stsDockZ:sts?(vehicle.stageBay?.side==='sts'&&vehicle.stageBay.crane===sts.id?vehicle.stageBay.z:freeStsLane(sts)):null,
     yardDockZ:dockBay.z,truckDockZ:dockBay.z,transferBay:dockBay,
     destination:target,stage:'TO_PICKUP',timer:0,phase:'',phaseTime:0,started:t,completed:false,preposition:false});
  if(placeholder)setJobSlot(j,slot);
  else {j.slot=slot;registerJob(j);}
  vehicle.pipelineJob=null;vehicle.job=j.id;vehicle.state='ASSIGNED';o.status='RUNNING';o.vehicle=vehicle.id;o.job=j.id;
  // Transport reservations do not occupy a crane. Execution is acquired at
  // the actual aligned handover; the destination slot remains exclusive.
  log('JOB_ASSIGNED',{job:j.id,order:o.id,vehicle:vehicle.id,container:j.container.id,stsLane:j.stsDockZ});
  vehicle.queueBay=dockBay;
  if(kind==='IMPORT'&&Math.abs(vehicle.x-j.sts.homeX)<.12&&Math.abs(vehicle.z-j.stsDockZ)<.12){
    vehicle.route=[];vehicle.routeIndex=0;vehicle.state='DOCKED';vehicle.heading=Math.PI;
  }else if(kind==='EXPORT'&&Math.abs(vehicle.x-L.agvDockX)<.12&&Math.abs(vehicle.z-j.yardDockZ)<.12){
    vehicle.route=[];vehicle.routeIndex=0;vehicle.state='DOCKED';vehicle.heading=0;
  }else if(kind==='IMPORT')setRoute(vehicle,'sts',{...j.sts,dockZ:j.stsDockZ});
  else if(kind==='EXPORT')setRoute(vehicle,'yard',{...j.rtg,dockZ:j.yardDockZ});
  if(kind==='TRUCK_DELIVERY'||kind==='TRUCK_PICKUP')setRoute(vehicle,'truck-yard',{...j.rtg,dockZ:j.truckDockZ});
  return j;
 }
 // CROSS-LANE AGV GUIDE-PATH NETWORK — adapted from the supplied 24-column
 // quay / parking / block-lane / transfer-stand topology.
 // All routes are graph paths, not predefined vehicle loops.
 // Queuing occurs only in actual STS or yard crane transfer positions.
 // The six temporary yard holding pockets and quay waiting pockets are removed.
 /* Evaluates callback for sts.flatMap using q */
 /* Evaluates callback for STS_DOCK_LANES.map using z, lane */
 const  CRANE_QUEUE_BAYS=[...sts.flatMap( q=>STS_DOCK_LANES.map( (z,lane)=>({x:q.homeX,z,lane,crane:q.id,side:'sts'}))), /* Collection of crane queue bays */
   ...YARD_AGV_BAYS.flat()];
 const QUAY_ROWS=[...STS_DOCK_LANES,...QUAY_TRAVEL_ROWS];
 const AGV_GRID={
  nodes:new Map(),edges:new Map(),sections:new Map(),
  quayRows:QUAY_ROWS.slice(),quayTravelRows:QUAY_TRAVEL_ROWS.slice(), columns:QUAY_COLUMNS.slice(),
  yardRows:L.yards.map(y=>y.z),yardIncomingColumns:YARD_INCOMING_X.slice(),
  yardOutgoingColumns:YARD_OUTGOING_X.slice(),yardPitch:TRAVEL_PITCH,
  quayTravelPitch:TRAVEL_PITCH,yardMouthZ:YARD_MOUTH_Z
 };
 function gKey(x,z){return `${Math.round(x*1000)/1000},${Math.round(z*1000)/1000}`}
 const sectionKey=(a,b)=>[gKey(a.x,a.z),gKey(b.x,b.z)].sort().join('|');
 function graphNode(x,z,zone){
  const id=gKey(x,z);
  if(!AGV_GRID.nodes.has(id)){AGV_GRID.nodes.set(id,{x,z,zone,id});AGV_GRID.edges.set(id,[]);}
  return AGV_GRID.nodes.get(id);
 }
 function graphLink(x1,z1,x2,z2,oneWay,zone,{area=null,travel=false,reverse=false,multiplier=1,berth=null}={}){
  const a=graphNode(x1,z1,zone),b=graphNode(x2,z2,zone),length=dist(a,b);
  if(!length||(a.x!==b.x&&a.z!==b.z))throw Error('Invalid AGV connection '+a.id+' to '+b.id);
  if(travel&&length<TRAVEL_PITCH)throw Error('Travel connection cannot hold an AGV '+a.id+' to '+b.id);
  const section={id:sectionKey(a,b),length,zone,area,travel,berth};
  if(AGV_GRID.sections.has(section.id))throw Error('Duplicate AGV connection '+section.id);
  AGV_GRID.sections.set(section.id,section);
  AGV_GRID.edges.get(a.id).push({to:b.id,cost:length*multiplier,zone,section});
  if(!oneWay)AGV_GRID.edges.get(b.id).push({to:a.id,cost:length*multiplier,zone,section,reverse});
 }
 for(const [row,z] of QUAY_TRAVEL_ROWS.entries()){
  const westbound=row%2===0;
  for(let i=1;i<QUAY_COLUMNS.length;i++){
   const west=QUAY_COLUMNS[i-1],east=QUAY_COLUMNS[i];
   graphLink(westbound?east:west,z,westbound?west:east,z,true,
    westbound?'QUAY_WESTBOUND':'QUAY_EASTBOUND',{travel:true});
  }
 }
 for(const x of QUAY_COLUMNS){
  // The approach columns carry northbound flow into the STS service areas.
  // The other columns carry southbound flow, including the parking feeder.
  const northbound=STS_ACCESS.some(access=>access.east===x);
  for(let i=1;i<QUAY_TRAVEL_ROWS.length;i++){
   const north=QUAY_TRAVEL_ROWS[i-1],south=QUAY_TRAVEL_ROWS[i];
   graphLink(x,northbound?south:north,x,northbound?north:south,true,'QUAY_INTERSECTION',{travel:true});
  }
 }
 for(const {west,east,x,id,berth} of STS_ACCESS){
  const area={area:id,berth};
  const rows=[...STS_DOCK_LANES,QUAY_WESTBOUND_Z];
  for(let i=1;i<rows.length;i++){
   graphLink(east,rows[i],east,rows[i-1],true,'QUAY_SERVICE',area);
   graphLink(west,rows[i-1],west,rows[i],true,'QUAY_SERVICE',area);
  }
  for(const z of STS_DOCK_LANES){
   graphLink(east,z,x,z,true,'QUAY_SERVICE',area);
   graphLink(x,z,west,z,true,'QUAY_SERVICE',area);
  }
 }
 for(let i=1;i<STS_ACCESS.length;i++){
  const west=STS_ACCESS[i-1],east=STS_ACCESS[i];
  if(west.berth!==east.berth)continue;
  for(const z of STS_DOCK_LANES){
   graphLink(east.west,z,west.east,z,true,'QUAY_TRANSFER_LINK',
    {travel:true,berth:east.berth,multiplier:.95});
  }
 }
 const parkingGateway={area:'PARKING-GATEWAY'};
 const gatewayRows=[-36,-24,-12,QUAY_WESTBOUND_Z];
 for(let i=1;i<gatewayRows.length;i++){
  graphLink(PARKING_CONNECTOR_X,gatewayRows[i-1],PARKING_CONNECTOR_X,gatewayRows[i],false,'QUAY_ACCESS_CONNECTOR',parkingGateway);
 }
 // The parking road network is an independent two-row block. Both rows
 // use identical offsets from the stall centre: an exit spine 18m west and
 // a return spine 18m east. No parking spine intrudes into the quay or yard.
 // Exactly four short parking-to-quay links terminate at existing quay nodes.
 /* Evaluates callback for Array.from using _, i */
 const  PARKING_STALL_Z=Array.from({length:12}, (_,i)=>7+i*12); /* Z coordinates of the 12 parking spaces in each row */
 const  PARKING_ROWS=[ /* Matching exit and return spine definitions for both AGV parking rows */
  {stallX:-444,exitX:-462,returnX:-426,exitZ:-24,returnZ:-12},
  {stallX:-396,exitX:-414,returnX:-378,exitZ:-36,returnZ:0}
 ];
 const  addParkingSpine=(x,firstZ,zone)=>{ /* Computes add parking spine for the current simulation operation */
  const  points=[firstZ,...PARKING_STALL_Z]; /* Collection of points */
  for(let  i=1;i<points.length;i++)graphLink(x,points[i-1],x,points[i],false,zone,{multiplier:1.15}); /* Loop index for the current collection in addParkingSpine() */
 };
 for(const  row of PARKING_ROWS){ /* Current grid row or formatted table record in makeEngine() */
  addParkingSpine(row.exitX,row.exitZ,'PARKING_EXIT');
  addParkingSpine(row.returnX,row.returnZ,'PARKING_RETURN');
  for(const  z of PARKING_STALL_Z){ /* Longitudinal world coordinate in makeEngine() */
   graphLink(row.stallX,z,row.exitX,z,false,'PARKING_STALL_EXIT');
   graphLink(row.stallX,z,row.returnX,z,false,'PARKING_STALL_RETURN');
  }
  // One exit and one return per row. These are the ONLY four connectors.
  graphLink(row.exitX,row.exitZ,PARKING_CONNECTOR_X,row.exitZ,false,'PARKING_QUAY_CONNECTOR',{multiplier:1.15});
  graphLink(row.returnX,row.returnZ,PARKING_CONNECTOR_X,row.returnZ,false,'PARKING_QUAY_CONNECTOR',{multiplier:1.15});
 }
 // Verify shared connection locations and the separation from yard lanes.
 for(const  row of PARKING_ROWS){ /* Current grid row or formatted table record in makeEngine() */
  if(row.exitX!==row.stallX-18||row.returnX!==row.stallX+18)
   throw Error('Parking row symmetry violated');
  if(row.returnX>=Math.min(...BLOCK_GRID_X)-30)
   throw Error('Parking spine enters the yard-grid approach');
 }
 const yardAreas=L.yards.map(y=>({id:'YARD-SERVICE-'+y.id,entry:y.z-18,exit:y.z+18}));
 const yardCrossRows=yardAreas.flatMap(({entry,exit})=>[entry,exit]);
 const yardRows=[YARD_MOUTH_Z,...yardCrossRows];
 for(const x of BLOCK_GRID_X){
  const incoming=YARD_INCOMING_X.includes(x);
  for(let i=1;i<yardRows.length;i++){
   const low=yardRows[i-1],high=yardRows[i];
   graphLink(x,incoming?low:high,x,incoming?high:low,true,incoming?'YARD_INCOMING':'YARD_OUTGOING',{travel:true});
  }
 }
 for(let i=0;i<yardAreas.length;i++){
  const {id,entry,exit}=yardAreas[i], bays=YARD_AGV_BAYS[i], area={area:id};
  for(let j=1;j<BLOCK_GRID_X.length;j++){
   graphLink(BLOCK_GRID_X[j-1],entry,BLOCK_GRID_X[j],entry,true,'BLOCK_INTERSECTION',{travel:true});
   graphLink(BLOCK_GRID_X[j],exit,BLOCK_GRID_X[j-1],exit,true,'BLOCK_INTERSECTION',{travel:true});
  }
  graphLink(BLOCK_GRID_X.at(-1),entry,YARD_SERVICE_X,entry,true,'BLOCK_INTERSECTION',area);
  graphLink(YARD_SERVICE_X,exit,BLOCK_GRID_X.at(-1),exit,true,'BLOCK_INTERSECTION',area);
  const levels=[entry,...bays.map(bay=>bay.z),exit];
  for(let j=1;j<levels.length;j++){
   graphLink(YARD_SERVICE_X,levels[j-1],YARD_SERVICE_X,levels[j],true,'YARD_SERVICE',area);
  }
  for(const bay of bays)graphLink(YARD_SERVICE_X,bay.z,bay.x,bay.z,false,'AGV_TRANSFER',{...area,reverse:true});
 }
 const QUAY_ROW_PITCH=TRAVEL_PITCH;
 function committedStsStands(vehicle){
  const claimed=new Set();
  for(const v of agvs)if(v!==vehicle&&v.stageBay?.side==='sts')claimed.add(gKey(v.stageBay.x,v.stageBay.z));
  for(const j of liveJobs){
   if(j.vehicle!==vehicle&&j.sts&&!(j.type==='IMPORT'&&j.pickupCraneReleased))
    claimed.add(gKey(j.sts.homeX,j.stsDockZ));
  }
  return claimed;
 }
 function stsStandHasThroughRoute(x,z,vehicle){
  return agvs.some(v=>v!==vehicle&&v.route.some((p,i)=>
   i>=v.routeIndex&&i<v.route.length-1&&p.x===x&&p.z===z));
 }
 /* Plans a shortest feasible AGV route through the logical guide-path graph */
  function shortestGrid(from,to,vehicle=null,edgeAllowed=()=>true){
  const  source=gKey(from.x,from.z), goal=gKey(to.x,to.z); /* Source location or graph node in shortestGrid() */ /* Local value for goal in shortestGrid() */
  if(!AGV_GRID.nodes.has(source)||!AGV_GRID.nodes.has(goal))return null;
  const  distMap=new Map([[source,0]]), prev=new Map(), open=[source], closed=new Set(); /* Lookup table holding dist map */ /* Previous state, item, or location in shortestGrid() */ /* Collection of open */ /* Unique values for closed */
  while(open.length){
   let  best=0;for(let  k=1;k<open.length;k++)if((distMap.get(open[k])||Infinity)<(distMap.get(open[best])||Infinity))best=k; /* Local value for best in shortestGrid() */ /* Current loop key or index in shortestGrid() */
   const  id=open.splice(best,1)[0];if(id===goal)break;if(closed.has(id))continue;closed.add(id); /* Identifier of the selected entity in shortestGrid() */
   for(const  e of AGV_GRID.edges.get(id)||[]){ /* Local value for e in shortestGrid() */
    // Parking is an ingress/egress resource, never a congestion bypass for
    // a journey whose source and destination are both in the terminal.
    if(from.x>=PARKING_CONNECTOR_X&&to.x>=PARKING_CONNECTOR_X&&e.zone.startsWith('PARKING'))continue;
    if(!edgeAllowed(e))continue;
    const  n=AGV_GRID.nodes.get(e.to); /* Current counter, result, or node in this calculation in shortestGrid() */
    /* Evaluates callback for agvs.some using v */
    const  parkingBlock=agvs.some( v=>!v.route.length&&v.x>-312&& /* Local value for parking block in shortestGrid() */
      Math.hypot(v.x-n.x,v.z-n.z)<9 &&
      !(Math.abs(v.x-to.x)<.5&&Math.abs(v.z-to.z)<.5));
    // An occupied crane slot is not a through-road shortcut.
    /* Evaluates callback for agvs.reduce using count, v */
    const  sameTraffic=agvs.reduce( (count,v)=>count+(v!==vehicle&&v.route.length&&Math.hypot(v.x-n.x,v.z-n.z)<17?1:0),0); /* Local value for same traffic in shortestGrid() */
    // Predict opposing traffic along this exact bidirectional lane. A stopped
    // vehicle at the next junction forces the other AGV to use a parallel row.
    const  a=AGV_GRID.nodes.get(id), dx=n.x-a.x, dz=n.z-a.z; /* First item being compared in shortestGrid() */ /* Local value for dx in shortestGrid() */ /* Local value for dz in shortestGrid() */
    /* Evaluates callback for agvs.some using o */
    const  headOn=vehicle&&agvs.some( o=>o!==vehicle&&o.route.length&& /* Local value for head on in shortestGrid() */
      ((Math.abs(dz)<.01&&Math.abs(dx)>.01&&Math.abs(o.z-a.z)<1.5&&Math.abs(o.x-a.x)<78&&
       Math.sign(o.x-a.x)===Math.sign(dx)&&
       ( ()=>{const  next=o.route[o.routeIndex];return next&&Math.abs(next.z-o.z)<1.5&&Math.sign(next.x-o.x)===-Math.sign(dx)})())|| /* Evaluates inline calculation callback */ /* Next candidate or planned state in shortestGrid() */
       (Math.abs(dx)<.01&&Math.abs(dz)>.01&&Math.abs(o.x-a.x)<1.5&&Math.abs(o.z-a.z)<78&&
       Math.sign(o.z-a.z)===Math.sign(dz)&&
       ( ()=>{const  next=o.route[o.routeIndex];return next&&Math.abs(next.x-o.x)<1.5&&Math.sign(next.z-o.z)===-Math.sign(dz)})()))); /* Evaluates inline calculation callback */ /* Next candidate or planned state in shortestGrid() */
    const  avoided=vehicle?.avoidNode&&t<vehicle.avoidNode.until&&gKey(n.x,n.z)===vehicle.avoidNode.key; /* Local value for avoided in shortestGrid() */
    const  fromSource=id===source; /* Local value for from source in shortestGrid() */
    const  turnBack=fromSource&&vehicle&&Math.hypot(dx,dz)>.001&& /* Local value for turn back in shortestGrid() */
      Math.cos(Math.atan2(dz,dx)-vehicle.heading)<-.5;
    // A route that requires an immediately blocked body orientation is not
    // a usable escape. Include the same footprint as the execution guard.
    const startHeading=Math.atan2(dz,dx);
    const blockedStart=fromSource&&vehicle&&Math.hypot(vehicle.x-a.x,vehicle.z-a.z)<.2&&
      agvs.some(o=>o!==vehicle&&rectangularOverlap({x:vehicle.x+Math.cos(startHeading)*.5,z:vehicle.z+Math.sin(startHeading)*.5,heading:startHeading},o));
    const  tentative=distMap.get(id)+(blockedStart?1000000:0)+e.cost+(parkingBlock?1500:0)+sameTraffic*100+(headOn?4000:0)+(avoided?10000:0)+(turnBack?180:0); /* Local value for tentative in shortestGrid() */
    if(tentative<(distMap.get(e.to)??Infinity)){distMap.set(e.to,tentative);prev.set(e.to,id);if(!closed.has(e.to))open.push(e.to)}
   }
  }
  if(!distMap.has(goal))return null;
  const  nodes=[];let  current=goal;while(current!==source){nodes.push(AGV_GRID.nodes.get(current));current=prev.get(current);if(!current)return null} /* Collection of nodes */ /* Current item or accumulated state in shortestGrid() */
  /* Evaluates callback for nodes.reverse().map using n */
  nodes.push(AGV_GRID.nodes.get(source));return nodes.reverse().map( n=>point(n.x,n.z));
 }
 let  gridRoutes=0, gridRouteFailures=0; /* Local value for grid routes in makeEngine() */ /* Local value for grid route failures in makeEngine() */
 function selectGridTravelLane(v,towardYard){
  const eligible=towardYard?YARD_INCOMING_X:YARD_OUTGOING_X;
  const preferred=Number(v.id.slice(-2))%eligible.length;
  return eligible.map((x,i)=>{
   let cost=((i-preferred+eligible.length)%eligible.length)*.2;
   for(const other of agvs){
    if(other===v||Math.abs(other.x-x)>6||other.z<YARD_MOUTH_Z)continue;
    cost+=other.blockedTime>5?400:20;
   }
   return {x,cost};
  }).sort((a,b)=>a.cost-b.cost)[0].x;
 }
 function gridEdge(a,b){
  return AGV_GRID.edges.get(gKey(a.x,a.z))?.find(edge=>edge.to===gKey(b.x,b.z));
 }
 function routeAGV(v,type,crane){
  const p=[point(v.x,v.z)];
  const westRow=v.home.x<-420;
  const exitX=westRow?-462:-414, exitZ=westRow?-24:-36;
  const returnX=westRow?-426:-378, returnZ=westRow?-12:0;
  const atHome=dist(v,v.home)<.1;
  const onExit=Math.abs(v.x-exitX)<.1&&v.z>=exitZ||
   Math.abs(v.z-exitZ)<.1&&v.x>=exitX&&v.x<PARKING_CONNECTOR_X;
  const append=(...points)=>{
   for(const next of points){
    const previous=p.at(-1);
    if(dist(previous,next)<.01)continue;
    const edge=gridEdge(previous,next);
    p.push(edge?.reverse?{...next,reverse:true}:next);
   }
  };
  const via=(target,allowed)=>{
   const start=p.at(-1),path=shortestGrid(start,target,v,allowed);
   if(!path){
    gridRouteFailures++;
    throw Error('No grid path '+gKey(start.x,start.z)+' to '+gKey(target.x,target.z));
   }
   append(...path);
  };
  const travel=edge=>edge.section.travel;
  const quay=edge=>travel(edge)&&edge.zone.startsWith('QUAY_')&&edge.section.berth===null;
  const onlyArea=id=>edge=>edge.section.area===id;
  if(type==='parking'&&v.x<PARKING_CONNECTOR_X){
   if(Math.abs(v.z-returnZ)<.1&&v.x>=returnX||Math.abs(v.x-returnX)<.1){
    append(point(returnX,v.z),point(returnX,v.home.z),v.home);
    return p;
   }
  }
  if(atHome&&type==='parking')return p;
  if(atHome){
   append(point(exitX,v.z),point(exitX,exitZ),point(PARKING_CONNECTOR_X,exitZ));
  }else if(onExit&&type!=='parking'){
   append(point(exitX===v.x?exitX:v.x,exitZ),point(PARKING_CONNECTOR_X,exitZ));
  }else if(!AGV_GRID.nodes.has(gKey(v.x,v.z))){
   throw Error('AGV route must start on the guide graph '+v.id+' '+gKey(v.x,v.z));
  }
  const staging=type==='staging'?v.stageBay:null;
  const stsTarget=type==='sts'||staging?.side==='sts';
  const yardTarget=type==='yard'||staging?.side==='agv';
  const start=p.at(-1),startEdges=AGV_GRID.edges.get(gKey(start.x,start.z));
  const originBerth=start.z<0?startEdges.find(edge=>edge.section.berth!==null)?.section.berth:null;
  const targetX=staging?.x??crane?.homeX??crane?.x;
  const targetZ=stsTarget?(staging?.z??crane.dockZ??L.stsDockZ):null;
  const targetBerth=stsTarget?STS_ACCESS.find(area=>area.x===targetX).berth:null;
  const standClaims=originBerth!=null||targetBerth!=null?committedStsStands(v):new Set();
  if(stsTarget)standClaims.delete(gKey(targetX,targetZ));
  const through=edge=>quay(edge)||edge.section.area===parkingGateway.area||
   edge.section.berth!==null&&(edge.section.berth===originBerth||edge.section.berth===targetBerth)&&
   !standClaims.has(edge.to);
  const originYard=yardAreas.find(area=>startEdges.some(edge=>edge.section.area===area.id)&&start.x>BLOCK_GRID_X.at(-1));
  if(originYard){
   const lane=selectGridTravelLane(v,false);
   via(point(BLOCK_GRID_X.at(-1),originYard.exit),onlyArea(originYard.id));
   via(point(lane,originYard.exit),travel);
   via(point(lane,YARD_MOUTH_Z),edge=>edge.zone==='YARD_OUTGOING');
  }else if(start.z>YARD_MOUTH_Z){
   // Resume a mission at a yard cross row without going against a trunk lane.
   if(!yardTarget||YARD_OUTGOING_X.includes(start.x)){
    const lane=selectGridTravelLane(v,false);
    via(point(lane,YARD_MOUTH_Z),travel);
   }
  }
  if(stsTarget){
   via(point(targetX,targetZ),through);
  }else if(yardTarget){
   const z=staging?.z??crane.dockZ??crane.homeZ??crane.z;
   const block=YARD_AGV_BAYS.findIndex(bays=>bays.some(bay=>bay.z===z));
   const area=yardAreas[block];
   const current=p.at(-1);
   const underway=current.z>YARD_MOUTH_Z&&YARD_INCOMING_X.includes(current.x)&&current.z<=area.entry;
   const lane=underway?current.x:selectGridTravelLane(v,true);
   if(!underway)via(point(lane,YARD_MOUTH_Z),through);
   via(point(lane,area.entry),edge=>edge.zone==='YARD_INCOMING');
   via(point(BLOCK_GRID_X.at(-1),area.entry),edge=>edge.zone==='BLOCK_INTERSECTION'&&edge.section.travel);
   via(point(L.agvDockX,z),onlyArea(area.id));
  }else if(type==='parking'){
   via(point(PARKING_CONNECTOR_X,returnZ),through);
   append(point(returnX,returnZ),point(returnX,v.home.z),v.home);
  }
  gridRoutes++;
  return p;
 }
 // Truck transport geometry is a separate logical network. Its segments
 // represent every possible physical line used by routeTruck: the inbound
 // and outbound trunks, all four yard crane pickup rows per block, and the
 // two parking rows' gate connections. No decorative road mesh is required.
 const  TRUCK_GRID={nodes:new Map(),edges:[],zone:'TRUCK_ROAD'}; /* Configuration or state record for truck grid */
 const  truckNode=(x,z)=>{const  k=gKey(x,z);if(!TRUCK_GRID.nodes.has(k))TRUCK_GRID.nodes.set(k,point(x,z));return k}; /* Computes truck node for the current simulation operation */ /* Current loop key or index in truckNode() */
 const  truckLink=(x1,z1,x2,z2,zone)=>{ /* Computes truck link for the current simulation operation */
  if(Math.abs(x1-x2)>1e-8&&Math.abs(z1-z2)>1e-8)throw Error('Non-orthogonal truck road');
  if(Math.hypot(x1-x2,z1-z2)<1e-8)return;
  truckNode(x1,z1);truckNode(x2,z2);
  TRUCK_GRID.edges.push({a:point(x1,z1),b:point(x2,z2),zone});
 };
 /* Evaluates callback for YARD_TRUCK_BAYS.flat().map using b */
 const  truckDockRows=YARD_TRUCK_BAYS.flat().map( b=>b.z); /* Local value for truck dock rows in makeEngine() */
 /* Evaluates callback for trucks.map using v */
 const  truckParkingRows=trucks.map( v=>v.home.z); /* Local value for truck parking rows in makeEngine() */
 /* Evaluates callback for [...new Set([...truckDockRows,...truckParkingRows])].sort using a, b */
 const  truckRowLevels=[...new Set([...truckDockRows,...truckParkingRows])].sort( (a,b)=>a-b); /* Local value for truck row levels in makeEngine() */
 // Both trunk lanes have real junctions wherever another road enters.
 for(const  x of [L.truckInX,L.truckOutX]) /* Horizontal world coordinate in makeEngine() */
  for(let  i=1;i<truckRowLevels.length;i++)truckLink(x,truckRowLevels[i-1],x,truckRowLevels[i],'TRUCK_TRUNK'); /* Loop index for the current collection in makeEngine() */
 for(const  z of truckDockRows){ /* Longitudinal world coordinate in makeEngine() */
  truckLink(L.truckDockX,z,L.truckInX,z,'TRUCK_YARD_TRANSFER');
  truckLink(L.truckInX,z,L.truckOutX,z,'TRUCK_YARD_TRANSFER');
 }
 for(const  v of trucks){ /* Current vehicle or value being processed in makeEngine() */
  truckLink(L.truckInX,v.home.z,L.truckOutX,v.home.z,'TRUCK_GATE');
  truckLink(L.truckOutX,v.home.z,v.home.x,v.home.z,'TRUCK_GATE');
 }
 // Check that every routeTruck leg is represented by a continuous section
 // of the exact truck network, including its parking and transfer endpoints.
 /* Handles truck leg covered in the terminal simulation */
  function truckLegCovered(a,b){
  const  sameX=Math.abs(a.x-b.x)<.01, sameZ=Math.abs(a.z-b.z)<.01; /* World-coordinate value for same x */ /* World-coordinate value for same z */
  if(!sameX&&!sameZ)return false;
  const  first=sameX?a.z:a.x, last=sameX?b.z:b.x; /* Local value for first in truckLegCovered() */ /* Local value for last in truckLegCovered() */
  /* Evaluates callback for TRUCK_GRID.edges.filter using e */
  let  intervals=TRUCK_GRID.edges.filter( e=>sameX? /* Local value for intervals in truckLegCovered() */
   Math.abs(e.a.x-a.x)<.01&&Math.abs(e.b.x-b.x)<.01:
   Math.abs(e.a.z-a.z)<.01&&Math.abs(e.b.z-b.z)<.01)
   /* Evaluates callback for .b.x-b.x)<.01: Math.abs(e.a.z-a.z)<.01&&Math.abs(e.b.z-b.z)<.01) .map using e */
   .map( e=>sameX?[Math.min(e.a.z,e.b.z),Math.max(e.a.z,e.b.z)]:
                    [Math.min(e.a.x,e.b.x),Math.max(e.a.x,e.b.x)])
   /* Evaluates callback for [Math.min(e.a.x,e.b.x),Math.max(e.a.x,e.b.x)]) .sort using a, b */
   .sort( (a,b)=>a[0]-b[0]);
  let  covered=Math.min(first,last), goal=Math.max(first,last); /* Local value for covered in truckLegCovered() */ /* Local value for goal in truckLegCovered() */
  for(const  [lo,hi] of intervals){if(lo>covered+.01)break;if(hi>covered)covered=hi;if(covered>=goal-.01)return true} /* Local value for [lo,hi] in truckLegCovered() */
  return goal-covered<.01;
 }
 /* Handles route truck in the terminal simulation */
  function routeTruck(v,type,crane){const  p=[point(v.x,v.z)], z=crane?.z; /* Current position, route, or temporary calculation value in routeTruck() */ /* Longitudinal world coordinate in routeTruck() */
   if(type==='truck-yard'){const  dz=crane?.dockZ??z;p.push(point(L.truckInX,v.z),point(L.truckInX,dz),point(L.truckDockX,dz))} /* Local value for dz in routeTruck() */
   if(type==='gate'){p.push(point(L.truckOutX,v.z),point(L.truckOutX,v.home.z),point(v.home.x,v.home.z))}
   const  path=simplify(p); /* Path returned by the routing algorithm in routeTruck() */
   for(let  i=1;i<path.length;i++)if(!truckLegCovered(path[i-1],path[i])) /* Loop index for the current collection in routeTruck() */
    throw Error('Truck route missing visual/logical segment: '+v.id+' '+type+' '+gKey(path[i-1].x,path[i-1].z)+' > '+gKey(path[i].x,path[i].z));
   return path;
 }
 /* Handles simplify in the terminal simulation */
 /* Evaluates callback for p.filter using a, i */
  function simplify(p){return p.filter( (a,i)=>!i||dist(a,p[i-1])>.01)}
 /* Assigns a verified physical route to a vehicle */
  function setRoute(v,type,crane){
  v.routeIntent={type,crane}; // Store exact destinations for both AGVs and trucks; recovery always resumes the original crane handoff.
  v.route=v.type==='agv'?routeAGV(v,type,crane):routeTruck(v,type,crane);
  v.routeVersion=(v.routeVersion||0)+1;v.routeIndex=1;
  v.state=type==='staging'?'PREPOSITIONING':type==='parking'||type==='gate'?'RETURNING':'TRAVEL';v.blockedTime=0;
  if(v.route.length<2){v.route=[];v.routeIndex=0;v.state=type==='staging'?'STAGED':'DOCKED';}

  /* Evaluates callback for v.route.some using p */
  if(v.type==='truck'&&!truckOwner)truckOwner=v.id;
 }

 // A real, two-crane relay via a physical central buffer stack (no teleporting).
 // Both RTGs can traverse the whole yard if their partner yields onto an end siding.
 // In normal terminal operations the relay buffer prevents unnecessary long travel.
 /* Handles make relay in the terminal simulation */
  function makeRelay(bi){
  const  left=rtgAgv[bi], right=rtgTruck[bi], inbound=L.yards[bi].type==='inbound'; /* Local value for left in makeRelay() */ /* Local value for right in makeRelay() */ /* Local value for inbound in makeRelay() */
  /* Evaluates callback for topYard(bi,'outbound','truck').some using c */
  /* Evaluates callback for vesselCalls.some using k */
  const  outstandingExports=!inbound&&topYard(bi,'outbound','truck').some( c=>c.loadCall&&vesselCalls.some( k=>k.id===c.loadCall&&['WORKING','MOORING','APPROACHING','WAITING_BERTH'].includes(k.state))); /* Local value for outstanding exports in makeRelay() */
  if(left.job||right.job||t-lastRelayAt[bi]<(outstandingExports?45:240))return false;
  if([...liveJobs].some(j=>!j.preposition&&j.type==='EXPORT'&&j.rtg===left&&j.vehicle.state==='DOCKED'))return false;
  // Do not start a long background relay across a committed import delivery
  // window. This is task selection, not ownership by an approaching AGV.
  if(inbound&&[...liveJobs].some(j=>!j.preposition&&j.type==='IMPORT'&&j.order.yard===bi))return false;
  // Import: AGV-end storage -> truck-end storage. Export: reverse direction.
  const  sourceRole=inbound?'agv':'truck', destRole=inbound?'truck':'agv'; /* Local value for source role in makeRelay() */ /* Local value for dest role in makeRelay() */
  const  sourceCrane=inbound?left:right, destCrane=inbound?right:left; /* Local value for source crane in makeRelay() */ /* Local value for dest crane in makeRelay() */
  const  candidates=topYard(bi,L.yards[bi].type,sourceRole); /* Flag indicating whether candidates */
  // Vessel-booked export containers have priority over incidental reshuffles;
  // otherwise a ship can finish discharge but wait indefinitely for its loadlist.
  /* Evaluates callback for candidates.sort using a, b */
  candidates.sort( (a,b)=>{
   /* Evaluates callback for vesselCalls.find using v */
   const  score=c=>c.loadCall?(vesselCalls.find( v=>v.id===c.loadCall)?.state==='WORKING'?0:1):2; /* Computes score for the current simulation operation */
   return score(a)-score(b);
  });
  const  source=candidates[0]; /* Source location or graph node in makeRelay() */
  if(!source)return false;
  const  dest=freeSlot(bi,destRole); /* Destination location or graph node in makeRelay() */
  if(!dest)return false;
  // Dynamic handover: select a standard central yard slot with free stacking
  // capacity. The cranes travel to that slot sequentially; neither passes the other.
  // A non-empty handover stack is legal only when its top is not reserved.
  const  mid=(left.x+right.x)*.5; /* Local value for mid in makeRelay() */
  /* Evaluates callback for yardSlots.filter using sl */
  const  buffer=yardSlots.filter( sl=>sl.yard===bi&&sl.zone==='shared'&&Math.abs(sl.x-YARD_X_SHIFT)<=24&&sl.stack.length<3&& /* Local value for buffer in makeRelay() */
    (!sl.stack.length||!containers.get(sl.stack.at(-1))?.order)&&
    !slotClaims.has(sl))
    /* Evaluates callback for j=>!j.completed&&(j.buffer===sl||j.slot===sl||j.finalSlot===sl))) .sort using a, b */
    .sort( (a,b)=>Math.abs(a.x-mid)-Math.abs(b.x-mid)||a.stack.length-b.stack.length)[0];
  if(!buffer)return false;
  const  handoverY=1.45+buffer.stack.length*2.8; /* Local value for handover y in makeRelay() */
  // At most one new relay per yard at a time; both gantries are reserved.
  const  o=createOrder('YARD_RELAY',source,null,bi); /* Local value for o in makeRelay() */
  const  directCross=false; // non-passing cranes exchange cargo via a physical stack /* Local value for direct cross in makeRelay() */
  const  j={id:'JOB-'+String(++jobSeq).padStart(5,'0'),type:'YARD_RELAY',order:o, /* Loop index for the current nested collection in makeRelay() */
   container:source,vehicle:null,rtg:sourceCrane,otherRtg:destCrane,
   sourceCrane,destCrane,buffer,crossFromX:source.x,mode:directCross?'FULL_YARD':'BUFFER',slot:directCross?dest:buffer,
   destination:directCross?{x:dest.x,z:dest.z,y:1.45+dest.stack.length*2.8}:{x:buffer.x,z:buffer.z,y:handoverY},
   finalSlot:dest,phase:'',stage:directCross?'CROSS_CLEAR_TRACK':'RELAY_PREPOSITION',completed:false,started:t};
  left.job=j.id;right.job=j.id;source.order=o.id;o.status='RUNNING';o.job=j.id;lastRelayAt[bi]=t;
  registerJob(j);log('RELAY_ASSIGNED',{job:j.id,container:source.id,from:sourceRole,to:destRole,yard:L.yards[bi].id,mode:j.mode});
  return true;
 }
 /* Handles retreat crane in the terminal simulation */
  function retreatCrane(crane,targetX){
  if(Math.abs(crane.x-targetX)<.12){crane.x=targetX;crane.hook.x=targetX;return true;}
  const  step=Math.sign(targetX-crane.x)*Math.min(.3,Math.abs(targetX-crane.x)); /* Local value for step in retreatCrane() */
  const  next=crane.x+step; /* Next candidate or planned state in retreatCrane() */
  if(!craneRailSafe(crane,next)){craneWaits++;return false;}
  crane.x=next;crane.hook.x=next;
  return false;
 }
 /* Handles tick relay in the terminal simulation */
  function tickRelay(j){
  const  c=j.container, from=j.sourceCrane, to=j.destCrane; /* Current container or item being processed in tickRelay() */ /* Local value for from in tickRelay() */ /* Local value for to in tickRelay() */
  if(j.stage==='CROSS_CLEAR_TRACK'){
    // The other RTG moves to its own outside siding, allowing the working
    // RTG to serve the opposite end without overtaking another gantry.
    const siding=YARD_X_SHIFT+(from.role==='agv'?202:-202); /* Local value for siding in tickRelay() */
    if(retreatCrane(to,siding))j.stage='CROSS_CARRY_CONTAINER';
  }else if(j.stage==='CROSS_CARRY_CONTAINER'){
    const  source={x:c.x,z:c.z,y:c.y,carrier:'yard'}; /* Source location or graph node in tickRelay() */
    const  target={...j.destination,carrier:'yard'}; /* Destination or target for this operation in tickRelay() */
    if(!j.liftFrom){j.liftFrom=source;j.liftTo=target;}
    if(performLift(j,from,j.liftFrom,j.liftTo,'FULL_YARD_CROSS')){
      j.phase='';j.liftFrom=null;j.liftTo=null;j.stage='CROSS_RETURN_CRANES';
      log('FULL_YARD_HANDLING',{job:j.id,container:c.id,crane:from.id,from:j.crossFromX,to:target.x});
    }
  }else if(j.stage==='CROSS_RETURN_CRANES'){
    const  home=from.role==='agv'?YARD_AGV_CLEAR_X:YARD_TRUCK_CLEAR_X; /* Local value for home in tickRelay() */
    if(retreatCrane(from,home)){
      j.stage='RELAY_COMPLETE';
    }
  }else if(j.stage==='RELAY_PREPOSITION'){
    // Withdraw both gantries to opposite sides of the shared handover buffer.
    // This is real, animated rail travel, not a location jump.
    const  a=rtgAgv[j.rtg.yard], b=rtgTruck[j.rtg.yard]; /* First item being compared in tickRelay() */ /* Second item being compared in tickRelay() */
    const aa=retreatCrane(a,YARD_X_SHIFT-90), bb=retreatCrane(b,YARD_X_SHIFT+90); /* Local value for aa in tickRelay() */ /* Local value for bb in tickRelay() */
    if(aa&&bb)j.stage='RELAY_TO_BUFFER';
  }else if(j.stage==='RELAY_TO_BUFFER'){
    const  source={x:c.x,z:c.z,y:c.y,carrier:'yard'}; /* Source location or graph node in tickRelay() */
    const  target={x:j.buffer.x,z:j.buffer.z,y:1.45+j.buffer.stack.length*2.8,carrier:'yard'}; /* Destination or target for this operation in tickRelay() */
    if(!j.liftFrom){j.liftFrom=source;j.liftTo=target;}
    if(performLift(j,from,j.liftFrom,j.liftTo,'RELAY_STAGE')){
      j.phase='';j.liftFrom=null;j.liftTo=null;
      j.stage='RELAY_SOURCE_RETREAT';
      log('RELAY_BUFFER_STORED',{job:j.id,container:c.id,crane:from.id});
    }
  }else if(j.stage==='RELAY_SOURCE_RETREAT'){
    const  retreat=from.role==='agv'?YARD_AGV_CLEAR_X:YARD_TRUCK_CLEAR_X; /* Local value for retreat in tickRelay() */
    if(retreatCrane(from,retreat)){
      j.rtg=to;setJobSlot(j,j.finalSlot);
      j.destination={x:j.finalSlot.x,z:j.finalSlot.z,y:1.45+j.finalSlot.stack.length*2.8};
      j.stage='RELAY_TO_DESTINATION';j.phase='';
    }
  }else if(j.stage==='RELAY_TO_DESTINATION'){
    const  source={x:c.x,z:c.z,y:c.y,carrier:'yard'}; /* Source location or graph node in tickRelay() */
    const  target={...j.destination,carrier:'yard'}; /* Destination or target for this operation in tickRelay() */
    if(!j.liftFrom){j.liftFrom=source;j.liftTo=target;}
    if(performLift(j,to,j.liftFrom,j.liftTo,'RELAY_DELIVER')){
      j.stage='RELAY_COMPLETE';j.phase='';j.liftFrom=null;j.liftTo=null;
    }
  }else if(j.stage==='RELAY_COMPLETE'){
    if(c.site!=='yard'||c.slot!==j.finalSlot.yard+'-'+j.finalSlot.bay+'-'+j.finalSlot.row)
      throw Error('Relay destination inventory mismatch');
    c.order=null;j.order.status='DONE';j.order.completed=t;liveOrders.delete(j.order);
    from.completed++;if(j.mode==='BUFFER')to.completed++;completedRelays++;moveCount++;
    from.job=null;to.job=null;completeJob(j);
    log('RELAY_COMPLETED',{job:j.id,container:c.id,from:from.id,to:to.id,mode:j.mode});
  }
 }
 // Every AGV and truck receives an actual container-specific transport order in advance.
 // Ordered but inactive vehicles remain safely parked at existing physical facilities.
 // This separates fleet assignment from the independent multi-vehicle
 // road admission controller; traffic conflicts are arbitrated at junctions.
 let  lastDispatch=0, lastTruck=0, orderRefresh=0, nextDispatchYard=0, assignmentCursor=0; /* Local value for last dispatch in makeEngine() */ /* Local value for last truck in makeEngine() */ /* Local value for order refresh in makeEngine() */ /* Local value for next dispatch yard in makeEngine() */ /* Local value for assignment cursor in makeEngine() */
 /* Handles current top in the terminal simulation */
  function currentTop(c){
  if(!c||c.site==='yard'){
   if(!c||c.site!=='yard')return false;
   /* Evaluates callback for yardSlots.some using s */
   return yardSlots.some( s=>s.yard===c.yard&&s.stack.at(-1)===c.id);
  }
  /* Evaluates callback for [...containers.values()].some using d */
  if(c.site==='ship')return ![...containers.values()].some( d=>d!==c&&d.site==='ship'&&d.ship===c.ship&&
     Math.abs(d.x-c.x)<.1&&Math.abs(d.z-c.z)<.1&&d.y>c.y+.1);
  return c.site==='truck';
 }
 // STS cranes originate AGV demand from their vessel's work list.
 // The phase is vessel-wide: none of its cranes may request export cargo until
 // every discharge item has physically reached DONE (not merely been reserved).
 /* Handles vessel work phase in the terminal simulation */
  function vesselWorkPhase(call){
  if(!call||call.state!=='WORKING')return 'UNAVAILABLE';
  /* Evaluates callback for call.discharge.some using w */
  if(call.discharge.some( w=>w.state!=='DONE'))return 'DISCHARGING';
  /* Evaluates callback for call.load.some using w */
  if(call.load.some( w=>w.state!=='DONE'))return 'LOADING';
  return 'COMPLETED';
 }

 // New orchestration: the controller owns persistent demand and mission state.
 // The existing engine remains the physical movement / crane execution adapter.
 // Four physical STS lanes allow two suppliers plus a current handover and
 // one clearance lane. Delivery tails do not consume this supply budget.
 const TRANSPORT_POLICY={maxQueuedPerSTS:STS_DOCK_LANES.length-2,maxActiveImportsPerYard:3,maxQueuedImportsPerYard:agvs.length};
 function openStsDemands(){
  const demand=[];
  const supply=new Map();
  for(const job of liveJobs){
   if(job.order?.crane&&!job.stsServiceStarted&&!(job.type==='IMPORT'&&job.pickupCraneReleased))
    supply.set(job.order.crane,(supply.get(job.order.crane)||0)+1);
  }
  let free;
  const publish=(type,call,c,work)=>{
   const bay=shipBayByX[call.berth].get(type==='IMPORT'?c.x:work.plannedPosition?.x);
   if(!bay)return;
   const incumbent=bay.cranes.find(q=>q.id===work.crane)||bay.cranes[0];
   let qc=incumbent;
   if(bay.cranes.length>1){
    free??=agvs.filter(vehicleDispatchable);
    const score=q=>{
     if(q.downUntil>t)return Infinity;
     const forecast=serviceForecast(q);
     const sweep={min:Math.min(q.homeX,bay.x),max:Math.max(q.homeX,bay.x)};
     const blocker=stsSweepBlocker(q,sweep);
     let railReady=0;
     if(blocker){
      railReady=Math.max(0,blocker.downUntil-t,serviceForecast(blocker).readyIn);
      if(!railReady)railReady=forecast.cycleSeconds;
     }
     const arrival=free.length?Math.min(...free.map(v=>estimateArrival({type,qc:q,c},v).seconds)):0;
     return Math.max(arrival,railReady,forecast.readyIn+(supply.get(q.id)||0)*forecast.cycleSeconds);
    };
    const alternate=bay.cranes.find(q=>q!==incumbent);
    if(score(alternate)+1e-6<score(incumbent))qc=alternate;
   }
   if(qc!==incumbent)log('STS_DEMAND_REASSIGNED',{sts:qc.id,call:call.id,container:c.id,
    previousSts:incumbent.id,fromState:'PLANNED',toState:'PLANNED',
    selectionReason:incumbent.downUntil>t?'CRANE_OUTAGE':'EARLIER_SERVICE'});
   work.crane=qc.id;
   demand.push({type,qc,call,c,work});
  };
  for(const [berth,cranes] of berthCranes.entries()){
   const call=activeCall(berth),phase=vesselWorkPhase(call);
   if(phase==='DISCHARGING'){
    // Discover top cargo before selecting a crane so that changing a preference
    // cannot cause the same container to be published twice in this scan.
    const tops=cranes.flatMap(q=>topShip(q));
    const workByContainer=new Map(call.discharge.map(work=>[work.container,work]));
    for(const c of tops)publish('IMPORT',call,c,workByContainer.get(c.id));
   }else if(phase==='LOADING'){
    for(const work of call.load){
     if(work.state!=='PLANNED')continue;
     const c=containers.get(work.container);
     if(c&&c.site==='yard'&&!c.order)publish('EXPORT',call,c,work);
    }
   }
  }
  return demand;
 }
 function waitingReasonForVehicle(v){
  if(v.route?.length)return 'TRAVELLING_TO_PICKUP';
  if(v.stageBay)return 'WAITING_AT_CRANE_TRANSFER_LANE';
  if(v.x<-360)return 'WAITING_FOR_PARKING_DEPARTURE';
  return 'WAITING_FOR_RESOURCE_AUTHORIZATION';
 }
 function parkingDepartureAuthorized(v){
  return PortGridControl.authorizeParkingDeparture(v,agvs)===null;
 }
 function vehicleDispatchable(v){
  return !v.job&&!v.pending&&!v.pipelineJob&&!v.load&&!v.pivot&&!v.recovery&&
   (!v.route.length&&['PARKED','AVAILABLE'].includes(v.state)||
    v.state==='RETURNING'&&(AGV_GRID.edges.get(gKey(v.x,v.z))||[]).some(edge=>edge.section.travel)&&
    ![...serviceReservations.values()].some(permit=>permit.vehicleId===v.id));
 }
 function selectPickupStand(v,pick){
  if(pick.type==='IMPORT'){
   const occupied=new Set(agvs.filter(a=>a!==v&&a.stageBay?.side==='sts'&&a.stageBay.crane===pick.qc.id).map(a=>a.stageBay.z));
   for(const j of liveJobs)if(j.sts?.id===pick.qc.id&&j.stsDockZ!=null&&!(j.type==='IMPORT'&&j.pickupCraneReleased))occupied.add(j.stsDockZ);
   const usable=STS_DOCK_LANES.filter(z=>!occupied.has(z)&&!stsStandHasThroughRoute(pick.qc.homeX,z,v)&&
    !agvs.some(a=>a!==v&&Math.hypot(a.x-pick.qc.homeX,a.z-z)<8));
   if(!usable.length)return null;
   return {x:pick.qc.homeX,z:usable[0],crane:pick.qc.id,side:'sts',lane:STS_DOCK_LANES.indexOf(usable[0])};
  }
  return availableDockBay('agv',pick.bi,v);
 }
 function makeTruckAssignment(v){
  if(v.job||v.pending||v.route.length||v.state!=='GATE')return false;
  const unit=Number(v.id.slice(-2)), choices=[];
  for(let bi=0;bi<L.yards.length;bi++){
   if(L.yards[bi].type==='inbound'){
    const c=topYard(bi,'inbound','truck')[0];if(c)choices.push({type:'TRUCK_PICKUP',c,bi});
   }else if(!v.load&&freeSlot(bi,'truck'))choices.push({type:'TRUCK_DELIVERY',c:null,bi});
  }
  if(!choices.length)return false;
  const preferred=(unit+v.completed)%2?'TRUCK_PICKUP':'TRUCK_DELIVERY';
  const candidates=choices.filter(p=>p.type===preferred);
  const pick=(candidates.length?candidates:choices).sort((a,b)=>Math.abs(v.z-L.yards[a.bi].z)-Math.abs(v.z-L.yards[b.bi].z))[0];
  let c=pick.c;
  if(pick.type==='TRUCK_DELIVERY'){
   c=cont('truck',point(v.x,v.z),{y:3.5,direction:'outbound'});
   c.carrier=v;v.load=c.id;trace(c,'GATE_RECEIVED',v.id);bookTruckExport(c);
  }
  const o=createOrder(pick.type,c,null,pick.bi);
  o.status='ASSIGNED_WAITING';o.vehicle=v.id;o.assigned=t;
  v.pending=o.id;v.task={type:pick.type,status:'QUEUED_FOR_CRANE',container:c.id,order:o.id,yard:pick.bi,assigned:t};
  log('TRUCK_ORDER_CREATED',{vehicle:v.id,order:o.id,type:o.type});return true;
 }
 // Physical mission activation is a separate authorization stage. A busy
 // destination RTG does NOT prevent a discharge AGV from reaching the STS.
 function activateAssignment(v){
  const o=ordersById.get(v.pending);
  if(!o||o.status!=='ASSIGNED_WAITING'||v.job||v.route?.length)return 'ORDER_NOT_READY';
  const c=containers.get(o.container),bi=o.yard;
  if(!c||c.order!==o.id)return 'INVENTORY_RESERVATION_INVALID';
  const qc=o.crane?sts.find(q=>q.id===o.crane):null;
  const call=o.vesselCall?vesselCalls.find(k=>k.id===o.vesselCall):null;
  const rtg=v.type==='truck'?rtgTruck[bi]:rtgAgv[bi];
  if(v.type==='agv'&&v.x<-360&&!parkingDepartureAuthorized(v))return 'PARKING_EXIT_CONFLICT';
  if(v.type==='truck'&&v.state!=='GATE')return 'TRUCK_NOT_AT_GATE';
  if(rtg.downUntil>t)return 'YARD_CRANE_OUTAGE';
  if(o.type==='IMPORT'){
   if(vesselWorkPhase(call)!=='DISCHARGING'||activeCall(qc?.ship)?.id!==o.vesselCall)return 'VESSEL_NOT_DISCHARGING';
   if(c.site!=='ship'||!currentTop(c))return 'SHIP_CARGO_NOT_ACCESSIBLE';
   if(!qc||qc.downUntil>t)return 'STS_CRANE_OUTAGE';
   if(!(v.stageBay?.side==='sts'&&v.stageBay.crane===qc.id||freeStsLane(qc)))return 'STS_TRANSFER_LANES_FULL';
   if(!availableDockBay('agv',bi,v))return 'YARD_TRANSFER_LANES_FULL';
   const active=[...liveJobs].filter(j=>!j.preposition&&j.type==='IMPORT'&&j.order.yard===bi).length;
   if(active>=TRANSPORT_POLICY.maxActiveImportsPerYard)return 'YARD_DELIVERY_CAPACITY_FULL';
   const placeholder=jobsById.get(v.pipelineJob);
   const slot=placeholder?.slot||freeSlot(bi,'agv');if(!slot)return 'YARD_STORAGE_FULL';
   stageJob('IMPORT',o,v,qc,rtg,{x:slot.x,z:slot.z,y:1.45+slot.stack.length*2.8},slot);
  }else if(o.type==='EXPORT'){
   if(vesselWorkPhase(call)!=='LOADING'||activeCall(qc?.ship)?.id!==o.vesselCall)return 'VESSEL_NOT_LOADING';
   if(!qc||qc.downUntil>t)return 'STS_CRANE_OUTAGE';
   if(c.site!=='yard'||!currentTop(c))return 'EXPORT_CARGO_NOT_ACCESSIBLE';
   if(!availableDockBay('agv',bi,v))return 'YARD_TRANSFER_LANES_FULL';
   if(!freeStsLane(qc))return 'STS_TRANSFER_LANES_FULL';
   const place=shipPlace(qc,c);if(!place)return 'STOWAGE_NOT_READY';
   stageJob('EXPORT',o,v,rtg,qc,place,null);
  }else if(o.type==='TRUCK_PICKUP'){
   if(c.site!=='yard'||!currentTop(c))return 'TRUCK_CARGO_NOT_ACCESSIBLE';
   if(!availableDockBay('truck',bi,v))return 'TRUCK_TRANSFER_LANES_FULL';
   stageJob('TRUCK_PICKUP',o,v,rtg,null,{x:0,z:0},null);
  }else if(o.type==='TRUCK_DELIVERY'){
   if(c.site!=='truck'||c.carrier!==v||v.load!==c.id)return 'TRUCK_CARGO_NOT_READY';
   const slot=freeSlot(bi,'truck');if(!slot)return 'TRUCK_YARD_STORAGE_FULL';
   if(!availableDockBay('truck',bi,v))return 'TRUCK_TRANSFER_LANES_FULL';
   stageJob('TRUCK_DELIVERY',o,v,null,rtg,{x:slot.x,z:slot.z,y:1.45+slot.stack.length*2.8},slot);
  }else return 'UNSUPPORTED_MISSION_TYPE';
  v.pending=null;v.stageBay=null;
  if(call){const work=(o.type==='IMPORT'?call.discharge:call.load).find(w=>w.container===c.id);
   if(work&&work.state==='RESERVED'){work.state='IN_PROGRESS';work.startedAt=t;}}
  v.task={type:o.type,status:'ACTIVE',container:c.id,order:o.id,yard:bi,assigned:o.assigned};
  return true;
 }
 // Adapter to the independent PortGridControl unit-testable scheduling module.
 const coordinator=PortGridControl.createController({
  now:()=>t,demands:openStsDemands,
  availableVehicles:()=>agvs,
  isVehicleFree:v=>vehicleDispatchable(v),
  pickup:q=>q.type==='IMPORT'?{x:q.qc.homeX,z:L.stsDockZ}:{x:L.agvDockX,z:L.yards[q.c.yard].z},
  serviceStatus:m=>{
   const j=jobForOrder(m.id);
   if(!j||j.completed||j.type==='IMPORT'&&j.pickupCraneReleased)return 'SERVED';
   return j.sts?.job===j.id?'HANDLING':'SUPPLYING';
  },
  serviceForecast:qc=>serviceForecast(qc),
  estimateArrival:(q,v)=>estimateArrival(q,v),
  stsWaiting:qc=>craneMetric(qc).waitingAGV,
  canReserve:(q,v)=>{
   if(q.qc.downUntil>t)return 'STS_CRANE_OUTAGE';
   if(q.type==='IMPORT'){
    const possible=L.yards.some((y,bi)=>y.type==='inbound'&&
      PortGridControl.authorizeImportYard({outage:rtgAgv[bi].downUntil>t,
        storageAvailable:!!freeSlot(bi,'agv',false),
        active:0, // Pending supply is bounded separately from active delivery.
        queued:[...liveOrders].filter(o=>o.type==='IMPORT'&&o.yard===bi&&o.status==='ASSIGNED_WAITING').length,
        maxActive:TRANSPORT_POLICY.maxActiveImportsPerYard,
        maxQueued:TRANSPORT_POLICY.maxQueuedImportsPerYard})===null);
    return possible?null:'NO_SAFE_YARD_DESTINATION';
   }
   if(!(q.c.site==='yard'&&currentTop(q.c)&&topYard(q.c.yard,'outbound','agv').includes(q.c)))return 'EXPORT_NOT_ACCESSIBLE';
   if(!availableDockBay('agv',q.c.yard,v))return 'YARD_TRANSFER_LANES_FULL';
   if(!shipPlace(q.qc,q.c))return 'STOWAGE_NOT_READY';
   return null;
  },
  reserve:(q,v,context={})=>{
   let bi;
   if(q.type==='IMPORT'){
    const candidates=L.yards.map((y,i)=>({y,i})).filter(({y,i})=>y.type==='inbound'&&
      PortGridControl.authorizeImportYard({outage:rtgAgv[i].downUntil>t,
        storageAvailable:!!freeSlot(i,'agv',false),
        active:0,
        queued:[...liveOrders].filter(o=>o.type==='IMPORT'&&o.yard===i&&o.status==='ASSIGNED_WAITING').length,
        maxActive:TRANSPORT_POLICY.maxActiveImportsPerYard,
        maxQueued:TRANSPORT_POLICY.maxQueuedImportsPerYard})===null);
    if(!candidates.length)return null;
    const deliveryCost=i=>{
     const crane=rtgAgv[i],cycle=serviceSamples.get(crane.id)??30;
     const work=[...liveJobs].filter(j=>j.order?.yard===i&&j.type==='IMPORT');
     const travel=graphDistance({x:q.qc.homeX,z:L.stsDockZ},YARD_AGV_BAYS[i][0])/Math.max(.1,v.speed);
     return Math.max(estimateArrival(q,v).seconds+serviceForecast(q.qc).cycleSeconds+travel,
      work.length*cycle)+cycle;
    };
    const committed=i=>[...liveJobs].filter(j=>j.order?.yard===i&&j.type==='IMPORT').length;
    candidates.sort((a,b)=>committed(a.i)-committed(b.i)||deliveryCost(a.i)-deliveryCost(b.i)||a.i-b.i);
    bi=candidates[0].i;
   }else bi=q.c.yard;
   if(q.c.order||q.work.state!=='PLANNED'||q.work.crane!==q.qc.id)return null;
   const exportStand=q.type==='EXPORT'?availableDockBay('agv',bi,v):null;
   if(q.type==='EXPORT'&&!exportStand)return null;
   if(v.state==='RETURNING'){
    // Redirect an empty return only at an actual graph node. Mid-edge
    // diversion would invent a diagonal connector and bypass turning guards.
    if(!vehicleDispatchable(v))return null;
    v.route=[];v.routeIndex=0;v.routeVersion=(v.routeVersion||0)+1;
    log('AGV_RETURN_REASSIGNED',{vehicle:v.id,sts:q.qc.id,container:q.c.id});
   }
   const o=createOrder(q.type,q.c,q.qc,bi);
   o.requestedAt=context.requestedAt??t;o.predictedArrival=estimateArrival(q,v);
   // A double cycle is counted only when consecutive real vessel transport
   // orders use opposite directions. Cross-vessel reuse is measured explicitly.
   const paired=v.lastCompletedType&&v.lastCompletedType!==q.type&&
     ['IMPORT','EXPORT'].includes(v.lastCompletedType)&&['IMPORT','EXPORT'].includes(q.type);
   if(paired&&v.lastTransportEnd){
    const pickup=q.type==='IMPORT'?{x:q.qc.homeX,z:L.stsDockZ}:YARD_AGV_BAYS[bi][0];
    o.cycleComparison={emptyMetersAtEnd:v.lastTransportEnd.emptyMeters,
     unpairedGraphMeters:graphDistance(v.lastTransportEnd.position,v.home)+graphDistance(v.home,pickup)};
   }
   if(paired)log('AGV_DOUBLE_CYCLE_ASSIGNED',{vehicle:v.id,previous:v.lastCompletedType,next:q.type,
     previousVessel:v.lastCompletedVesselCall||null,nextVessel:q.call.id,
     crossVessel:!!v.lastCompletedVesselCall&&v.lastCompletedVesselCall!==q.call.id,
     container:q.c.id,pickupDistance:Math.round(Math.abs(v.x-(q.type==='IMPORT'?q.qc.homeX:L.agvDockX))+
       Math.abs(v.z-(q.type==='IMPORT'?L.stsDockZ:L.yards[bi].z)))});
   o.status='ASSIGNED_WAITING';o.vehicle=v.id;o.assigned=t;
   q.work.state='RESERVED';q.work.order=o.id;q.work.reservedAt=t;
   v.pending=o.id;v.state='STAGED';
   if(exportStand)v.stageBay=exportStand;
   const placeholder={id:'JOB-'+String(++jobSeq).padStart(5,'0'),type:q.type,order:o,container:q.c,
    vehicle:v,sts:null,rtg:null,stage:'PREPOSITION',started:t,phase:'',completed:false,preposition:true,yard:bi};
   if(q.type==='IMPORT')placeholder.slot=freeSlot(bi,'agv',false);
   registerJob(placeholder);v.pipelineJob=placeholder.id;o.job=placeholder.id;
   v.task={type:q.type,status:'RESERVED',container:q.c.id,order:o.id,yard:bi,assigned:t};
   log('STS_DEMAND_ASSIGNED',{sts:q.qc.id,vehicle:v.id,order:o.id,container:q.c.id,type:q.type});
   return {orderId:o.id};
  },
  progress:m=>{
   const o=ordersById.get(m.id),v=agvs.find(x=>x.id===m.vehicle);
   if(!o||!v)return 'CANCELLED';
   if(o.status==='DONE')return 'DONE';
   if(o.status==='RUNNING'&&(v.blockedTime||0)>10)return 'BLOCKED';
   if(o.status==='RUNNING')return 'RUNNING';
   if(v.route.length)return 'MOVING';
   if(v.stageBay&&v.state==='STAGED')return 'STAGED';
   return 'WAITING';
  },
  start:m=>{
   const v=agvs.find(x=>x.id===m.vehicle);
   return v?activateAssignment(v):'AGV_NOT_FOUND';
  },
  preposition:m=>{
   const v=agvs.find(x=>x.id===m.vehicle),o=ordersById.get(m.id);
   if(!v||!o||v.job)return 'AGV_NOT_AVAILABLE';
   if(v.route.length||v.stageBay)return 'ALREADY_PREPOSITIONING';
   const qc=sts.find(q=>q.id===o.crane);
   if(!qc||qc.downUntil>t)return 'STS_CRANE_OUTAGE';
   const stand=selectPickupStand(v,{type:o.type,qc,bi:o.yard});
   if(!stand)return 'TRANSFER_STAND_UNAVAILABLE';
   if(!parkingDepartureAuthorized(v))return 'PARKING_EXIT_CONFLICT';
   v.stageBay=stand;
   try{setRoute(v,'staging');log('AGV_PREPOSITIONED',{vehicle:v.id,sts:qc.id,order:o.id});return true;}
   catch(e){v.stageBay=null;return 'ROUTE_UNAVAILABLE: '+e.message;}
  },
  waitReason:m=>{
   const v=agvs.find(x=>x.id===m.vehicle);return v?(v.blockedTime>10?'AGV_ROUTE_BLOCKED '+v.blockedTime.toFixed(0)+'s':waitingReasonForVehicle(v)):'AGV_NOT_FOUND';
  }
 },{maxQueuedPerCrane:TRANSPORT_POLICY.maxQueuedPerSTS});
 function makeAssignment(v){
  if(v.type==='agv'){coordinator.step(true);return !!(v.job||v.pending||v.route.length);}
  return makeTruckAssignment(v);
 }
 function dispatch(){
  coordinator.step();
  // A booked export on the truck side is vessel work, not an incidental
  // reshuffle. Acquire the free crane pair before admitting more truck work.
  for(let bi=0;bi<L.yards.length;bi++)if(L.yards[bi].type==='outbound'&&
   topYard(bi,'outbound','truck').some(c=>c.loadCall&&vesselCalls.some(call=>call.id===c.loadCall&&['WORKING','MOORING','APPROACHING','WAITING_BERTH'].includes(call.state))))makeRelay(bi);
  for(const v of trucks){if(!v.job&&!v.pending)makeTruckAssignment(v);if(v.pending&&!v.job)activateAssignment(v);}
  for(let bi=0;bi<L.yards.length;bi++)if(!rtgAgv[bi].job&&!rtgTruck[bi].job)makeRelay(bi);
 }
 // Begin with persistent STS demand rather than reserving every AGV at boot.
 coordinator.updateDemand();
 /* Handles perform lift in the terminal simulation */
  function performLift(j,crane,from,target,ownerLabel){
  if(crane.downUntil>t)return false;
  if(crane.type==='rtg'&&!j.phase)j.rtgServiceStarted=t;
  const  c=j.container; /* Current container or item being processed in performLift() */
  if(!j.phase){j.phase='MOVE_ABOVE';j.phaseTime=0;}
  const  hook=crane.hook; /* Local value for hook in performLift() */
  const clearance=crane.type==='sts'?STS_LIFT_CLEARANCE:24;
  const goal=(phase)=>phase==='MOVE_ABOVE'?{x:from.x,z:from.z,y:clearance}:phase==='LOWER'?{x:from.x,z:from.z,y:from.y+1.6}: /* Computes goal for the current simulation operation */
    phase==='RAISE'?{x:from.x,z:from.z,y:clearance}:phase==='MOVE_TARGET'?{x:target.x,z:target.z,y:clearance}:
    phase==='DROP'?{x:target.x,z:target.z,y:target.y+1.6}:
    {x:target.x,z:target.z,y:clearance};

  const targetHook=goal(j.phase);
  const dx=targetHook.x-hook.x,dz=targetHook.z-hook.z;
  const linear=crane.type==='sts'?Math.max(Math.abs(dx),Math.abs(dz)):Math.hypot(dx,dz);
  const  dh=targetHook.y-hook.y;const  step=9/30; /* Local value for dh in performLift() */ /* Local value for step in performLift() */
  if(crane.type==='rtg'){
   // Reject unreachable tasks (scheduler bug), rather than parking forever at a rail limit.
   if(!craneHookReachable(crane,targetHook.x))throw Error(crane.id+' spreader target out of reach');
  }
  if(crane.type==='sts'){
   const sweep=stsSweeps.get(crane.id);
   if(!sweep||targetHook.x<sweep.min-1e-6||targetHook.x>sweep.max+1e-6)
    throw Error(crane.id+' lift outside its authorized rail sweep');
   // Raise the spreader clear of stacked cargo before traversing the deck.
   if(linear>.1&&hook.y<clearance-.01){
    hook.y=Math.min(clearance,hook.y+step*1.7);
    return false;
   }
  }
  if(linear>.1){
   // An STS gantry and its trolley have independent drives. Either axis
   // can reach its target while the other is still travelling.
   const travel=Math.min(1,step/linear);
   const nextX=hook.x+(crane.type==='sts'?Math.sign(dx)*Math.min(Math.abs(dx),step):dx*travel);
   if(crane.type==='rtg'){
    // Gantry rolls directly above the assigned container / vehicle position.
    if(!craneRailSafe(crane,nextX)){craneWaits++;return false;}
   }
   crane.x=nextX;
   hook.x=nextX;hook.z+=crane.type==='sts'?Math.sign(dz)*Math.min(Math.abs(dz),step):dz*travel;
  }else{
   if(crane.type==='rtg'&&!craneRailSafe(crane,targetHook.x)){
    craneWaits++;return false;
   }
   crane.x=targetHook.x;
   hook.x=targetHook.x;hook.z=targetHook.z;
  }
  if(Math.abs(dh)>.06)hook.y+=Math.sign(dh)*Math.min(Math.abs(dh),step*1.7);else hook.y=targetHook.y;
  if(crane.carrying===c.id){c.x=hook.x;c.z=hook.z;c.y=hook.y-1.6;}
  if(linear>.12||Math.abs(dh)>.1)return false;
  const  now=j.phase; /* Local value for now in performLift() */
  if(now==='MOVE_ABOVE')j.phase='LOWER';
  else if(now==='LOWER'){
    if(crane.carrying)throw Error('Crane already carrying a container');
    if(from.carrier==='vehicle' && j.vehicle.load!==c.id)throw Error('Vehicle does not own source container');
    if(from.carrier==='ship'&&c.site!=='ship'||from.carrier==='yard'&&c.site!=='yard')throw Error('Wrong source container');
    if(from.carrier==='yard')removeStack(c);
    crane.carrying=c.id; if(j.vehicle?.load===c.id)j.vehicle.load=null;
    moveCargo(c,crane,'LIFTED');j.phase='RAISE';
  }else if(now==='RAISE')j.phase='MOVE_TARGET';
  else if(now==='MOVE_TARGET')j.phase='DROP';
  else if(now==='DROP'){
    if(crane.carrying!==c.id)throw Error('Crane is not carrying expected container');
    crane.carrying=null;c.carrier=null;c.x=target.x;c.z=target.z;c.y=target.y;
    if(target.carrier==='vehicle'){
      if(j.vehicle.load)throw Error('Vehicle deck already occupied');j.vehicle.load=c.id;moveCargo(c,j.vehicle,'PLACED_ON_VEHICLE');
    }else if(target.carrier==='yard'){
      c.site='yard';c.y=target.y;c.yard=j.rtg.yard;c.direction=L.yards[c.yard].type;c.slot=j.slot?.yard+'-'+j.slot?.bay+'-'+j.slot?.row;
      if(!j.slot)throw Error('Missing yard destination slot');j.slot.stack.push(c.id);trace(c,'STACKED',L.yards[c.yard].id);
    }else if(target.carrier==='ship'){
      /* Evaluates callback for vesselCalls.find using k */
      c.site='ship';c.ship=j.sts.ship;c.callId=j.order.vesselCall;const  sailingCall=vesselCalls.find( k=>k.id===c.callId);if(sailingCall&&!sailingCall.shipContainers.includes(c.id))sailingCall.shipContainers.push(c.id);trace(c,'STOWED','VES-'+(c.ship+1)); /* Local value for sailing call in performLift() */
    }else throw Error('Unknown receiving carrier');
    if(crane.type==='sts'){
     const bayX=j.type==='IMPORT'?from.x:target.x;
     if(shipBayByX[crane.ship].get(bayX).cranes.length>1)
      log('STS_SHARED_BAY_TRANSFER',{job:j.id,sts:crane.id,bayX,action:j.type});
    }
    j.phase='CLEAR';
  }else if(now==='CLEAR'){j.phase='';return true;}
  return false;
 }
 /* Handles remove stack in the terminal simulation */
 /* Evaluates callback for yardSlots.find using s */
  function removeStack(c){const  slot=yardSlots.find( s=>s.yard===c.yard&&s.stack.at(-1)===c.id);if(!slot)throw Error('Yard container not at stack top');slot.stack.pop();} /* Current storage or transfer slot in removeStack() */
 /* Handles vehicle target in the terminal simulation */
  function vehicleTarget(v,car){return {x:v.x,z:v.z,y:v.type==='truck'?3.5:3.65,carrier:'vehicle'}}
 // STS handoff interlock: a stationary AGV must be on the dedicated transfer
 // lane, centred under the crane, with its longitudinal (X) axis parallel to
 // both the container and spreader. A perpendicular approach is not accepted.
 /* Handles aligned at sts in the terminal simulation */
  function alignedAtSTS(v,qc,dockZ){return !!qc && v.state==='DOCKED' && !v.route.length &&
   Math.abs(v.x-qc.homeX)<.12 && Math.abs(v.z-dockZ)<.12 &&
   Math.abs(Math.sin(v.heading))<.035;}
 function alignedAtRTG(v,crane,dockZ){
  const bays=(v.type==='agv'?YARD_AGV_BAYS:YARD_TRUCK_BAYS)[crane.yard];
  return crane.role===(v.type==='agv'?'agv':'truck')&&v.state==='DOCKED'&&!v.route.length&&
   Math.abs(Math.sin(v.heading))<.035&&bays.some(b=>Math.abs(b.z-dockZ)<.01&&Math.abs(v.x-b.x)<.12&&Math.abs(v.z-b.z)<.12);
 }
 function acquireTransferCrane(j,crane){
  const aligned=crane.type==='sts'?alignedAtSTS(j.vehicle,crane,j.stsDockZ):
   alignedAtRTG(j.vehicle,crane,j.vehicle.type==='agv'?j.yardDockZ:j.truckDockZ);
  if(!aligned){requestTransferAlignment(j,crane);return false;}
  if(crane.downUntil>t||crane.job&&crane.job!==j.id)return false;
  if(!crane.job){
   if(crane.type==='sts'){
    if(stsSweeps.has(crane.id))return false;
    const bayX=j.type==='IMPORT'?j.container.x:j.destination.x;
    if(!shipBayByX[crane.ship].get(bayX)?.cranes.includes(crane))
     throw Error(crane.id+' cannot reach its assigned ship bay');
    const sweep={min:Math.min(crane.homeX,bayX),max:Math.max(crane.homeX,bayX)};
    const blocker=stsSweepBlocker(crane,sweep);
    if(blocker){
     if(j.stsRailBlocker!==blocker.id)log('STS_RAIL_WAIT',{job:j.id,blockingReason:'STS_RAIL_CLEARANCE',
      blockingResourceId:blocker.id,routeOrReservationId:blocker.id+':rail'});
     j.stsRailBlocker=blocker.id;
     return false;
    }
    j.stsRailBlocker=null;
    stsSweeps.set(crane.id,sweep);
    j.stsServiceStarted=t;j.order.stsServiceStartedAt=t;
   }
   else j.rtgServiceStarted=t;
   crane.job=j.id;
   log(crane.type==='sts'?'STS_CRANE_JIT_RESERVED':'YARD_CRANE_JIT_RESERVED',
    {crane:crane.id,sts:j.sts?.id||null,job:j.id,vehicle:j.vehicle.id,
     ...(crane.type==='sts'?{railSweep:stsSweeps.get(crane.id),routeOrReservationId:crane.id+':rail'}:{})});
  }
  return true;
 }
 function requestTransferAlignment(j,crane){
  const v=j.vehicle,dockZ=crane.type==='sts'?j.stsDockZ:v.type==='agv'?j.yardDockZ:j.truckDockZ;
  const dockX=crane.type==='sts'?crane.homeX:v.type==='agv'?L.agvDockX:L.truckDockX;
  if(v.type!=='agv'||v.route.length||v.state!=='DOCKED'||v.pivot||Math.abs(v.x-dockX)>=.12||Math.abs(v.z-dockZ)>=.12||Math.abs(Math.sin(v.heading))<.035)return;
  if(v.load)return;
  v.pivot={target:Math.cos(v.heading)>=0?0:Math.PI,started:false,alignment:true};
  log('TRANSFER_ALIGNMENT_REQUESTED',{job:j.id,vehicle:v.id,crane:crane.id});
 }
 function craneOccupancy(){
  return cranes.filter(c=>c.job).map(crane=>{
   const j=liveJob(crane.job),v=j?.vehicle;
   const aligned=v?(crane.type==='sts'?alignedAtSTS(v,crane,j.stsDockZ):
    alignedAtRTG(v,crane,v.type==='agv'?j.yardDockZ:j.truckDockZ)):false;
   return {craneId:crane.id,jobId:crane.job,missionId:j?.order?.id||null,vehicleId:v?.id||null,
    stage:j?.stage||null,operation:j?.type||null,aligned,
    valid:j?.type==='YARD_RELAY'||!!(j&&aligned&&['PICK','PLACE'].includes(j.stage))};
  });
 }
 /* Advances physical crane transfers and container transport job stages */
  function tickJob(j){if(j.type==='YARD_RELAY'){tickRelay(j);return;}
  const  v=j.vehicle, c=j.container, rtg=j.rtg, qc=j.sts; /* Current vehicle or value being processed in tickJob() */ /* Current container or item being processed in tickJob() */ /* Local value for rtg in tickJob() */ /* Local value for qc in tickJob() */
  // Vehicle enters its designated crane interchange only after the physical lane route is complete.
  if(j.stage==='TO_PICKUP'&&v.state==='DOCKED'){
   if(j.order.pickupArrivedAt==null){j.order.pickupArrivedAt=t;log('PICKUP_ARRIVED',{job:j.id,vehicle:v.id});}
   if(j.type==='IMPORT'){
    if(j.stsArrivedAt==null){j.stsArrivedAt=t;j.order.stsArrivedAt=t;}
    if(!currentTop(c)||!acquireTransferCrane(j,qc))return;
   }
   else {
    if(j.type!=='TRUCK_DELIVERY'&&!currentTop(c)||!acquireTransferCrane(j,rtg))return;
   }
   j.stage='PICK';j.phase='';
  }
  if(j.stage==='PICK'){
   let  crane, from, target; /* Crane participating in the current operation in tickJob() */ /* Local value for from in tickJob() */ /* Destination or target for this operation in tickJob() */
   if(j.type==='IMPORT'){
    if(!alignedAtSTS(v,qc,j.stsDockZ))return;
    crane=qc;from={x:c.x,y:c.y,z:c.z,carrier:'ship'};target=vehicleTarget(v); // destination needs frozen x/z while parked
   }else if(j.type==='EXPORT'){
    crane=rtg;from={x:c.x,y:c.y,z:c.z,carrier:'yard'};target=vehicleTarget(v);
   }else if(j.type==='TRUCK_DELIVERY'){
    crane=rtg;from=vehicleTarget(v);target=j.destination;target.carrier='yard';
   }else if(j.type==='TRUCK_PICKUP'){
    crane=rtg;from={x:c.x,y:c.y,z:c.z,carrier:'yard'};target=vehicleTarget(v);
   }
   // Fix source/target locations for the duration of a lift; once attached, cargo moves with spreader.
   if(!j.liftFrom){j.liftFrom={...from};j.liftTo={...target};}
   if(performLift(j,crane,j.liftFrom,j.liftTo,j.type)){
    j.order.pickedUpAt=t;
    if(j.order.cycleComparison){
     const comparison=j.order.cycleComparison;
     comparison.actualEmptyMeters=v.emptyMeters-comparison.emptyMetersAtEnd;
     comparison.savedMeters=comparison.unpairedGraphMeters-comparison.actualEmptyMeters;
     cycleMetrics.completed++;cycleMetrics.actualEmptyMeters+=comparison.actualEmptyMeters;
     cycleMetrics.unpairedGraphMeters+=comparison.unpairedGraphMeters;cycleMetrics.savedMeters+=comparison.savedMeters;
     log('DOUBLE_CYCLE_DISTANCE_CONFIRMED',{job:j.id,vehicle:v.id,...comparison});
    }
    log('PHYSICAL_PICKUP_COMPLETED',{job:j.id,vehicle:v.id});
    j.liftFrom=null;j.liftTo=null;
    if(j.type==='TRUCK_DELIVERY'){j.stage='COMPLETE';}
    else if(j.type==='TRUCK_PICKUP'){
     if(rtg.job===j.id){recordService(rtg,j);rtg.job=null;rtg.completed++;j.pickupCraneReleased=true;}
     v.queueBay=null;j.pickupBayReleased=true;
     log('CRANE_PICKUP_RELEASED',{crane:rtg.id,job:j.id,vehicle:v.id,container:c.id});
     j.stage='TO_GATE';setRoute(v,'gate');
    }
    else {
      // A completed physical pickup frees its pickup crane immediately.
      // The destination crane remains reserved for the real arriving container.
      // This allows STS and yard crane cycles to overlap with the AGV journey.
      if(j.type==='IMPORT' && qc?.job===j.id){
        recordService(qc,j);
        qc.job=null;stsSweeps.delete(qc.id);qc.completed++;j.pickupCraneReleased=true;
        log('CRANE_PICKUP_RELEASED',{crane:qc.id,job:j.id,container:c.id});
      }else if(j.type==='EXPORT' && rtg?.job===j.id){
        recordService(rtg,j);
        rtg.job=null;rtg.completed++;rtg.hook.y=24;j.pickupCraneReleased=true;
        // The physical body still protects the departing bay. Its logical
        // reservation must not last through the journey and ship stowage.
        v.queueBay=null;j.pickupBayReleased=true;
        log('TRANSFER_BAY_RELEASED',{job:j.id,vehicle:v.id,resource:rtg.id});
        log('CRANE_PICKUP_RELEASED',{crane:rtg.id,job:j.id,container:c.id});
      }
      j.stage='TO_DROPOFF';setRoute(v,j.type==='IMPORT'?'yard':'sts',j.type==='IMPORT'?{...rtg,dockZ:j.yardDockZ}:{...qc,dockZ:j.stsDockZ});
    }
   }
  }else if(j.stage==='TO_DROPOFF'&&v.state==='DOCKED'){
   if(j.type==='EXPORT'&&!alignedAtSTS(v,qc,j.stsDockZ)){requestTransferAlignment(j,qc);return;}
   j.order.deliveredAt=t;
   if(j.type==='EXPORT'){j.stsArrivedAt=t;j.order.stsArrivedAt=t;}
   log('DROPOFF_ARRIVED',{job:j.id,vehicle:v.id});j.stage='PLACE';
  }
  else if(j.stage==='PLACE'){
   let  crane, from, target; /* Crane participating in the current operation in tickJob() */ /* Local value for from in tickJob() */ /* Destination or target for this operation in tickJob() */
   if(j.type==='IMPORT'){if(!acquireTransferCrane(j,rtg))return;crane=rtg;from=vehicleTarget(v);target={...j.destination,carrier:'yard'};}
   else {if(!acquireTransferCrane(j,qc))return;crane=qc;from=vehicleTarget(v);target={...j.destination,carrier:'ship'};}
   if(!j.liftFrom){j.liftFrom={...from};j.liftTo={...target}}
   if(performLift(j,crane,j.liftFrom,j.liftTo,j.type)){j.liftFrom=null;j.liftTo=null;j.stage='COMPLETE'}
  }else if(j.stage==='TO_GATE'&&v.state==='DOCKED'){j.stage='COMPLETE';}
  if(j.stage==='COMPLETE'){
   if(j.type==='TRUCK_PICKUP'){c.site='EXITED';c.carrier=null;c.x=v.x;c.z=v.z;trace(c,'GATE_RELEASED',v.id);v.load=null;}
   if(j.type==='IMPORT'||j.type==='EXPORT'){
    /* Evaluates callback for vesselCalls.find using k */
    const  call=vesselCalls.find( k=>k.id===j.order.vesselCall); /* Vessel call being processed in tickJob() */
    /* Evaluates callback for (j.type==='IMPORT'?call?.discharge:call?.load)?.find using w */
    const  entry=(j.type==='IMPORT'?call?.discharge:call?.load)?.find( w=>w.container===c.id); /* Local value for entry in tickJob() */
    if(!entry||entry.state!=='IN_PROGRESS'||entry.order!==j.order.id){manifestViolations++;throw Error('Vessel manifest or duplicate work mismatch '+c.id)}
    entry.state='DONE';entry.completed=t;entry.order=j.order.id;
    log('VESSEL_WORK_CONFIRMED',{call:call.id,container:c.id,action:entry.action});
   }
   j.order.status='DONE';j.order.completed=t;liveOrders.delete(j.order);c.order=null;moveCount++;v.completed++;
   v.lastCompletedType=j.type;
   if(v.type==='agv'&&(j.type==='IMPORT'||j.type==='EXPORT'))v.lastCompletedVesselCall=j.order.vesselCall;
   if(v.type==='agv')v.lastTransportEnd={position:{x:v.x,z:v.z},emptyMeters:v.emptyMeters};
   if(v.type==='agv')log('AGV_NEXT_JOB_READY',{vehicle:v.id,at:{x:v.x,z:v.z},completedType:j.type});
   // Do not clear or count a crane after another job has legitimately
   // taken ownership following early pickup release.
   if(qc?.job===j.id){
    recordService(qc,j);qc.job=null;qc.completed++;
    // The AGV can leave as soon as the empty spreader has cleared its load.
    // The gantry's own return keeps the sweep until it reaches home.
   }
   if(rtg?.job===j.id){recordService(rtg,j);rtg.job=null;rtg.completed++;rtg.hook.y=24;}
   v.job=null;v.task=null;v.queueBay=null;v.stageBay=null;v.state='AVAILABLE';completeJob(j);
   // Real empty-trip minimization: assign the next container from the actual
   // TOS inventory at handoff completion. The AGV prepositions without a
   // mandatory return to the remote parking base.
   if(v.type==='agv' && makeAssignment(v)){
     log('AGV_DIRECT_REASSIGN',{vehicle:v.id,previousJob:j.id,nextOrder:v.pending});
     // A next-order assignment does not grant permission to occupy the old
     // yard crane dock indefinitely. If the next pickup cannot yet start,
     // physically leave the completed handoff bay via the ordinary return road.
     // Keep the real pending order: it can be activated after the slot is clear.
     if(v.pending&&!v.job&&!v.route.length&&!v.stageBay){
       v.state='RETURNING';setRoute(v,'parking');
       log('AGV_RELEASED_YARD_DOCK',{vehicle:v.id,nextOrder:v.pending});
     }
   }else{
     v.task={type:'RETURN_TO_BASE',status:'REPOSITIONING',container:null,order:null,assigned:t};
     v.state='RETURNING';setRoute(v,v.type==='agv'?'parking':'gate');
   }
   log('JOB_DONE',{job:j.id,type:j.type,container:c.id,vehicle:v.id});
  }
 }
 /* Handles move vehicle in the terminal simulation */
  function moveVehicle(v,dt,limit=Infinity){if(!v.route.length)return;const  next=v.route[v.routeIndex]; /* Next candidate or planned state in moveVehicle() */
  if(!next){v.route=[];v.routeIndex=0;v.state=v.truckYield?'TRUCK_YIELD':v.job?'DOCKED':v.type==='agv'?(v.pipelineJob?'STAGED':'PARKED'):'GATE';v.blockedTime=0;if(truckOwner===v.id)truckOwner=null;return;}
  const  from=point(v.x,v.z), d=dist(from,next); /* Local value for from in moveVehicle() */ /* Local value for d in moveVehicle() */
  if(d<.08){v.x=next.x;v.z=next.z;v.routeIndex++;return;}
  const reversing=v.type==='agv'&&(next.reverse||v.recovery?.reverse);
  const step=Math.min(d,limit,(v.truckYield?4:next.reverse?v.speed/3:v.speed)*dt), nx=v.x+(next.x-v.x)*step/d, nz=v.z+(next.z-v.z)*step/d; /* Local value for step in moveVehicle() */ /* Local value for nx in moveVehicle() */ /* Local value for nz in moveVehicle() */
  // Physical AGV separation. Parked AGVs remain in off-road pockets.
  let  obstruct=false; /* Local value for obstruct in moveVehicle() */
  for(const  other of v.type==='agv'?agvs:trucks){if(other===v)continue; /* Local value for other in moveVehicle() */
   const  clearance=v.type==='agv'?10.5:13; /* Local value for clearance in moveVehicle() */
   if(v.type==='agv'){
    const heading=reversing?v.heading:Math.atan2(next.z-v.z,next.x-v.x); /* Local value for heading in moveVehicle() */
    if(rectangularOverlap({x:nx,z:nz,heading},other)){obstruct=true;break}
   }else if(Math.hypot(nx-other.x,nz-other.z)<clearance){v.trafficBlock={reason:'VEHICLE_BODY',resource:other.id};obstruct=true;break}
  }
  if(obstruct){roadBlocked++;v.blocked++;v.blockedTime+=dt;return;}
  const  prevX=v.x, prevZ=v.z, oldHeading=v.heading;v.x=nx;v.z=nz;v.heading=v.truckYield||reversing?oldHeading:Math.atan2(nz-prevZ,nx-prevX); /* World-coordinate value for prev x */ /* World-coordinate value for prev z */ /* Local value for old heading in moveVehicle() */
  const order=v.type==='agv'?(jobsById.get(v.job||v.pipelineJob)?.order||ordersById.get(v.pending)):null;
  if(order&&order.departedAt==null&&step>.001){order.departedAt=t;log('AGV_MISSION_DEPARTED',{vehicle:v.id,order:order.id});}
  if(v.load){const  c=containers.get(v.load);c.x=nx;c.z=nz;c.y=v.type==='agv'?3.65:3.5;v.loadedMeters+=step} /* Current container or item being processed in moveVehicle() */
  else v.emptyMeters+=step;
  v.blockedTime=0;v.trafficBlock=null;
  if(step>=d-.001){v.x=next.x;v.z=next.z;v.routeIndex++}
 }
 // Safe concurrent route admission: routes may overlap only when vehicles are not in motion together.
 const  activePermits=new Set(), activeTruckPermits=new Set(); /* Unique values for active permits */ /* Unique values for active truck permits */
 // An admitted AGV must yield its route permit to a vehicle physically ahead
 // that needs to clear the shared junction; no vehicle passes through another.
 const  agvYieldFor=new Map(); /* Lookup table holding agv yield for */
 let  maxParallelAgvs=0, maxParallelTrucks=0; /* Local value for max parallel agvs in makeEngine() */ /* Local value for max parallel trucks in makeEngine() */
 /* Handles segment point distance in the terminal simulation */
  function segmentPointDistance(p,a,b){const  vx=b.x-a.x, vz=b.z-a.z; /* Local value for vx in segmentPointDistance() */ /* Local value for vz in segmentPointDistance() */
  const  t=(vx*vx+vz*vz)?Math.max(0,Math.min(1,((p.x-a.x)*vx+(p.z-a.z)*vz)/(vx*vx+vz*vz))):0; /* Elapsed simulation time in seconds */
  return Math.hypot(p.x-(a.x+vx*t),p.z-(a.z+vz*t));}
 /* Handles segment cross in the terminal simulation */
  function segmentCross(a,b,c,d){const  det=(b.x-a.x)*(d.z-c.z)-(b.z-a.z)*(d.x-c.x); /* Local value for det in segmentCross() */
  if(Math.abs(det)<1e-8)return false;
  const  t=((c.x-a.x)*(d.z-c.z)-(c.z-a.z)*(d.x-c.x))/det; /* Elapsed simulation time in seconds */
  const  u=((c.x-a.x)*(b.z-a.z)-(c.z-a.z)*(b.x-a.x))/det; /* Local value for u in segmentCross() */
  return t>=0&&t<=1&&u>=0&&u<=1;}
 // Cache full-route conflict decisions by route identity and current graph
 // edge, rather than recomputing thousands of segment comparisons per frame.
 // Use each complete current edge, not moving positions: conservative and safe.
 const  routeConflictCache=new Map(); /* Lookup table holding route conflict cache */
 /* Handles path conflict in the terminal simulation */
  function pathConflict(a,b){
  if(!a||!b||!a.route.length||!b.route.length)return false;
  const  [u,v]=a.id<b.id?[a,b]:[b,a]; /* Local value for [u,v] in pathConflict() */
  const  key=`${u.id}:${u.routeVersion||0}:${u.routeIndex}|${v.id}:${v.routeVersion||0}:${v.routeIndex}`; /* Local value for key in pathConflict() */
  if(routeConflictCache.has(key))return routeConflictCache.get(key);
  const  A=u.route.slice(Math.max(0,u.routeIndex-1)), B=v.route.slice(Math.max(0,v.routeIndex-1)); /* Local value for a in pathConflict() */ /* Local value for b in pathConflict() */
  let  conflict=false; /* Local value for conflict in pathConflict() */
  outer:for(let  i=1;i<A.length;i++)for(let  j=1;j<B.length;j++){ /* Loop index for the current collection in pathConflict() */ /* Loop index for the current nested collection in pathConflict() */
   const  aa=A[i-1], bb=A[i], cc=B[j-1], dd=B[j]; /* Local value for aa in pathConflict() */ /* Local value for bb in pathConflict() */ /* Local value for cc in pathConflict() */ /* Local value for dd in pathConflict() */
   const  pad=12.5; /* Local value for pad in pathConflict() */
   if(Math.max(aa.x,bb.x)+pad<Math.min(cc.x,dd.x)||
      Math.max(cc.x,dd.x)+pad<Math.min(aa.x,bb.x)||
      Math.max(aa.z,bb.z)+pad<Math.min(cc.z,dd.z)||
      Math.max(cc.z,dd.z)+pad<Math.min(aa.z,bb.z))continue;
   if(segmentCross(aa,bb,cc,dd)){conflict=true;break outer;}
   const  d=Math.min(segmentPointDistance(aa,cc,dd),segmentPointDistance(bb,cc,dd), /* Local value for d in pathConflict() */
       segmentPointDistance(cc,aa,bb),segmentPointDistance(dd,aa,bb));
   if(d<pad){conflict=true;break outer;}
  }
  if(routeConflictCache.size>16000)routeConflictCache.clear();
  routeConflictCache.set(key,conflict);
  return conflict;
 }
 let  rollingSectionGrants=0, rollingSectionReleases=0; let  minAgvClearance=Infinity, unsafeAgvProximity=0, unsafeAgvBodyOverlaps=0, loadedRouteWaitSeconds=0, emptyRouteWaitSeconds=0; /* Local value for rolling section grants in makeEngine() */ /* Local value for rolling section releases in makeEngine() */ /* Local value for min agv clearance in makeEngine() */ /* Local value for unsafe agv proximity in makeEngine() */ /* Local value for unsafe agv body overlaps in makeEngine() */ /* Local value for loaded route wait seconds in makeEngine() */ /* Local value for empty route wait seconds in makeEngine() */
 // NORMAL DRIVING FIRST: zero-radius pivot is an exceptional deadlock recovery
 // maneuver, never used for routine turns or ordinary crane approaches.
 // The whole swept footprint and exit remain subject to safety interlocks.
 // Unit scale: metres. 14 x 4.3 m body with a conservative safety envelope.
 const  PIVOT_SWEEP_RADIUS=Math.hypot(BODY_LONG,BODY_WIDE)+.65; /* Local value for pivot sweep radius in makeEngine() */
 const STOP_LINE=TRAVEL_PITCH/2;
 const JUNCTION_CLEARANCE=PIVOT_SWEEP_RADIUS+BODY_LONG+.1;
 if(STOP_LINE<=JUNCTION_CLEARANCE)throw Error('AGV stop line intersects a junction sweep');
 const  PIVOT_ANGULAR_SPEED=.58; // radians per simulated second /* Local value for pivot angular speed in makeEngine() */
 let  pivotStarted=0, pivotCompleted=0, pivotDenied=0, pivotSeconds=0; /* Local value for pivot started in makeEngine() */ /* Local value for pivot completed in makeEngine() */ /* Local value for pivot denied in makeEngine() */ /* Local value for pivot seconds in makeEngine() */
 const  turnDelta=(target,current)=>Math.atan2(Math.sin(target-current),Math.cos(target-current)); /* Computes turn delta for the current simulation operation */
 /* Handles circle intersects vehicle in the terminal simulation */
  function circleIntersectsVehicle(cx,cz,r,other){
   const  a=other.heading||0, dx=cx-other.x, dz=cz-other.z; /* First item being compared in circleIntersectsVehicle() */ /* Local value for dx in circleIntersectsVehicle() */ /* Local value for dz in circleIntersectsVehicle() */
   const  localX=Math.cos(a)*dx+Math.sin(a)*dz; /* World-coordinate value for local x */
   const  localZ=-Math.sin(a)*dx+Math.cos(a)*dz; /* World-coordinate value for local z */
   const  nearX=Math.max(Math.abs(localX)-7.5,0); /* World-coordinate value for near x */
   const  nearZ=Math.max(Math.abs(localZ)-2.65,0); /* World-coordinate value for near z */
   return nearX*nearX+nearZ*nearZ<(r+.08)*(r+.08);
 }
 /* Handles pivot envelope clear in the terminal simulation */
  function pivotEnvelopeClear(v){
   if(v.load||v.state==='DOCKED'&&!v.pivot?.alignment||v.state==='CRANE_HANDLING')return false;
   /* Evaluates callback for agvs.some using o */
   return !agvs.some( o=>o!==v&&circleIntersectsVehicle(v.x,v.z,PIVOT_SWEEP_RADIUS,o));
 }

 // Approximate each real AGV as a 14 m × 4.3 m oriented footprint.
 // Safety envelopes include a small extra clearance around the chassis.
 /* Handles rectangular overlap in the terminal simulation */
  function rectangularOverlap(a,b){
   const  dx=Math.abs(a.x-b.x), dz=Math.abs(a.z-b.z); /* Local value for dx in rectangularOverlap() */ /* Local value for dz in rectangularOverlap() */
   // Broadphase: the inflated footprint cannot exceed 15 m on either axis.
   if(dx>=2*BODY_LONG||dz>=2*BODY_LONG)return false;
   const  ba=bodyBounds(a.heading), bb=bodyBounds(b.heading); /* Local value for ba in rectangularOverlap() */ /* Local value for bb in rectangularOverlap() */
   return dx<ba.hx+bb.hx && dz<ba.hz+bb.hz;
 }
 // Bounded escape for an empty AGV in a measured wait-for cycle. The
 // vehicle follows an existing adjacent graph edge under normal traffic guards.
 function reverseTruckRoute(v){return simplify([point(v.x,v.z),...v.route.slice(0,v.routeIndex).reverse().map(clone)]);}
 function blockerAlongLeg(v,from,to,{heading=Math.atan2(to.z-from.z,to.x-from.x),turn=false,length=dist(from,to)}={}){
  const direction=Math.atan2(to.z-from.z,to.x-from.x);
  const dx=Math.cos(direction),dz=Math.sin(direction);
  return agvs.find(other=>{
   if(other===v)return false;
   if(turn&&circleIntersectsVehicle(to.x,to.z,PIVOT_SWEEP_RADIUS,other))return true;
   const along=Math.max(0,Math.min(length,(other.x-from.x)*dx+(other.z-from.z)*dz));
   return rectangularOverlap({x:from.x+along*dx,z:from.z+along*dz,heading},other);
  });
 }
 function exitBlocker(v,from,to){
  const length=dist(from,to);
  const hold=length>=TRAVEL_PITCH?length-STOP_LINE:length;
  return blockerAlongLeg(v,from,to,{length:hold});
 }
 function planEscape(v){
  if(v.load)return null;
  const key=gKey(v.x,v.z),next=v.route[v.routeIndex];
  const previous=v.route.slice(0,v.routeIndex).reverse().find(p=>dist(p,v)>.15);
  const traversed=previous&&(AGV_GRID.edges.get(gKey(previous.x,previous.z))||[]).some(e=>e.to===key)?previous:null;
  const neighbors=(AGV_GRID.edges.get(key)||[]).map(edge=>AGV_GRID.nodes.get(edge.to));
  // A directed yard connector can have no alternative outgoing edge. An
  // empty AGV may retreat along the edge it actually traversed, with normal
  // pivot, body and section guards, just as on the parking connector.
  if(traversed&&!neighbors.some(n=>dist(n,traversed)<.1))neighbors.push(traversed);
  const candidates=neighbors.filter(n=>{
   const d=Math.hypot(n.x-v.x,n.z-v.z);const edge=gridEdge(v,n);
   if(d<1||d>20&&n!==traversed&&!edge?.section.travel||next&&gKey(n.x,n.z)===gKey(next.x,next.z))return false;
   const heading=Math.atan2(n.z-v.z,n.x-v.x);
   return !blockerAlongLeg(v,v,n,{heading})&&!agvs.some(o=>{
    if(o===v)return false;
    const next=o.route[o.routeIndex];
    // Do not escape into the approach of another moving vehicle. Its body
    // may be clear now while its next section already converges on this node.
    return next&&dist(o,n)<35&&dist(next,n)<dist(o,n)&&
     Math.abs((o.x-n.x)*Math.sin(heading)-(o.z-n.z)*Math.cos(heading))<6;
   });
  });
  candidates.sort((a,b)=>Math.abs(turnDelta(Math.atan2(a.z-v.z,a.x-v.x),v.heading))-Math.abs(turnDelta(Math.atan2(b.z-v.z,b.x-v.x),v.heading))||gKey(a.x,a.z).localeCompare(gKey(b.x,b.z)));
  return candidates[0]||null;
 }
 /* Advances simulation physics, dispatch, traffic, vessel calls, and KPIs */
  function tick(dt=1/30){if(!started)return;let  n=Math.min(6,Math.max(1,Math.ceil(dt/(1/30))));const  h=Math.min(.05,dt/n); /* Current counter, result, or node in this calculation in tick() */ /* Local value for h in tick() */
  for(let  k=0;k<n;k++){ /* Current loop key or index in tick() */
   t+=h;tickVessels(h);
   for(let  i=0;i<L.yards.length;i++){ /* Loop index for the current collection in tick() */
    const  a=rtgAgv[i], b=rtgTruck[i]; /* First item being compared in tick() */ /* Second item being compared in tick() */
    if(b.x-a.x<YARD_RAIL_GAP-.001 || !craneReachable(a,a.x) || !craneReachable(b,b.x)){
     const  message='RTG RAIL INTERLOCK '+L.yards[i].id+' '+a.id+' / '+b.id; /* Local value for message in tick() */
     yardCraneIncidents.push({time:t,message,agvX:a.x,truckX:b.x});
     log('RTG_RAIL_VIOLATION',{message});started=false;return;
    }
   }
   if(t-lastDispatch>.2){lastDispatch=t;dispatch()}
   // Independent AGV and truck routes can move concurrently. Conflicting
   // routes receive permits sequentially; crane exits take precedence.
   /* Evaluates callback for agvs.filter using v */
   const travelAgvs=agvs.filter(v=>v.route.length||v.pivot);
   /* Evaluates callback for trucks.filter using v */
   const  travelTrucks=trucks.filter( v=>v.route.length); /* Local value for travel trucks in tick() */
   // Conservatively reserve an entire active journey until its current target.
   // Independent routes can execute in parallel; crossing paths are sequenced.
   const  admit=(vehicles,permits,cap)=>{ /* Computes admit for the current simulation operation */
    /* Evaluates callback for vehicles.some using v */
    for(const  id of [...permits])if(!vehicles.some( v=>v.id===id))permits.delete(id); /* Identifier of the selected entity in admit() */
    /* Evaluates callback for vehicles.filter using v */
    /* Evaluates callback for vehicles.filter(v=>!permits.has(v.id)).sort using a, b */
    const  candidates=vehicles.filter( v=>!permits.has(v.id)).sort( (a,b)=> /* Flag indicating whether candidates */
      Number(b.state==='RETURNING')-Number(a.state==='RETURNING') ||
      Number(b.blockedTime>1)-Number(a.blockedTime>1) ||
      a.id.localeCompare(b.id));
    for(const  candidate of candidates){ /* Item currently being evaluated for eligibility in admit() */
     if(permits.size>=cap)break;
     /* Evaluates callback for [...permits].some using id */
     /* Evaluates callback for vehicles.find using v */
     if([...permits].some( id=>pathConflict(candidate,vehicles.find( v=>v.id===id))))continue;
     permits.add(candidate.id);
    }
    // A journey permit cannot imprison a vehicle physically ahead of its
    // holder. Transfer authority to that blocker, retaining body guards.
    for(const id of [...permits]){
     const holder=vehicles.find(v=>v.id===id),next=holder?.route[holder.routeIndex];
     if(!next||(holder.blockedTime||0)<1)continue;
     const d=Math.hypot(next.x-holder.x,next.z-holder.z);if(d<.001)continue;
     const step=Math.min(d,holder.speed*h),nx=holder.x+(next.x-holder.x)*step/d,nz=holder.z+(next.z-holder.z)*step/d;
     const blocker=vehicles.find(o=>o!==holder&&o.route.length&&Math.hypot(nx-o.x,nz-o.z)<13);
     if(!blocker||permits.has(blocker.id))continue;
     for(const other of [...permits])if(pathConflict(blocker,vehicles.find(v=>v.id===other)))permits.delete(other);
     permits.add(blocker.id);log('TRUCK_PERMIT_TRANSFER',{vehicle:holder.id,blockingResourceId:blocker.id,toState:'YIELDING_JOURNEY_PERMIT'});
    }
    for(const v of vehicles)if(!permits.has(v.id)){
     v.blockedTime+=h;
     const owner=[...permits].map(id=>vehicles.find(o=>o.id===id)).find(o=>pathConflict(v,o));
     v.trafficBlock={reason:'TRUCK_JOURNEY_PERMIT',resource:owner?.id||null};
    }
    for(const  id of [...permits]){ /* Identifier of the selected entity in admit() */
     /* Evaluates callback for vehicles.find using v */
     const  v=vehicles.find( v=>v.id===id); /* Current vehicle or value being processed in admit() */
     if(v){moveVehicle(v,h);if(!v.route.length)permits.delete(id)}
    }
   };
   activePermits.clear();
   const vehiclesOnRoutes=travelAgvs;
   const getEdge=sectionKey;
   const roadOccupied=new Map();
   const claim=(id,vehicle)=>{if(!roadOccupied.has(id))roadOccupied.set(id,vehicle);};
   for(const v of vehiclesOnRoutes){
    const dest=v.route[v.routeIndex], old=v.route[v.routeIndex-1];
    if(!dest||!old)continue;
    // A parked chassis presents a body obstacle, not an advance reservation.
    if(dist(old,v)>.01)claim(getEdge(old,dest),v.id);
    const previous=v.route[v.routeIndex-2];
    if(previous&&dist(old,v)<BODY_LONG)claim(getEdge(previous,old),v.id);
   }
   for(const [id,permit] of serviceReservations){
    const owner=travelAgvs.find(v=>v.id===permit.vehicleId);
    if(!owner||owner.routeVersion!==permit.version||!owner.route[owner.routeIndex]||
      (owner.routeIndex===permit.end+1&&dist(owner,owner.route[permit.end])>=JUNCTION_CLEARANCE)||
      owner.routeIndex>permit.end+1){
     serviceReservations.delete(id);
     log('SERVICE_AREA_RELEASED',{vehicle:permit.vehicleId,routeOrReservationId:id});
    }else if(permit.exit)claim(permit.exit,owner.id);
   }
   for(const zone of turnReservations.values()){
    const owner=travelAgvs.find(v=>v.id===zone.vehicleId);
    if(zone.exit&&owner?.routeVersion===zone.version&&owner.routeIndex<=zone.index)claim(zone.exit,owner.id);
   }
   // Only after 9 seconds of persistent obstruction by loaded traffic;
   // all ordinary motion uses normal wheel-directed driving.
   // Controlled deadlock recovery: an empty AGV whose next junction is
   // occupied by a loaded AGV may reverse to its previously traversed graph
   // node. This is an actual collision-checked vehicle movement, not a jump.
   for(const  v of vehiclesOnRoutes){ /* Current vehicle or value being processed in tick() */
    if(v.recovery&&!v.load&&(v.blockedTime||0)>9){
     const origin=v.route[0],next=v.route[v.routeIndex];
     if(origin&&dist(v,origin)<.15){
      const intent=v.recovery.intent;v.recovery=null;v.nextReplanAt=t+6;
      setRoute(v,intent.type,intent.crane);
      log('AGV_ESCAPE_ABORTED',{vehicle:v.id,to:origin,blockingResourceId:v.trafficBlock?.resource||null});
      continue;
     }
     if(origin&&next&&dist(v,origin)>.15){
      const heading=Math.atan2(origin.z-v.z,origin.x-v.x),step=Math.min(.5,dist(v,origin));
      if(!agvs.some(o=>o!==v&&rectangularOverlap({x:v.x+Math.cos(heading)*step,z:v.z+Math.sin(heading)*step,heading:v.heading},o))){
       v.avoidNode={key:gKey(next.x,next.z),until:t+120};
       v.recovery={intent:v.recovery.intent,reverse:true};v.recoveryToken=t;
       v.route=[point(v.x,v.z),clone(origin)];v.routeIndex=1;v.routeVersion++;v.blockedTime=0;
       log('AGV_ESCAPE_ABORTED',{vehicle:v.id,to:origin,blockingResourceId:v.trafficBlock?.resource||null});
      }
     }
    }
    if(v.recovery||!v.routeIntent||(v.blockedTime||0)<9||v.load||
     [...serviceReservations.values()].some(permit=>permit.vehicleId===v.id))continue;
    const  next=v.route[v.routeIndex], prev=v.route[v.routeIndex-1]; /* Next candidate or planned state in tick() */ /* Previous state, item, or location in tick() */
    if(!next||!prev)continue;
    if(gridEdge(prev,next)?.section.travel&&dist(v,next)>=STOP_LINE-.01&&dist(v,prev)>JUNCTION_CLEARANCE)continue;
    const  movementAngle=Math.atan2(next.z-v.z,next.x-v.x); /* Local value for movement angle in tick() */
    /* Evaluates callback for agvs.some using o */
    const approaching=agvs.filter(o=>o!==v&&o.route.length&&(o.blockedTime||0)>4&&
      Math.hypot(o.x-v.x,o.z-v.z)<48&&
      (o.load||v.id<o.id||(()=>{
       const target=o.route[o.routeIndex];if(!target)return false;
       const direction=Math.atan2(target.z-o.z,target.x-o.x);
       return Math.cos(direction-movementAngle)>.9&&
        Math.abs((o.x-v.x)*Math.sin(movementAngle)-(o.z-v.z)*Math.cos(movementAngle))<6;
      })())&&
      ((o.x-v.x)*Math.cos(movementAngle)+(o.z-v.z)*Math.sin(movementAngle)>2))
      .sort((a,b)=>dist(v,a)-dist(v,b))[0];
    if(!approaching)continue;
    const minimumBackoff=Math.max(.15,PIVOT_SWEEP_RADIUS+BODY_LONG+.1-dist(v,approaching));
    const retreat=[];
    const reverseAngle=Math.atan2(prev.z-v.z,prev.x-v.x);
    for(const node of v.route.slice(0,v.routeIndex).reverse()){
     if(dist(node,v)<.15)continue;
     if(Math.abs((node.x-v.x)*Math.sin(reverseAngle)-(node.z-v.z)*Math.cos(reverseAngle))>.1)break;
     retreat.push(node);if(dist(node,v)>=minimumBackoff)break;
    }
    // A follower may have turned less than a metre ago. Its traversed
    // straight prefix is then too short to clear a leading turn. Extend
    // the empty reverse onto adjacent real graph sections, under the same
    // exclusive section/body guards, rather than backing sideways.
    for(let extra=0;extra<2&&retreat.length&&dist(retreat.at(-1),v)<minimumBackoff;extra++){
     const end=retreat.at(-1),key=gKey(end.x,end.z),neighbors=[];
     for(const [id,edges] of AGV_GRID.edges)if(edges.some(e=>e.to===key)){
      const node=AGV_GRID.nodes.get(id),dx=node.x-end.x,dz=node.z-end.z;
      if(dx*Math.cos(reverseAngle)+dz*Math.sin(reverseAngle)>.1&&
       Math.abs(dx*Math.sin(reverseAngle)-dz*Math.cos(reverseAngle))<.1&&dist(end,node)<=20)neighbors.push(node);
     }
     neighbors.sort((a,b)=>dist(end,a)-dist(end,b));if(!neighbors.length)break;
     retreat.push(neighbors[0]);
    }
    const back=retreat.at(-1)||prev;
    const backDist=Math.hypot(v.x-back.x,v.z-back.z);
    // Parking connector edges exceed 50 m. Distance alone cannot deny
    // reversal along an already traversed edge; every step remains guarded.
    if(backDist<.15)continue;
    const heading=Math.atan2(back.z-v.z,back.x-v.x);
    if(Math.abs(Math.sin(heading-v.heading))>.035)continue; // Never reverse sideways.
    const  px=v.x+Math.cos(heading)*Math.min(2,backDist), pz=v.z+Math.sin(heading)*Math.min(2,backDist); /* Local value for px in tick() */ /* Local value for pz in tick() */
    /* Evaluates callback for agvs.some using o */
    if(agvs.some( o=>o!==v&&rectangularOverlap({x:px,z:pz,heading:v.heading},o)))continue;
    // Normal reverse driving is preferred: no instantaneous 180 degree turn.
    // Keep the chassis heading fixed; the AGV backs to its previous graph node.
    v.recovery={intent:v.routeIntent,reverse:true};v.recoveryToken=t;
    v.avoidNode={key:gKey(next.x,next.z),until:t+120};
    v.route=[point(v.x,v.z),...retreat.map(clone)];
    v.routeIndex=1;v.routeVersion=(v.routeVersion||0)+1;v.blockedTime=0;
    log('AGV_PHYSICAL_YIELD',{agv:v.id,x:back.x,z:back.z,contested:v.avoidNode.key,mode:'NORMAL_REVERSE'});
   }
   // Reserve complete swept footprints before authorizing ANY road movement.
   // In a reservation tick, pivots have priority over an approaching vehicle;
   // vehicles outside the circle continue using independent intersections.
   const  reservedPivots=[]; /* Collection of reserved pivots */
   for(const [key,zone] of turnReservations){
    const owner=agvs.find(v=>v.id===zone.vehicleId);
    if(!owner?.route.length||owner.routeVersion!==zone.version||owner.routeIndex>zone.index&&dist(owner,zone)>JUNCTION_CLEARANCE){
     turnReservations.delete(key);log('TURN_RELEASED',{job:zone.jobId,vehicle:zone.vehicleId,routeOrReservationId:key});
    }
   }
   for(const  v of vehiclesOnRoutes){ /* Current vehicle or value being processed in tick() */
    if(!v.pivot)continue;
    const  p=v.pivot; /* Current position, route, or temporary calculation value in tick() */
    if(!p.started){
     /* Evaluates callback for reservedPivots.some using o */
     if(!pivotEnvelopeClear(v)||reservedPivots.some( o=>Math.hypot(o.x-v.x,o.z-v.z)<2*PIVOT_SWEEP_RADIUS)||
      [...turnReservations.values()].some(zone=>zone.vehicleId!==v.id&&dist(zone,v)<2*PIVOT_SWEEP_RADIUS)){
      pivotDenied++;v.blockedTime+=h;continue;
     }
     const  next=v.route[v.routeIndex]; /* Next candidate or planned state in tick() */
     if(next){
      const  angle=Math.atan2(next.z-v.z,next.x-v.x), d=Math.hypot(next.x-v.x,next.z-v.z); /* Local value for angle in tick() */ /* Local value for d in tick() */
      const  px=v.x+Math.cos(angle)*Math.min(3,d), pz=v.z+Math.sin(angle)*Math.min(3,d); /* Local value for px in tick() */ /* Local value for pz in tick() */
      /* Evaluates callback for agvs.some using o */
      if(agvs.some( o=>o!==v&&rectangularOverlap({x:px,z:pz,heading:angle},o))){pivotDenied++;v.blockedTime+=h;continue;}
     }
     p.started=true;pivotStarted++;log('AGV_PIVOT_STARTED',{agv:v.id,target:p.target,x:v.x,z:v.z});
    }
    reservedPivots.push(v);
    const  remaining=turnDelta(p.target,v.heading); /* Local value for remaining in tick() */
    const  delta=Math.sign(remaining)*Math.min(Math.abs(remaining),h*PIVOT_ANGULAR_SPEED); /* Local value for delta in tick() */
    v.heading+=delta;pivotSeconds+=h;v.blockedTime=0;
    // A turning AGV remains fixed at exactly the same x/z, retaining its load.
    if(Math.abs(turnDelta(p.target,v.heading))<1e-4){
     v.heading=p.target;v.pivot=null;pivotCompleted++;
     log('AGV_PIVOT_COMPLETE',{agv:v.id,x:v.x,z:v.z});
    }
   }
   /* Evaluates callback for vehiclesOnRoutes.slice().sort using a, b */
   const  candidates=vehiclesOnRoutes.slice().sort( (a,b)=> /* Flag indicating whether candidates */
     Number(!!b.load)-Number(!!a.load)||
     Number(b.state==='TRAVEL'&&b.job!==null)-Number(a.state==='TRAVEL'&&a.job!==null)||
     (b.blockedTime||0)-(a.blockedTime||0)||a.id.localeCompare(b.id));
   for(const  v of candidates){ /* Current vehicle or value being processed in tick() */
    // The body cannot translate during a pivot, or before it can acquire
    // a swept-envelope reservation.
    v.trafficBlock=null;
    if(v.pivot||reservedPivots.includes(v)){v.trafficBlock={reason:'PIVOT_ENVELOPE',resource:v.id};continue;}
    const  next=v.route[v.routeIndex]; /* Next candidate or planned state in tick() */
    if(!next){moveVehicle(v,h);continue;}
    const  old=v.route[Math.max(0,v.routeIndex-1)]||point(v.x,v.z); /* Local value for old in tick() */
    const  section=getEdge(old,next); /* Local value for section in tick() */
    const occupiedBy=roadOccupied.get(section);
    if(occupiedBy&&occupiedBy!==v.id){
     v.trafficBlock={reason:'ROAD_SECTION',resource:occupiedBy,section};v.blockedTime+=h;continue;
    }
    const edge=gridEdge(old,next);
    const after=v.route[v.routeIndex+1];
    const nextEdge=after&&gridEdge(next,after);
    const d=dist(v,next);
    const angle=d>.001?Math.atan2(next.z-v.z,next.x-v.x):v.heading;
    const reversing=next.reverse||v.recovery?.reverse;
    const collisionHeading=reversing?v.heading:angle;
    const requestedStep=Math.min(d,h*(next.reverse?v.speed/3:v.speed));
    const checksAhead=!!after&&d<=STOP_LINE+.00001;
    // Advance right up to the stop line. A discrete simulation step must
    // never carry an unpermitted vehicle across it.
    const limit=edge?.section.travel&&after&&!checksAhead?d-STOP_LINE:Infinity;
    const step=Math.min(requestedStep,limit);
    const nx=v.x+Math.cos(angle)*step, nz=v.z+Math.sin(angle)*step;
    let pendingService=null;
    const area=edge?.section.area||(checksAhead&&nextEdge?.section.area);
    if(area){
     const permit=serviceReservations.get(area);
     if(permit&&permit.vehicleId!==v.id){
      v.trafficBlock={reason:'SERVICE_AREA',resource:permit.vehicleId,section:area};v.blockedTime+=h;continue;
     }
     if(!permit){
      let end=edge?.section.area===area?v.routeIndex:v.routeIndex+1;
      while(v.route[end+1]&&gridEdge(v.route[end],v.route[end+1])?.section.area===area)end++;
      const exit=v.route[end+1]&&getEdge(v.route[end],v.route[end+1]);
      const exitOwner=exit&&roadOccupied.get(exit);
      if(exitOwner&&exitOwner!==v.id){
       v.trafficBlock={reason:'SERVICE_AREA_EXIT',resource:exitOwner,section:exit};v.blockedTime+=h;continue;
      }
      // Check the full path through the protected area before leaving safe
      // waiting space. A docked neighbor can stay in its adjacent spur.
      const first=edge?.section.area===area?v.routeIndex:v.routeIndex+1;
      let blocker=null;
      for(let i=first;i<=end&&!blocker;i++){
       const from=v.route[i-1],to=v.route[i],following=v.route[i+1];
       const heading=Math.atan2(to.z-from.z,to.x-from.x)+(to.reverse?Math.PI:0);
       const turn=following&&Math.abs(turnDelta(Math.atan2(following.z-to.z,following.x-to.x),heading))>.035;
       blocker=blockerAlongLeg(v,from,to,{heading,turn});
      }
      if(!blocker&&exit)blocker=exitBlocker(v,v.route[end],v.route[end+1]);
      if(blocker){
       v.trafficBlock={reason:'SERVICE_AREA_BODY',resource:blocker.id,section:area};v.blockedTime+=h;continue;
      }
      pendingService={vehicleId:v.id,version:v.routeVersion,end,exit};
     }
    }
    const reservedTurn=[...turnReservations.values()].find(zone=>zone.vehicleId!==v.id&&
     circleIntersectsVehicle(zone.x,zone.z,PIVOT_SWEEP_RADIUS,{x:nx,z:nz,heading:collisionHeading}));
    if(reservedTurn){v.trafficBlock={reason:'TURN_RESERVATION',resource:reservedTurn.vehicleId,section};v.blockedTime+=h;continue;}
    if(!reversing){
     const following=agvs.find(other=>{
      if(other===v)return false;
      const target=other.route[other.routeIndex];if(!target)return false;
      const planned=Math.atan2(target.z-other.z,target.x-other.x);
      const ahead=(other.x-nx)*Math.cos(angle)+(other.z-nz)*Math.sin(angle);
      const lateral=Math.abs((other.x-nx)*Math.sin(angle)-(other.z-nz)*Math.cos(angle));
      return Math.cos(planned-angle)>.9&&lateral<2*BODY_WIDE+.1&&ahead>0&&ahead<PIVOT_SWEEP_RADIUS+BODY_LONG+.1;
     });
     if(following){v.trafficBlock={reason:'FOLLOWING_TURN_CLEARANCE',resource:following.id,section};v.blockedTime+=h;continue;}
    }
    let pendingTurn=null;
    // No stopping inside a graph intersection: reserve the downstream exit
    // before the chassis enters the conflict zone.
    let  exitClear=true; /* Local value for exit clear in tick() */
    if(checksAhead){
     const exitHeading=Math.atan2(after.z-next.z,after.x-next.x);
     const turning=Math.abs(turnDelta(exitHeading,collisionHeading))>.035;
     const protect=turning||edge?.section.travel||nextEdge?.section.travel;
     const exitKey=getEdge(next,after);
     const zoneKey=v.id+':'+v.routeVersion+':'+v.routeIndex;
     const competingTurn=protect?[...turnReservations.values()].find(zone=>zone.vehicleId!==v.id&&dist(zone,next)<2*PIVOT_SWEEP_RADIUS):null;
     if(competingTurn){v.trafficBlock={reason:'TURN_RESERVATION',resource:competingTurn.vehicleId,section};v.blockedTime+=h;continue;}
     const turnBlocker=protect?
      agvs.find(o=>o!==v&&circleIntersectsVehicle(next.x,next.z,PIVOT_SWEEP_RADIUS,o)):null;
     if(turnBlocker){
      v.trafficBlock={reason:'TURN_SWEEP_APPROACH',resource:turnBlocker.id,section};v.blockedTime+=h;continue;
     }
     if(protect&&!turnReservations.has(zoneKey)){
      if(reservedPivots.some(other=>other!==v&&dist(other,next)<2*PIVOT_SWEEP_RADIUS)){v.blockedTime+=h;continue;}
      pendingTurn={key:zoneKey,vehicleId:v.id,jobId:v.job||v.pipelineJob||null,x:next.x,z:next.z,index:v.routeIndex,version:v.routeVersion,exit:exitKey};
     }
     const owner=roadOccupied.get(exitKey); /* Local value for exit key in tick() */ /* Local value for owner in tick() */
     if(owner&&owner!==v.id){exitClear=false;v.trafficBlock={reason:'DOWNSTREAM_SECTION',resource:owner,section:exitKey};}
     const blocker=exitBlocker(v,next,after);
     if(blocker){exitClear=false;v.trafficBlock={reason:'JUNCTION_EXIT_BODY',resource:blocker.id,section:exitKey};}
     // Do not claim a downstream section until the chassis actually advances.
     // An earlier version leaked phantom ownership when a later body check failed.
    }
    if(!exitClear){v.blockedTime+=h;continue;}
    // A translating AGV may not enter the reserved rotation circle.
    /* Evaluates callback for reservedPivots.some using o */
    if(reservedPivots.some( o=>o!==v&&circleIntersectsVehicle(o.x,o.z,PIVOT_SWEEP_RADIUS,{x:nx,z:nz,heading:collisionHeading}))){
      v.blockedTime+=h;continue;
    }
    // Actual full-rectangle collision guard independent of reservations.
    /* Evaluates callback for agvs.some using o */
    const bodyBlocker=agvs.find(o=>o!==v&&rectangularOverlap({x:nx,z:nz,heading:collisionHeading},o));
    if(bodyBlocker){
      v.trafficBlock={reason:'VEHICLE_BODY',resource:bodyBlocker.id,section};v.blockedTime+=h;continue;
    }
    const oldIndex=v.routeIndex, oldPosition=point(v.x,v.z);
    moveVehicle(v,h,limit);
    if(v.routeIndex>oldIndex&&edge?.zone==='QUAY_TRANSFER_LINK')
     log('QUAY_TRANSFER_LINK_TRAVERSED',{vehicle:v.id,berth:edge.section.berth+1,routeOrReservationId:edge.section.id});
    if(dist(v,oldPosition)>.001||v.routeIndex!==oldIndex){
     claim(section,v.id);
     if(checksAhead)claim(getEdge(next,after),v.id);
     if(pendingService){
      serviceReservations.set(area,pendingService);
      if(pendingService.exit)claim(pendingService.exit,v.id);
      log('SERVICE_AREA_RESERVED',{vehicle:v.id,routeOrReservationId:area});
     }
     if(pendingTurn){
      turnReservations.set(pendingTurn.key,pendingTurn);
      log('TURN_RESERVED',{job:pendingTurn.jobId,vehicle:v.id,routeOrReservationId:pendingTurn.key,x:next.x,z:next.z});
     }
    }
    if(Math.hypot(v.x-nx,v.z-nz)<.1&&step>.001){
     activePermits.add(v.id);rollingSectionGrants++;rollingSectionReleases++;
    }
   }
   // Avoid stale reservations and allow every vehicle to reattempt on the
   // next fixed simulation tick. An AGV never holds an entire route token.
   for(const  v of travelAgvs){ /* Current vehicle or value being processed in tick() */
    if(activePermits.has(v.id)||!v.routeIntent||v.recovery||v.pivot||
      [...serviceReservations.values()].some(permit=>permit.vehicleId===v.id))continue;
    /* Evaluates callback for [...AGV_GRID.nodes.values()].some using n */
    if((v.blockedTime||0)<=3||t<(v.nextReplanAt||0)||v.x<-330)continue;
    const nearNode=[...AGV_GRID.nodes.values()].some(n=>Math.hypot(n.x-v.x,n.z-v.z)<.12); /* Local value for near node in tick() */
    if(nearNode&&(v.blockedTime||0)>3&&t>=(v.nextReplanAt||0)){
      v.nextReplanAt=t+6;v.recoveryToken=t;
      const cycle=monitor.snapshot().cycles.find(ids=>ids.includes(v.id));
      if((cycle||(v.blockedTime||0)>30)&&!v.load){
       if(v.escapeCompleted!==v.completed){v.escapeCompleted=v.completed;v.escapeAttempts=0;}
       const escape=(v.escapeAttempts||0)<3?planEscape(v):null;
       if(escape){
        const contested=v.route[v.routeIndex];
        if(contested)v.avoidNode={key:gKey(contested.x,contested.z),until:t+120};
        v.escapeAttempts=(v.escapeAttempts||0)+1;v.recovery={intent:v.routeIntent,escape:true};
        v.route=[point(v.x,v.z),point(escape.x,escape.z)];v.routeIndex=1;v.routeVersion++;v.blockedTime=0;
        log('AGV_CYCLE_ESCAPE',{vehicle:v.id,cycle,to:escape,attempt:v.escapeAttempts});continue;
       }
      }
      const  oldRoute=v.route, oldIndex=v.routeIndex; /* Local value for old route in tick() */ /* Local value for old index in tick() */
      try{
       const  replacement=routeAGV(v,v.routeIntent.type,v.routeIntent.crane); /* Local value for replacement in tick() */
       if(replacement.length>1){
        const  before=v.route[v.routeIndex], after=replacement[1]; /* Local value for before in tick() */ /* Local value for after in tick() */
        if(!before||!after||gKey(before.x,before.z)!==gKey(after.x,after.z)){
         v.route=replacement;v.routeIndex=1;v.routeVersion++;v.blockedTime=0;
         log('AGV_CONFLICT_REROUTE',{agv:v.id,from:before?gKey(before.x,before.z):null,to:gKey(after.x,after.z)});
        }else v.nextReplanAt=t+3;
       }
      }catch( e){v.route=oldRoute;v.routeIndex=oldIndex;} /* Local value for e in tick() */
    }
   }
   for(const  v of agvs){ /* Current vehicle or value being processed in tick() */
    if(!v.recovery||v.route.length)continue;
    const  intent=v.recovery.intent; /* Local value for intent in tick() */
    v.recovery=null;
    try{setRoute(v,intent.type,intent.crane);log('AGV_YIELD_REPLANNED',{agv:v.id,intent:intent.type})}
    catch( e){log('AGV_YIELD_REPLAN_FAILED',{agv:v.id,error:String(e)});} /* Local value for e in tick() */
   }
   // Audit actual loaded-route delays separately from crane handling time.
   // An AGV has a route only after physical pickup; waiting is not counted as motion.
   for(const  v of travelAgvs){ /* Current vehicle or value being processed in tick() */
     if(!activePermits.has(v.id)){
       if(v.load)loadedRouteWaitSeconds+=h;
       else emptyRouteWaitSeconds+=h;
     }
   }
   // Gate-side E2 queue: if an inbound truck and an outbound truck block
   // each other at the shared apron, the inbound truck physically reverses
   // to its original external gate position. Its container and job stay bound.
   // It does not stop in any AGV lane or claim a new yard holding pocket.
   for(const  v of trucks){ /* Current vehicle or value being processed in tick() */
    if(v.truckYield&&!v.route.length){
     /* Evaluates callback for trucks.find using o */
     const  owner=trucks.find( o=>o.id===v.truckYield.opponent); /* Local value for owner in tick() */
     if(!owner||owner.state==='GATE'||Math.hypot(owner.x-v.x,owner.z-v.z)>48){
      const  intent=v.truckYield.intent;v.truckYield=null; /* Local value for intent in tick() */
      if(intent?.type==='gate'||intent?.type==='truck-yard'&&v.job){
       setRoute(v,intent.type,intent.crane);
       log('TRUCK_GATE_YIELD_RESUMED',{vehicle:v.id,job:v.job});
      }
     }
    }
    if(!v.truckYield&&v.state==='RETURNING'&&(v.blockedTime||0)>8&&v.routeIntent?.type==='gate'){
     const cycle=monitor.snapshot().cycles.find(ids=>ids.includes(v.id));
     const other=trucks.find(o=>o!==v&&!o.truckYield&&cycle?.includes(o.id)&&v.id<o.id);
     const reverse=reverseTruckRoute(v),next=reverse[1];
     if(other&&next){
      const d=dist(v,next),step=Math.min(.5,d),nx=v.x+(next.x-v.x)*step/d,nz=v.z+(next.z-v.z)*step/d;
      if(dist({x:nx,z:nz},other)>dist(v,other)+.001&&!trucks.some(o=>o!==v&&dist({x:nx,z:nz},o)<13)){
       v.truckYield={intent:v.routeIntent,opponent:other.id};v.route=reverse;v.routeIndex=1;v.routeVersion++;v.blockedTime=0;
       log('TRUCK_RETURN_PHYSICAL_YIELD',{vehicle:v.id,opponent:other.id,to:reverse.at(-1)});
      }
     }
    }
    if(v.truckYield||!v.job||v.state!=='TRAVEL'||(v.blockedTime||0)<8||v.routeIntent?.type!=='truck-yard')continue;
    /* Evaluates callback for trucks.find using o */
    const cycle=monitor.snapshot().cycles.find(ids=>ids.includes(v.id));
    const outbound=trucks.find(o=>o!==v&&!o.truckYield&&(o.blockedTime||0)>5&&
     (o.state==='RETURNING'||o.state==='TRAVEL'&&cycle?.includes(o.id)&&v.id<o.id)&&
     Math.hypot(o.x-v.x,o.z-v.z)<35);
    if(!outbound)continue;
    const  back=point(v.home.x,v.home.z); /* Local value for back in tick() */
    if(Math.hypot(v.x-back.x,v.z-back.z)<15)continue;
    /* Evaluates callback for trucks.some using o */
    if(trucks.some( o=>o!==v&&Math.hypot(o.x-back.x,o.z-back.z)<13))continue;
    const reverse=reverseTruckRoute(v),first=reverse[1];
    if(!first)continue;
    const rd=Math.hypot(first.x-v.x,first.z-v.z),rs=Math.min(.5,rd);
    const rx=v.x+(first.x-v.x)*rs/rd,rz=v.z+(first.z-v.z)*rs/rd;
    // Proximity alone does not establish an opposing approach. If the other
    // truck is behind us, reversing would close the gap; continue forwards.
    if(Math.hypot(rx-outbound.x,rz-outbound.z)<=Math.hypot(v.x-outbound.x,v.z-outbound.z)+.001)continue;
    v.truckYield={intent:v.routeIntent,opponent:outbound.id};
    v.route=reverse;v.routeIndex=1;
    v.routeVersion=(v.routeVersion||0)+1;v.blockedTime=0;
    log('TRUCK_GATE_PHYSICAL_YIELD',{vehicle:v.id,to:back.x,opponent:outbound.id});
   }
   admit(travelTrucks,activeTruckPermits,12);
   for(let  i=0;i<agvs.length;i++)for(let  j=i+1;j<agvs.length;j++){ /* Loop index for the current collection in tick() */ /* Loop index for the current nested collection in tick() */
     const  d=Math.hypot(agvs[i].x-agvs[j].x,agvs[i].z-agvs[j].z); /* Local value for d in tick() */
     if(d<minAgvClearance)minAgvClearance=d;
     if(rectangularOverlap(agvs[i],agvs[j]))unsafeAgvBodyOverlaps++;
     if(d<10.5-1e-3)unsafeAgvProximity++;
   }
   maxParallelAgvs=Math.max(maxParallelAgvs,activePermits.size);
   maxParallelTrucks=Math.max(maxParallelTrucks,activeTruckPermits.size);
   for(const j of liveJobs)if(!j.preposition)try{tickJob(j)}catch( err){ /* Loop index for the current nested collection in tick() */ /* Local value for err in tick() */
      log('JOB_ERROR',{job:j.id,error:String(err.message)});j.error=String(err.message);started=false;break;
   }
   for(const group of berthCranes)for(const [i,crane] of group.entries()){
    if(!crane.job&&stsSweeps.has(crane.id)&&crane.downUntil<=t){
     const movement=crane.homeX-crane.x;
     crane.x=Math.abs(movement)<=9*h?crane.homeX:crane.x+Math.sign(movement)*9*h;
     crane.hook.x=crane.x;
     if(crane.x===crane.homeX)stsSweeps.delete(crane.id);
    }
    const sweep=stsSweeps.get(crane.id)||{min:crane.homeX,max:crane.homeX};
    const next=group[i+1];
    if(crane.x<sweep.min-1e-6||crane.x>sweep.max+1e-6||next&&next.x-crane.x<STS_RAIL_GAP-1e-6){
     stsRailViolations++;
     log('STS_RAIL_VIOLATION',{sts:crane.id,blockingResourceId:next?.id,position:crane.x});
     started=false;return;
    }
   }
   const invalidOwnership=craneOccupancy().filter(owner=>!owner.valid);
   if(invalidOwnership.length){
    transferOwnershipViolations+=invalidOwnership.length;
    for(const owner of invalidOwnership)log('TRANSFER_OWNERSHIP_VIOLATION',{...owner,blockingReason:'VEHICLE_OUTSIDE_TRANSFER_SLOT'});
    started=false;return;
   }
   kpiSampleAccumulator+=h;
   if(kpiSampleAccumulator>=.35){sampleKPI(kpiSampleAccumulator);kpiSampleAccumulator=0;}
   if(t-lastMonitorAt>=1){lastMonitorAt=t;sampleMonitor();}
  }
 }
 function sampleMonitor(){
  monitor.sample(t,[...agvs,...trucks].map(v=>{
   const job=liveJob(v.job||v.pipelineJob);
   const order=job?.order||ordersById.get(v.pending);
   const mission=order?coordinator.missions.get(order.id):null;
   const next=v.route[v.routeIndex];
   let blockingReason=v.pivot?'TRANSFER_ALIGNMENT':v.route.length?v.trafficBlock?.reason||(!activePermits.has(v.id)?'TRAFFIC_AUTHORIZATION':null):mission?.reason||null;
   let blockingResourceId=v.route.length?v.trafficBlock?.resource||null:null;
   if(v.type==='truck'&&v.pending&&order){
    const crane=rtgTruck[order.yard];blockingReason=crane.downUntil>t?'CRANE_OUTAGE':crane.job?'CRANE_BUSY':'WAITING_TRUCK_AUTHORIZATION';blockingResourceId=crane.id;
   }
   if(!v.route.length&&mission?.reason){
    if(mission.reason==='PARKING_EXIT_CONFLICT')blockingResourceId=agvs.find(o=>o!==v&&o.home.x===v.home.x&&o.route.length&&o.x<-308&&['sts','yard','staging'].includes(o.routeIntent?.type))?.id||null;
    if(mission.reason.startsWith('YARD_CRANE'))blockingResourceId=rtgAgv[order.yard]?.id||null;
    if(mission.reason.startsWith('STS_CRANE'))blockingResourceId=order.crane;
   }
   if(!v.route.length&&job&&!job.preposition){
    const crane=v.type==='truck'?job.rtg:job.stage==='PICK'?(job.type==='IMPORT'?job.sts:job.rtg):(job.type==='IMPORT'?job.rtg:job.sts);
    if(crane?.downUntil>t){blockingReason='CRANE_OUTAGE';blockingResourceId=crane.id;}
    else if(crane?.job&&crane.job!==job.id){blockingReason='CRANE_BUSY';blockingResourceId=crane.id;}
    else if(job.stsRailBlocker){blockingReason='STS_RAIL_CLEARANCE';blockingResourceId=job.stsRailBlocker;}
    else if(crane?.type==='sts'&&!crane.job&&stsSweeps.has(crane.id)){
     blockingReason='STS_RAIL_RETURN';blockingResourceId=crane.id;
    }
   }
   return {vehicleId:v.id,missionId:mission?.id||order?.id||null,vesselCallId:order?.vesselCall||null,stsId:order?.crane||null,
    vehicleType:v.type,containerId:v.load||order?.container||null,toState:job?.stage||mission?.state||v.state,
    active:!!(order||v.route.length),position:{x:v.x,z:v.z},destination:next?{x:next.x,z:next.z}:null,
    blockingReason,blockingResourceId,routeOrReservationId:v.route.length?v.trafficBlock?.section||v.id+':'+v.routeVersion+':'+v.routeIndex:
     blockingReason==='STS_RAIL_CLEARANCE'||blockingReason==='STS_RAIL_RETURN'?blockingResourceId+':rail':order?.id||null,
    trafficAuthorized:(v.type==='truck'?activeTruckPermits:activePermits).has(v.id),recoveryToken:v.recoveryToken||null,
    plannedNextAction:v.route.length?'FOLLOW_ROUTE':job?.stage==='PICK'||job?.stage==='PLACE'?'PHYSICAL_HANDOVER':order?'RETRY_AUTHORIZATION':'AWAIT_DEMAND',
    progressSignature:[job?.id,job?.stage,job?.phase,job?.container?.history.length,v.completed].join('|')};
  }),cranes.filter(c=>c.job).map(c=>({from:c.id,to:jobsById.get(c.job)?.vehicle?.id})).filter(e=>e.to));
 }
 function reliabilityDiagnostics(){
  const {requests}=coordinator.snapshot({includeHistory:false});
  return {...monitor.snapshot(),cargoDemands:requests.map(r=>{
   const c=containers.get(r.container),slot=yardSlots.find(s=>s.stack.includes(r.container));
   return {...r,site:c?.site,position:c?{x:c.x,z:c.z}:null,yard:c?.yard,order:c?.order,loadCall:c?.loadCall,top:c?currentTop(c):false,
    agvReachable:c?.site==='yard'?topYard(c.yard,'outbound','agv').includes(c):false,stack:slot?.stack.map(id=>({id,loadCall:containers.get(id)?.loadCall,order:containers.get(id)?.order}))};
  }),sts:sts.map(q=>{
   const call=activeCall(q.ship), metric=craneMetric(q),missions=[...coordinator.activeMissions()].filter(m=>m.sts===q.id);
   return {stsId:q.id,vesselCallId:call?.id||null,remainingDischarge:call?.discharge.filter(w=>w.crane===q.id&&w.state!=='DONE').length||0,
    remainingLoad:call?.load.filter(w=>w.crane===q.id&&w.state!=='DONE').length||0,
    outstandingRequests:requests.filter(r=>r.sts===q.id),
    assignedAGVs:missions.map(m=>m.vehicle),approachingAGVs:missions.filter(m=>agvs.find(v=>v.id===m.vehicle)?.route.length).map(m=>m.vehicle),
    waitingCause:metric.currentCause||null,waitingDuration:metric.currentCause?t-metric.waitStarted:0,waitCauses:{...metric.waitCauses},grossMovesPerHour:metric.working?q.completed*3600/metric.working:0};
  })};
 }
 /* Handles agv waiting reason in the terminal simulation */
  function agvWaitingReason(v){
  if(v.pivot)return 'SAFE ROTATION INTERLOCK';
  if(v.route.length&&(v.blockedTime||0)>4)return v.load?'LOADED: INTERSECTION / VEHICLE BLOCKED':'INTERSECTION / VEHICLE BLOCKED';
  if(v.route.length)return v.job?'TRANSPORT IN PROGRESS':'TRAVELLING TO CRANE OR PARKING';
  const  j=liveJob(v.job||v.pipelineJob); /* Loop index for the current nested collection in agvWaitingReason() */
  if(j&&!j.preposition){
   if(j.stage==='PLACE')return 'DOCKED: RECEIVING CRANE HANDLING';
   if(j.stage==='PICK')return 'DOCKED: PICKUP CRANE HANDLING';
   if(j.stage==='TO_PICKUP'||j.stage==='TO_DROPOFF')return 'DOCKED: WAITING HANDOFF / DISPATCH';
  }
  const  o=v.pending?ordersById.get(v.pending):null; /* Local value for o in agvWaitingReason() */
  if(o){
   /* Evaluates callback for sts.find using q */
   const  qc=o.crane?sts.find( q=>q.id===o.crane):null; /* Local value for qc in agvWaitingReason() */
   const  yc=rtgAgv[o.yard]; /* Local value for yc in agvWaitingReason() */
   if(qc?.downUntil>t||yc?.downUntil>t)return 'WAITING: CRANE OUTAGE';
   if(qc?.job||yc?.job)return 'WAITING: ASSIGNED CRANE BUSY';
   if(o.type==='IMPORT'&&!freeStsLane(qc))return 'WAITING: FOUR STS TRANSFER SLOTS FULL';
   if(!availableDockBay('agv',o.yard,v))return 'WAITING: FOUR YARD TRANSFER SLOTS FULL';
   if(v.x<-360&&!parkingExitFree(v))return 'WAITING: PARKING EXIT OCCUPIED';
   return 'ASSIGNED: AWAITING SAFE CRANE ADMISSION';
  }
  return 'NO EXECUTABLE CONTAINER ORDER';
 }
 /* Builds a point-in-time snapshot of terminal and fleet operations */
 /* Evaluates callback for vesselCalls.filter using c */
 /* Evaluates callback for vesselCalls.filter using c */
 /* Evaluates callback for berths.map using k */
  function status(){return {time:t,transferOwnershipViolations,craneOccupancy:craneOccupancy(),vesselCalls:vesselCalls.length,vesselsDeparted:completedVesselCalls,vesselsWaiting:vesselCalls.filter( c=>c.state==='WAITING_BERTH').length,vesselsScheduled:vesselCalls.filter( c=>c.state==='SCHEDULED').length,manifestViolations,berths:berths.map( k=>({call:k?.id||null,state:k?.state||'EMPTY'})),moves:moveCount,containers:containers.size,agvs:agvs.length,trucks:trucks.length,
  /* Evaluates callback for agvs.filter using v */
  /* Evaluates callback for agvs.filter using v */
  /* Evaluates callback for agvs.filter using v */
  /* Evaluates callback for agvs.filter using v */
  /* Evaluates callback for trucks.filter using v */
  busyAgvs:agvs.filter( v=>!!(v.job||v.pipelineJob)).length,currentCraneAgvJobs:agvs.filter( v=>!!v.job).length,prepositioningAgvs:agvs.filter( v=>v.state==='PREPOSITIONING').length,stagedAgvs:agvs.filter( v=>v.state==='STAGED').length,busyTrucks:trucks.filter( v=>!!v.job).length,
  /* Evaluates callback for agvs.filter using v */
  /* Evaluates callback for trucks.filter using v */
  // Header counts only real accepted transport orders; passive WAIT_FOR_WORK tasks are not assignments.
  assignedAgvs:agvs.filter(v=>!!(v.job||v.pending||v.pipelineJob)).length,assignedTrucks:trucks.filter(v=>!!(v.job||v.pending)).length,
  /* Evaluates callback for agvs.filter using v */
  /* Evaluates callback for trucks.filter using v */
  transportAssignedAgvs:agvs.filter( v=>!!(v.job||v.pending||v.pipelineJob)).length,transportAssignedTrucks:trucks.filter( v=>!!(v.job||v.pending)).length,
  activeJobs:liveJobs.size,
  parkedUnassignedAgvs:agvs.filter(v=>v.state==='PARKED'&&!v.pending&&!v.job&&!v.pipelineJob).length,
  blockedAgvs:agvs.filter(v=>v.route.length&&(v.blockedTime||0)>5).length,
  /* Evaluates callback for agvs.filter using v */
  productiveAgvs:agvs.filter( v=>v.job&&(v.route.length||v.load||v.state==='DOCKED'||v.state==='ASSIGNED')).length,
  /* Evaluates callback for agvs.filter using v */
  actualMovingAgvs:agvs.filter( v=>v.route.length&&activePermits.has(v.id)).length,
  /* Evaluates callback for agvs.filter using v */
  parkedWithAssignment:agvs.filter( v=>v.pending&&!v.route.length&&v.x<-350).length,
  /* Evaluates callback for agvs.filter using v */
  queuedAtSTS:agvs.filter( v=>v.stageBay?.side==='sts'&&!v.job).length,
  /* Evaluates callback for events.filter using e */
  pairedCycles:events.filter( e=>e.type==='AGV_DOUBLE_CYCLE_ASSIGNED').length,
  /* Evaluates callback for events.filter using e */
  directReassignments:events.filter( e=>e.type==='AGV_DIRECT_REASSIGN').length,
  /* Evaluates callback for events.filter using e */
  craneQueueAdmissions:events.filter( e=>e.type==='CRANE_SLOT_QUEUE_ADMITTED').length,
  /* Evaluates callback for events.filter using e */
  earlyPickupCraneReleases:events.filter( e=>e.type==='CRANE_PICKUP_RELEASED').length,
  /* Evaluates callback for agvs.reduce using n, v */
  /* Evaluates callback for agvs.reduce using n, v */
  agvEmptyShare:( ()=>{const  empty=agvs.reduce( (n,v)=>n+v.emptyMeters,0), loaded=agvs.reduce( (n,v)=>n+v.loadedMeters,0);return loaded+empty?Math.round(1000*empty/(loaded+empty))/10:0;})(), /* Evaluates inline calculation callback */ /* Local value for empty in status() */ /* Local value for loaded in status() */
  /* Evaluates callback for events.filter using e */
  errors:events.filter( e=>e.type==='JOB_ERROR').slice(-5),
  blocked:roadBlocked,craneWaits,craneRailViolations:yardCraneIncidents.length+stsRailViolations,stsRailViolations,relaysCompleted:completedRelays,
rollingSectionGrants,rollingSectionReleases,quayLaneCount:8,quayLanePitch:QUAY_ROW_PITCH,yardLaneCount:BLOCK_GRID_X.length,yardInboundLanes:YARD_INCOMING_X.length,yardOutboundLanes:YARD_OUTGOING_X.length,yardLanePitch:TRAVEL_PITCH,
  /* Evaluates callback for events.filter using e */
  /* Evaluates callback for events.filter using e */
  /* Evaluates callback for events.filter using e */
  truckGatePhysicalYields:events.filter( e=>e.type==='TRUCK_GATE_PHYSICAL_YIELD').length,agvConflictReroutes:events.filter( e=>e.type==='AGV_CONFLICT_REROUTE').length,agvPhysicalYields:events.filter( e=>e.type==='AGV_PHYSICAL_YIELD').length,
  independentIntersectionController:true,agvYardSlotsPerCrane:4,truckYardSlotsPerCrane:4,
  omnidirectionalPivotEnabled:true,pivotMode:'emergency-yield-only',pivotBlockedThresholdSeconds:9,pivotStarted,pivotCompleted,pivotDenied,pivotSeconds:+pivotSeconds.toFixed(2),
  /* Evaluates callback for agvs.filter using v */
  pivotingAgvs:agvs.filter( v=>!!v.pivot).length,pivotSweepRadius:PIVOT_SWEEP_RADIUS,
  loadedRouteWaitSeconds:Math.round(loadedRouteWaitSeconds*10)/10,emptyRouteWaitSeconds:Math.round(emptyRouteWaitSeconds*10)/10,
  /* Evaluates callback for agvs.filter using v */
  loadedAgvsWaitingForRoute:agvs.filter( v=>v.load&&v.route.length&&!activePermits.has(v.id)).length,
  /* Evaluates callback for ['IMPORT','EXPORT','TRUCK_DELIVERY','TRUCK_PICKUP','YARD_RELAY'].map using type */
  guidePathNodes:AGV_GRID.nodes.size,gridRoutes,gridRouteFailures,minAgvClearance:Math.round(minAgvClearance*100)/100,unsafeAgvProximity,unsafeAgvBodyOverlaps,movingAgvs:activePermits.size,movingTrucks:activeTruckPermits.size,peakConcurrentAgvs:maxParallelAgvs,peakConcurrentTrucks:maxParallelTrucks,junctionYields:agvYieldFor.size,completedByType:{...completedByType}};}
 /* Formats live equipment status for modal tables */
 /* Evaluates callback for list.map using v */
  function equipmentRows(type){const  list=type==='agv'?agvs:type==='truck'?trucks:type==='sts'?sts:rtgs;return list.map( v=>{ /* Local value for list in equipmentRows() */
  const  job=liveJob(v.job||v.pipelineJob); /* Transport or crane job being processed in equipmentRows() */
  const  pending=v.pending?ordersById.get(v.pending):null; /* Local value for pending in equipmentRows() */
  const  task=job?job.type:pending?.type||v.task?.type||'AWAITING_WORK'; /* Local value for task in equipmentRows() */
  const  operationalState=job?.preposition?(v.state==='STAGED'?'WAITING AT QUEUE STAND':'PREPOSITIONING'):job?job.stage:pending?'QUEUED FOR CRANE':v.route?.length?'REPOSITIONING':'WAITING FOR REAL ORDER'; /* Local value for operational state in equipmentRows() */
  return {id:v.id,state:operationalState,waitReason:v.type==='agv'?agvWaitingReason(v):'—',waitingSeconds:Math.round(v.blockedTime||0),job:job?.id||pending?.id||v.task?.order||v.task?.type||'—',
    container:job?.container.id||pending?.container||v.task?.container||'—',
    next:task,x:v.x,z:v.z,completed:v.completed||0};
 })}
 /* Formats container location and order data for modal tables */
  function containerRows(group){const  filter=group==='ship'? c=>c.site==='ship':group==='inbound'? c=>c.site==='yard'&&L.yards[c.yard].type==='inbound': /* Local value for filter in containerRows() */ /* Evaluates inline calculation callback using c */ /* Evaluates inline calculation callback using c */
   group==='outbound'? c=>c.site==='yard'&&L.yards[c.yard].type==='outbound': c=>c.site!=='EXITED'; /* Evaluates inline calculation callback using c */ /* Evaluates inline calculation callback using c */
  /* Evaluates callback for [...containers.values()].filter(filter).map using c */
  return [...containers.values()].filter(filter).map( c=>({id:c.id,location:c.site==='yard'?L.yards[c.yard].id:c.site==='ship'?'VES-'+(c.ship+1):c.site,
    order:c.order||'—',scheduled:ordersById.get(c.order)?.type||'—',carrier:c.carrier?.id||'—',x:c.x,z:c.z,y:c.y}));}
 return {quayRows:QUAY_ROWS,quayPitch:QUAY_ROW_PITCH,pivotSafety:{radius:PIVOT_SWEEP_RADIUS,stopLine:STOP_LINE,junctionClearance:JUNCTION_CLEARANCE,turnDelta,circleIntersectsVehicle,pivotEnvelopeClear},L,YARD_AGV_BAYS,YARD_TRUCK_BAYS,CRANE_QUEUE_BAYS,vesselCalls,berths,vesselRows,vesselWorklist,agvGuideGraph:AGV_GRID,truckRoadGraph:TRUCK_GRID,containers,history,jobs,orders,events,agvs,trucks,sts,rtgs,yardSlots,tick,status,equipmentRows,containerRows,
  /* Handles time in the terminal simulation */
  /* Handles running in the terminal simulation */
  /* Handles pause in the terminal simulation */
  /* Handles resume in the terminal simulation */
  getKPI,reliabilityDiagnostics,eventCounts,resources:{availableDockBay,isVehicleDispatchable:vehicleDispatchable,alignedAtRTG,alignedAtSTS,craneOccupancy},routing:{planAGV:routeAGV,planEscape,reverseTruckRoute,estimateArrival,graphDistance}, get control(){return coordinator.snapshot()}, get time(){return t}, get running(){return started}, pause(){started=false}, resume(){started=true},
  /* Handles speed in the terminal simulation */
  /* Evaluates callback for agvs.forEach using a */
  /* Evaluates callback for trucks.forEach using a */
   set speed(v){agvs.forEach( a=>a.speed=15*v);trucks.forEach( a=>a.speed=12*v)},
  /* Evaluates callback for agvs.map using v */
  /* Evaluates callback for rtgs.map using c */
  /* Evaluates callback for [...agvs,...trucks].filter using v */
  /* Evaluates callback for [...agvs,...trucks].filter(v=>v.blockedTime>15).map using v */
   diagnostics(){return {...status(),reliability:reliabilityDiagnostics(),eventCounts:{...eventCounts},control:coordinator.snapshot(),agvFleet:agvs.map( v=>({id:v.id,job:v.job||v.pipelineJob||null,pendingOrder:v.pending||null,container:v.load||v.task?.container||null,state:v.state,position:{x:+v.x.toFixed(2),z:+v.z.toFixed(2)},routeIndex:v.routeIndex})),yardCranePositions:rtgs.map( c=>({id:c.id,role:c.role,yard:c.yard,x:+c.x.toFixed(2),range:YARD_LIMITS[c.role]})),yardCraneIncidents:yardCraneIncidents.slice(-10),stuck:[...agvs,...trucks].filter( v=>v.blockedTime>15).map( v=>({id:v.id,blocked:v.blockedTime,state:v.state,at:[v.x,v.z],next:v.route[v.routeIndex]})),jobs:[...liveJobs].map( j=>({id:j.id,stage:j.stage,crane:j.rtg?.id,sts:j.sts?.id,vehicle:j.vehicle?.id||'RTG-PAIR'}))}}}; /* Returns detailed engineering diagnostics and equipment state */
 }
 root.PortGridEngine=makeEngine;
 if(typeof module!=='undefined'&&module.exports)module.exports=makeEngine;
})(typeof window!=='undefined'?window:globalThis);
