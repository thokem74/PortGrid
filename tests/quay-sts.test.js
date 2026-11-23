'use strict';
const assert=require('node:assert/strict');
const makeEngine=require('../portgrid-engine');

function fixture(options={}){
 let seed=3;
 return makeEngine({rng:()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296,
  continuousVessels:false,preloadFutureCalls:false,dischargePerCall:18,loadPerCall:4,...options});
}

function advanceUntil(sim,seconds,done){
 while(sim.running&&sim.time<seconds&&!done())sim.tick(.1);
 assert.ok(sim.running,JSON.stringify(sim.status().errors));
 assert.ok(done(),'physical fixture did not complete by '+seconds+' simulated seconds');
 assert.equal(sim.status().craneRailViolations,0);
 assert.equal(sim.status().unsafeAgvBodyOverlaps,0);
 assert.equal(sim.status().transferOwnershipViolations,0);
 assert.equal(sim.status().gridRouteFailures,0);
 assert.equal(sim.status().manifestViolations,0);
}

{
 const sim=fixture({preloadFutureCalls:true});
 const {sections,edges}=sim.agvGuideGraph;
 const links=[...sections.values()].filter(s=>s.zone==='QUAY_TRANSFER_LINK');
 assert.equal(links.length,24);
 for(const [berth,center] of sim.L.shipX.entries()){
  for(const z of sim.quayRows.filter(z=>z<0)){
   for(const x of [center-36,center+36]){
    const east=(x+18)+','+z,west=(x-18)+','+z;
    const edge=edges.get(east).find(e=>e.to===west);
    assert.equal(edge.section.berth,berth);
    assert.equal(edge.section.zone,'QUAY_TRANSFER_LINK');
    assert.ok(edge.section.travel&&edge.section.length===36);
    assert.ok(edge.section.length-sim.pivotSafety.stopLine>sim.pivotSafety.junctionClearance);
    assert.ok(!edges.get(west).some(e=>e.to===east),'each transfer link is westbound');
   }
  }
  for(const call of sim.vesselCalls.filter(call=>call.berth===berth)){
   const cargo=call.shipContainers.map(id=>sim.containers.get(id));
   const bays=[...new Set(cargo.map(c=>c.x))].sort((a,b)=>a-b);
   assert.equal(bays.length,18);
   for(let i=1;i<bays.length;i++)assert.ok(Math.abs(bays[i]-bays[i-1]-10.8)<1e-6);
   assert.equal(new Set(cargo.map(c=>c.x+','+c.z)).size,90);
   assert.ok(bays[0]-5.75>center+sim.L.shipBridgeOffset+sim.L.shipBridgeLength/2);
   assert.ok(bays.at(-1)+5.75<center+sim.L.shipDeckLength/2);
  }
 }
 const wheelsOuterZ=sim.L.stsZ+Math.max(...sim.L.stsWheelOffsetsZ)+2.8;
 assert.ok(Math.min(...sim.quayRows)-sim.pivotSafety.radius>wheelsOuterZ,'STS wheels clear the nearest transfer row');
 assert.ok(sim.L.stsRailGap>2*(12.5+2.4),'neighboring wheel envelopes clear on shared rails');
 console.log('PASS: per-berth transfer grid and full initial/replacement vessel geometry');
}

{
 const sim=fixture({dischargePerCall:0,loadPerCall:0});
 const [west,middle,east]=sim.sts;
 const [traveller,parallel,...blockers]=sim.agvs;
 const row=-60;
 const legs=v=>v.route.map((p,i)=>i&&sim.agvGuideGraph.edges.get(v.route[i-1].x+','+v.route[i-1].z)
  ?.find(e=>e.to===p.x+','+p.z));
 for(const v of sim.agvs)v.pending='FIXTURE';
 for(const v of sim.trucks)v.pending='FIXTURE';
 Object.assign(traveller,{x:east.homeX,z:row,heading:Math.PI,state:'AVAILABLE'});
 traveller.route=sim.routing.planAGV(traveller,'sts',{...west,dockZ:row});
 assert.equal(legs(traveller).filter(e=>e?.zone==='QUAY_TRANSFER_LINK').length,2);
 for(const [i,dockZ] of sim.quayRows.filter(z=>z<0).entries()){
  Object.assign(blockers[i],{x:middle.homeX,z:dockZ,heading:Math.PI,state:'DOCKED',
   stageBay:{x:middle.homeX,z:dockZ,crane:middle.id,side:'sts'}});
 }
 traveller.route=sim.routing.planAGV(traveller,'sts',{...west,dockZ:row});
 assert.ok(!traveller.route.some(p=>p.x===middle.homeX&&p.z===row));
 assert.ok(traveller.route.some(p=>p.z>=0),'a reserved intermediate stand has a main-grid fallback');
 for(const v of blockers)Object.assign(v,v.home,{stageBay:null,state:'PARKED'});
 for(const [v,dockZ] of [[traveller,row],[parallel,-36]]){
  const target={...west,dockZ};
  Object.assign(v,{x:east.homeX,z:dockZ,heading:Math.PI,state:'TRAVEL',routeIndex:1,
   routeIntent:{type:'sts',crane:target}});
  v.route=sim.routing.planAGV(v,'sts',target);
 }
 advanceUntil(sim,60,()=>[traveller,parallel].every(v=>v.x===west.homeX&&!v.route.length));
 assert.equal(sim.eventCounts.QUAY_TRANSFER_LINK_TRAVERSED,4);
 console.log('PASS: physical AGVs traverse adjacent STS service areas and route around a committed stand');
}

