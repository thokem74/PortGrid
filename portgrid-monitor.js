/* Deterministic observation only. Replanning is not evidence of physical progress. */
(function(root){'use strict';
function findCycles(edges){
 const graph=new Map(edges.map(e=>[e.from,e.to])),cycles=[],done=new Set();
 for(const start of graph.keys()){
  const path=[],indices=new Map();let node=start;
  while(graph.has(node)&&!done.has(node)){
   if(indices.has(node)){cycles.push(path.slice(indices.get(node)));break;}
   indices.set(node,path.length);path.push(node);node=graph.get(node);
  }
  for(const id of path)done.add(id);
 }
 return cycles;
}
function createMonitor({threshold=60,emit=()=>{}}={}){
 const records=new Map();let cycles=[],dependencies=[];
 function sample(now,rows,resources=[]){
  for(const row of rows){
   let r=records.get(row.vehicleId);
   if(!r){r={...row,lastProgress:now,progressX:row.position.x,progressZ:row.position.z,signature:row.progressSignature,recoveryAttempts:0};records.set(row.vehicleId,r);}
   const progress=Math.hypot(row.position.x-r.progressX,row.position.z-r.progressZ)>.1||row.progressSignature!==r.signature;
   if(progress){r.lastProgress=now;r.progressX=row.position.x;r.progressZ=row.position.z;r.signature=row.progressSignature;}
   const previous=r.toState,previousReason=r.blockingReason;
   Object.assign(r,row);r.waitingDuration=row.active?now-r.lastProgress:0;
   if(row.recoveryToken&&row.recoveryToken!==r.lastRecovery){r.recoveryAttempts++;r.lastRecovery=row.recoveryToken;}
   if(previous!==row.toState||previousReason!==row.blockingReason){emit({...row,simulationTime:now,fromState:previous??null,type:'VEHICLE_TRANSITION'});}
   if(row.active&&r.waitingDuration>=threshold&&now-(r.lastWatchdog??-Infinity)>=threshold){
    r.lastWatchdog=now;emit({...r,simulationTime:now,type:'NO_PROGRESS',plannedNextAction:row.plannedNextAction});
   }
  }
  dependencies=[...records.values()].filter(r=>r.active&&r.blockingResourceId).map(r=>({from:r.vehicleId,to:r.blockingResourceId})).concat(resources);
  cycles=findCycles(dependencies);
 }
 return {sample,snapshot:()=>({vehicles:[...records.values()].map(r=>({...r})),cycles,dependencies})};
}
root.PortGridMonitor={createMonitor,findCycles};
if(typeof module!=='undefined'&&module.exports)module.exports={createMonitor,findCycles};
})(typeof globalThis!=='undefined'?globalThis:this);
