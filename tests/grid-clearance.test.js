'use strict';

const assert=require('node:assert/strict');
const createEngine=require('../portgrid-engine');

function fixture(){
 const sim=createEngine({rng:()=>.5,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});
 for(const agv of sim.agvs)agv.pending='FIXTURE';
 return sim;
}

function moveAlong(vehicle,route,index=1,position=route[0]){
 const start=route[index-1],end=route[index];
 Object.assign(vehicle,{...position,route,routeIndex:index,routeVersion:1,state:'TRAVEL',
  heading:Math.atan2(end.z-start.z,end.x-start.x)});
}

function putCargoOn(sim,vehicle){
 const slot=sim.yardSlots.find(s=>s.yard<3&&s.stack.length);
 const cargo=sim.containers.get(slot.stack.pop());
 Object.assign(cargo,{site:'agv',carrier:vehicle,x:vehicle.x,z:vehicle.z,y:3.65});
 vehicle.load=cargo.id;
}

const p=(x,z)=>({x,z});
const id=({x,z})=>x+','+z;
const tick=(sim,steps)=>{for(let i=0;i<steps;i++)sim.tick(.1);};

function assertDirectedRoute(sim,route){
 const graph=sim.agvGuideGraph;
 for(let i=1;i<route.length;i++){
  const from=id(route[i-1]),to=id(route[i]);
  assert.ok(graph.edges.get(from)?.some(e=>e.to===to&&!!e.reverse===!!route[i].reverse),
   'route follows the directed graph '+from+' to '+to);
 }
}

{
 const sim=fixture(),graph=sim.agvGuideGraph;
 const {stopLine,junctionClearance}=sim.pivotSafety;
 assert.ok(stopLine>junctionClearance);
 for(const section of graph.sections.values()){
  if(section.travel)assert.ok(section.length-stopLine>junctionClearance,section.id);
 }
 assert.deepEqual([...graph.sections.values()].filter(s=>s.zone==='PARKING_QUAY_CONNECTOR').map(s=>s.id).sort(),[
  '-308,-12|-426,-12','-308,-24|-462,-24','-308,-36|-414,-36','-308,0|-378,0'
 ]);
 const sections=[...graph.sections.values()].map(section=>{
  const [a,b]=section.id.split('|').map(key=>graph.nodes.get(key));
  return {...section,a,b};
 });
 const inside=(value,a,b)=>value>=Math.min(a,b)&&value<=Math.max(a,b);
 for(const h of sections.filter(s=>s.a.z===s.b.z)){
  for(const v of sections.filter(s=>s.a.x===s.b.x)){
   if(h.zone.startsWith('PARKING_')&&v.zone.startsWith('PARKING_'))continue;
   if(!inside(v.a.x,h.a.x,h.b.x)||!inside(h.a.z,v.a.z,v.b.z))continue;
   const junction=id(p(v.a.x,h.a.z));
   assert.ok([h.a.id,h.b.id].includes(junction)&&[v.a.id,v.b.id].includes(junction),
    'every terminal road crossing is a shared graph node '+junction);
  }
 }
 console.log('PASS: travel clearance, explicit junction topology and four existing parking connectors');
}

for(const zone of ['quay','yard']){
 const sim=fixture(),[waiter,blocker,crossA,crossB]=sim.agvs;
 const north=zone==='quay'?72:sim.L.yards[0].z-18;
 const approach=zone==='quay'?36:sim.agvGuideGraph.yardMouthZ;
 const quay=zone==='quay';
 const a=p(quay?-200:-272,north),b=p(-236,north);
 const after=p(b.x,b.z+(quay?-36:36));
 const waitingRoute=[a,b,after,quay?p(-200,after.z):p(b.x,north+72)];
 const blockerRoute=[b,after,waitingRoute.at(-1),p(quay?-164:-200,waitingRoute.at(-1).z)];
 const crossRouteA=quay?[p(-164,north),a,p(a.x,108)]:
  [p(-308,north),a,p(a.x,north+36)];
 const crossRouteB=quay?[p(b.x,108),b,p(-272,north)]:[p(b.x,approach),b,p(-200,north)];
 const stopX=(a.x+b.x)/2;
 for(const route of [waitingRoute,blockerRoute,crossRouteA,crossRouteB])assertDirectedRoute(sim,route);

 moveAlong(waiter,waitingRoute);
 putCargoOn(sim,waiter);
 moveAlong(blocker,blockerRoute,1,p(b.x,b.z+(quay?-27:27)));
 blocker.speed=0;
 tick(sim,35);
 assert.ok(Math.abs(waiter.x-stopX)<.001,'AGV reaches the intermediate stop line');
 assert.equal(waiter.z,b.z);
 assert.ok(sim.pivotSafety.junctionClearance<Math.abs(waiter.x-a.x));
 assert.ok(sim.pivotSafety.junctionClearance<Math.abs(waiter.x-b.x));

 moveAlong(crossA,crossRouteA);
 moveAlong(crossB,crossRouteB);
 tick(sim,110);
 for(const [v,route] of [[crossA,crossRouteA],[crossB,crossRouteB]]){
  assert.deepEqual(p(v.x,v.z),route.at(-1),'crossing AGV completes its turn while the waiter holds');
 }
 assert.equal(waiter.z,b.z);
 assert.ok(Math.abs(waiter.x-stopX)<.001);
 blocker.speed=15;
 tick(sim,140);
 assert.deepEqual(p(waiter.x,waiter.z),waitingRoute.at(-1),'waiter resumes when the section clears');
 assert.equal(sim.status().unsafeAgvBodyOverlaps,0);
 console.log('PASS: loaded AGV waits clear of both '+zone+' junctions, cross traffic turns and the waiter resumes');
}

{
 const sim=fixture(),[west,east]=sim.agvs;
 const a=p(-462,-24),b=p(-308,-24);
 moveAlong(west,[a,b]);
 moveAlong(east,[b,a]);
 sim.tick(.1);
 assert.ok(west.x>a.x);
 assert.equal(east.x,b.x);
 assert.equal(east.trafficBlock.resource,west.id);
 assert.equal(east.trafficBlock.reason,'ROAD_SECTION');
 assert.equal(sim.status().unsafeAgvBodyOverlaps,0);
 console.log('PASS: opposing entries share a physical section permit');
}

{
 const sim=fixture(),[first,second]=sim.agvs;
 const dock=sim.YARD_AGV_BAYS[0];
 Object.assign(first,p(dock[0].x,dock[0].z),{heading:0});
 Object.assign(second,p(dock[1].x,dock[1].z),{heading:0});
 for(const v of [first,second]){
  v.route=sim.routing.planAGV(v,'sts',sim.sts[0]);
  assertDirectedRoute(sim,v.route);
  assert.ok(v.route[1].reverse);
  Object.assign(v,{routeIndex:1,routeVersion:1,state:'TRAVEL'});
 }
 putCargoOn(sim,first);
 tick(sim,20);
 assert.ok(first.x<dock[0].x);
 assert.equal(first.heading,0,'loaded chassis stays aligned while backing out of the bay');
 assert.equal(second.x,dock[1].x,'neighbor waits in its bay while the service aisle is in use');
 assert.equal(second.trafficBlock.reason,'SERVICE_AREA');
 tick(sim,180);
 assert.ok(second.x<dock[1].x,'service-area ownership passes after the first vehicle clears');
 assert.equal(sim.status().unsafeAgvBodyOverlaps,0);
 console.log('PASS: protected yard aisle, aligned loaded reverse and safe release to the next bay');
}