{
 const sim=fixture({craneOutages:{'QC-01':100,'QC-02':100}});
 const call=sim.vesselCalls[0],center=call.x;
 const targets=[-91.8,-37.8,37.8,91.8];
 const keep=targets.map(offset=>call.discharge.find(w=>Math.abs(sim.containers.get(w.container).x-center-offset)<1e-6));
 assert.ok(keep.every(Boolean));
 for(const w of call.discharge)if(!keep.includes(w))sim.containers.get(w.container).dischargeCall=null;
 call.discharge.splice(0,call.discharge.length,...keep);
 for(const [i,w] of call.load.entries()){
  const c=sim.containers.get(keep[i].container);
  w.plannedPosition={x:c.x,y:c.y,z:c.z};
  w.crane=keep[i].crane;
 }
 const shared=keep[1],original=sim.control.requests.find(r=>r.container===shared.container);
 assert.equal(original.sts,'QC-01');
 sim.sts[1].downUntil=0;
 advanceUntil(sim,5,()=>shared.crane==='QC-02'&&shared.order);
 const reassigned=sim.control.requests.find(r=>r.container===shared.container);
 assert.equal(reassigned.id,original.id);
 assert.equal(reassigned.age,Number(sim.time.toFixed(1)));
 assert.equal(reassigned.sts,'QC-02');
 assert.equal(sim.control.requests.find(r=>r.container===keep[0].container).status,'OPEN','outage leaves unique-bay demand visible');
 sim.sts[0].downUntil=0;
 sim.sts[1].downUntil=110;
 advanceUntil(sim,150,()=>sim.time>=120);
 assert.equal(sim.orders.find(o=>o.id===shared.order).crane,'QC-02');
 assert.equal(shared.crane,'QC-02','a committed assignment survives an outage');
 advanceUntil(sim,1300,()=>call.state==='DEPARTED');
 for(const w of [...keep,...call.load])assert.equal(w.state,'DONE');
 const sharedTransfers=sim.events.filter(e=>e.type==='STS_SHARED_BAY_TRANSFER'&&e.vesselCallId===call.id);
 for(const x of [center-37.8,center+37.8])for(const action of ['IMPORT','EXPORT']){
  assert.ok(sharedTransfers.some(e=>Math.abs(e.bayX-x)<1e-6&&e.action===action),'both shared boundaries support both directions');
 }
 const movements=sim.orders.filter(o=>o.vesselCall===call.id&&['IMPORT','EXPORT'].includes(o.type));
 assert.equal(movements.length,8);
 const lastImport=Math.max(...movements.filter(o=>o.type==='IMPORT').map(o=>o.completed));
 assert.ok(movements.filter(o=>o.type==='EXPORT').every(o=>o.assigned>=lastImport));
 console.log('PASS: exclusive and shared bays complete physically, with persistent demand and stable outage commitments');
}

{
 let conflict;
 const sim=fixture({dischargePerCall:12,loadPerCall:8,onEvent:e=>{
  if(!conflict&&e.type==='STS_RAIL_WAIT')conflict=e;
 }});
 advanceUntil(sim,1000,()=>!!conflict);
 const waiting=sim.jobs.find(j=>j.id===conflict.job);
 const owner=sim.sts.find(q=>q.id===conflict.blockingResourceId);
 assert.equal(waiting.vehicle.state,'DOCKED');
 assert.equal(waiting.sts.job,null,'overlapping rail sweeps deny handover even with a docked AGV');
 assert.ok(owner?.job,'the neighboring crane still owns its sweep');
 assert.equal(Math.abs(owner.homeX-waiting.sts.homeX),72);
 assert.ok(sim.eventCounts.STS_DEMAND_REASSIGNED>0);
 assert.ok(sim.events.some(e=>e.type==='STS_DEMAND_REASSIGNED'&&e.selectionReason==='EARLIER_SERVICE'));
 advanceUntil(sim,1150,()=>waiting.completed);
 assert.ok(waiting.stsServiceStarted>conflict.simulationTime,'the handover starts after rail clearance');
 assert.ok(sim.getKPI().sts.some(q=>q.stateSeconds.STS_RAIL_CLEARANCE>0));
 console.log('PASS: workload-based sharing, conflicting sweep denial, and bounded rail clearance');
}
