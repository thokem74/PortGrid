'use strict';
const assert=require('node:assert/strict'),createEngine=require('../portgrid-engine');
const sim=createEngine({rng:()=>.5,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});
const a=sim.agvs[2],b=sim.agvs[14];
const quayExit=sim.sts[0].homeX-sim.agvGuideGraph.quayTravelPitch/2;
Object.assign(a,{x:quayExit,z:-72,heading:Math.PI/2,stageBay:null,route:[],state:'RETURNING'});
Object.assign(b,{x:quayExit+11,z:-72,heading:Math.PI,route:[],state:'DOCKED'});
const path=sim.routing.planAGV(a,'parking');
assert.ok(path.length>1);
assert.ok(Math.abs(path[1].x-a.x)<.1,'escape must preserve vertical body orientation while adjacent loaded vehicle blocks rotation');
assert.notEqual(path[1].z,a.z,'escape makes physical progress on a connected graph edge');
assert.ok(sim.agvGuideGraph.edges.get(`${quayExit},-72`).some(e=>e.to===`${path[1].x},${path[1].z}`));
console.log('PASS: quay turn escape uses an executable graph edge');
Object.assign(a,{x:-308,z:0,heading:Math.PI/2,load:null,route:[{x:-308,z:0},{x:-378,z:0}],routeIndex:1});
Object.assign(b,{x:-297,z:0,heading:Math.PI,route:[],load:'test-load'});
const escape=sim.routing.planEscape(a);
assert.ok(escape,'parking-return cycle has a physical escape');
assert.equal(escape.x,-308);
assert.ok(sim.agvGuideGraph.edges.get('-308,0').some(edge=>edge.to===escape.x+','+escape.z));
assert.equal(sim.routing.planEscape({...a,load:'loaded'}),null,'loaded traffic is never forced into this empty-vehicle recovery');
console.log('PASS: parking return escape follows an adjacent graph edge');
const dock=sim.YARD_AGV_BAYS[0];
Object.assign(a,{x:dock[0].x,z:dock[0].z,heading:0,stageBay:null,queueBay:dock[0]});
Object.assign(b,{x:dock[2].x,z:dock[2].z,heading:0,stageBay:null,queueBay:dock[2]});
assert.equal(sim.resources.availableDockBay('agv',0,sim.agvs[0]),dock[1],
 '7 m bay pitch safely accommodates the 5.3 m inflated AGV width');
console.log('PASS: yard admission uses physical body envelopes for adjacent bays');
const truckBays=sim.YARD_TRUCK_BAYS[0],truck=sim.trucks[0];
Object.assign(truck,{x:truckBays[0].x,z:truckBays[0].z,queueBay:truckBays[0],stageBay:null});
assert.equal(sim.resources.availableDockBay('truck',0,sim.trucks[1]),truckBays[2],
 'truck bay admission must preserve the traffic guard 13 m separation');
console.log('PASS: truck bay admission agrees with its traffic safety envelope');
const convoy=createEngine({rng:()=>.5,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});
const [rear,front]=convoy.trucks;
const trunkX=convoy.L.truckOutX, rearZ=convoy.L.yards[0].z;
const endZ=convoy.YARD_TRUCK_BAYS[1][0].z;
for(const [v,z] of [[rear,rearZ],[front,rearZ+15]]){
 Object.assign(v,{x:trunkX,z,heading:Math.PI/2,pending:'FIXTURE',job:null,state:'TRAVEL',
  route:[{x:trunkX,z},{x:trunkX,z:endZ}],routeIndex:1});
}
for(let i=0;i<20;i++)convoy.tick(.1);
assert.ok(front.z>rearZ+16,'permit holder must let a physically leading truck clear');
assert.ok(front.z-rear.z>=13,'truck separation remains enforced during permit transfer');
assert.ok(convoy.eventCounts.TRUCK_PERMIT_TRANSFER>0);
console.log('PASS: truck journey permit transfers to physical blocker');
const reverse=convoy.routing.reverseTruckRoute({x:297,z:100,routeIndex:2,
 route:[{x:348,z:123},{x:297,z:123},{x:297,z:92},{x:221,z:92}]});
assert.deepEqual(reverse,[{x:297,z:100},{x:297,z:123},{x:348,z:123}],
 'truck recovery reverses the traversed route instead of cutting across occupied gate pockets');
console.log('PASS: truck recovery retraces the physical approach');
{
 const sim=createEngine({rng:()=>.5,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});
 const a=sim.trucks[6],b=sim.trucks[10],x=sim.L.truckInX;
 for(const v of sim.trucks)if(v!==a&&v!==b)v.pending='FIXTURE';
 const aBay=sim.YARD_TRUCK_BAYS[1][0],bBay=sim.YARD_TRUCK_BAYS[0][2];
 Object.assign(a,{x:x+2.4,z:a.home.z,heading:Math.PI,pending:'FIXTURE',job:'FIXTURE',state:'TRAVEL',blockedTime:10,
  route:[a.home,{x,z:a.home.z},{x,z:aBay.z},aBay],routeIndex:1,routeIntent:{type:'truck-yard',crane:{dockZ:aBay.z}}});
 Object.assign(b,{x,z:a.home.z+12.8,heading:-Math.PI/2,pending:'FIXTURE',job:'FIXTURE',state:'TRAVEL',blockedTime:10,
  route:[b.home,{x,z:b.home.z},{x,z:bBay.z},bBay],routeIndex:2,routeIntent:{type:'truck-yard',crane:{dockZ:bBay.z}}});
 for(let i=0;i<400;i++)sim.tick(.1);
 assert.ok(sim.eventCounts.TRUCK_GATE_PHYSICAL_YIELD>0,'two inbound trucks in a wait cycle can physically retreat');
 assert.ok(b.x<x-7||b.z<a.home.z-3,'the other truck clears its formerly blocked turn');
 console.log('PASS: inbound/inbound truck wait cycle has bounded physical recovery');
}
const longConnector=createEngine({rng:()=>.5,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});
const empty=longConnector.agvs[14],loaded=longConnector.agvs[4];
// A real unbooked yard container is placed on the stationary blocker as
// fixture setup. Preserve the inventory and its sole physical carrier.
const slot=longConnector.yardSlots.find(s=>s.yard<3&&s.stack.length),cargo=longConnector.containers.get(slot.stack.pop());
Object.assign(cargo,{site:'agv',carrier:loaded,x:-304.5,z:-36,y:3.65});
Object.assign(loaded,{x:-304.5,z:-36,heading:Math.PI,load:cargo.id,speed:0,pending:'FIXTURE',job:null,state:'TRAVEL',blockedTime:10,
 route:[{x:-297,z:-36},{x:-308,z:-36}],routeIndex:1,routeIntent:{type:'yard',crane:longConnector.rtgs[0]}});
Object.assign(empty,{x:-319.5,z:-36,heading:0,load:null,pending:'FIXTURE',job:null,state:'TRAVEL',blockedTime:10,
 route:[{x:-414,z:-36},{x:-308,z:-36}],routeIndex:1,routeIntent:{type:'sts',crane:longConnector.sts[0]}});
for(let i=0;i<10;i++)longConnector.tick(.1);
assert.ok(empty.x<-320,'empty AGV reverses physically on the long parking connector');
assert.ok(longConnector.eventCounts.AGV_PHYSICAL_YIELD>0);
assert.equal(longConnector.status().unsafeAgvBodyOverlaps,0);
console.log('PASS: long parking connector does not suppress safe physical reverse');
{
 const sim=createEngine({rng:()=>.5,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});
 const [empty,loaded]=sim.agvs;
 Object.assign(empty,{x:-272,z:162,heading:0,load:null,route:[{x:-272,z:108},{x:-272,z:162},{x:-236,z:162}],routeIndex:2});
 Object.assign(loaded,{x:-236,z:157,heading:Math.PI/2,load:'FIXTURE',route:[{x:-236,z:108},{x:-236,z:162}],routeIndex:1});
 const retreat=sim.routing.planEscape(empty);
 assert.deepEqual({x:retreat?.x,z:retreat?.z},{x:-272,z:108},'directed connector can retreat over its actual incoming edge');
 Object.assign(empty,{x:-308,z:-12,heading:Math.PI/2,route:[{x:-308,z:-12},{x:-426,z:-12}],routeIndex:1});
 Object.assign(loaded,{x:-308,z:12,heading:-Math.PI/2,load:null,route:[{x:-308,z:36},{x:-308,z:0}],routeIndex:1});
 const escape=sim.routing.planEscape(empty);
 assert.ok(!escape||escape.x!==-308||escape.z!==0,'an escape cannot enter a converging AGV approach');
 console.log('PASS: connector retreat and predictive escape conflict checks');
}
{
 const sim=createEngine({rng:()=>.5,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});
 const v=sim.agvs[0], bay=sim.YARD_AGV_BAYS[0][0];
 Object.assign(v,{x:bay.x,z:bay.z,heading:0,route:[],state:'AVAILABLE'});
 // Saturate the quay's route costs. Parking must still be excluded as a
 // shortcut between two terminal destinations.
 for(let i=1;i<sim.agvs.length;i++){
  const columns=sim.agvGuideGraph.columns,x=columns[i%(columns.length-1)];
  Object.assign(sim.agvs[i],{x,z:36,route:[{x,z:36},{x:x+36,z:36}],routeIndex:1});
 }
 const path=sim.routing.planAGV(v,'sts',sim.sts[8]);
 assert.ok(path.every(p=>p.x>=-330),'terminal transport cannot bypass traffic through parking');
 assert.ok(path.every(p=>p.z>=0||p.x===sim.sts[8].homeX+sim.agvGuideGraph.quayTravelPitch/2||p.x===sim.sts[8].homeX),
  'through travel cannot enter another crane handover corridor');
 assert.ok(path.every((p,i)=>i<2||i===path.length-1||p.x!==path[i-2].x||p.z!==path[i-2].z),'route contains no intermediate dead-end spur');
 Object.assign(v,{x:-350,z:-12,state:'RETURNING',route:[]});
 const home=sim.routing.planAGV(v,'parking');
 assert.equal(home[1].x,-426,'an AGV already on its return connector continues toward home');
 console.log('PASS: terminal routes exclude parking bypasses and preserve parking return direction');
}
{
 const sim=createEngine({rng:()=>.5,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});
 const front=sim.agvs[22],rear=sim.agvs[23];
 Object.assign(front,{x:-308,z:0,heading:Math.PI/2,pending:'FIXTURE',job:null,state:'RETURNING',blockedTime:10,
  route:[{x:-308,z:-12},{x:-308,z:0},{x:-378,z:0}],routeIndex:2,routeIntent:{type:'parking'}});
 Object.assign(rear,{x:-297.5,z:0,heading:Math.PI,pending:'FIXTURE',job:null,state:'RETURNING',blockedTime:10,
  route:[{x:-236,z:0},{x:-272,z:0},{x:-308,z:0},{x:-378,z:0}],routeIndex:2,routeIntent:{type:'parking'}});
 for(let i=0;i<100;i++)sim.tick(.1);
 assert.ok(sim.eventCounts.AGV_PHYSICAL_YIELD>0,'empty follower backs away to permit a leading turn');
 assert.ok(front.x<-310,'the leading AGV clears the parking merge');
 assert.equal(sim.status().unsafeAgvBodyOverlaps,0);
 console.log('PASS: follower reverses over sufficient traversed nodes to release a leading turn');
}
{
 const sim=createEngine({rng:()=>.5,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});
 const a=sim.trucks[0],b=sim.trucks[6],x=sim.L.truckOutX;
 for(const v of sim.trucks)if(v!==a&&v!==b)v.pending='FIXTURE';
 const aBay=sim.YARD_TRUCK_BAYS[0][2],bBay=sim.YARD_TRUCK_BAYS[0][0];
 Object.assign(a,{x:x-2.4,z:aBay.z,heading:0,pending:'FIXTURE',job:null,state:'RETURNING',blockedTime:10,
  route:[aBay,{x,z:aBay.z},{x,z:a.home.z},a.home],routeIndex:1,routeIntent:{type:'gate'}});
 Object.assign(b,{x,z:aBay.z-12.8,heading:Math.PI/2,pending:'FIXTURE',job:null,state:'RETURNING',blockedTime:10,
  route:[bBay,{x,z:bBay.z},{x,z:b.home.z},b.home],routeIndex:2,routeIntent:{type:'gate'}});
 for(let i=0;i<400;i++)sim.tick(.1);
 assert.ok(sim.eventCounts.TRUCK_RETURN_PHYSICAL_YIELD>0,'returning trucks can clear their own wait cycle without holding an RTG');
 assert.ok(b.z>aBay.z+4,'the other returning truck clears the blocked crossing');
 console.log('PASS: returning truck pair recovers along the traversed approach');
}
for(const crossingTurn of [false,true]){
 const sim=createEngine({rng:()=>.5,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});
 for(const v of sim.agvs)v.pending='FIXTURE';
 const [merge,through]=sim.agvs;
 for(const v of [merge,through]){
  const slot=sim.yardSlots.find(s=>s.yard<3&&s.stack.length),c=sim.containers.get(slot.stack.pop());
  Object.assign(c,{site:'agv',carrier:v,y:3.65});v.load=c.id;
 }
 const route=(vehicle,coordinates,heading)=>{
  const path=coordinates.map(([x,z])=>({x,z}));
  Object.assign(vehicle,{...path[0],heading,state:'TRAVEL',route:path,routeIndex:1});
 };
 route(merge,[[-164,108],[-164,72],[-164,36],[-164,0],[-200,0],[-236,0]],-Math.PI/2);
 route(through,crossingTurn?
  [[-92,0],[-128,0],[-164,0],[-200,0],[-200,36],[-164,36]]:
  [[-92,0],[-128,0],[-164,0],[-200,0],[-236,0],[-272,0]],Math.PI);
 for(let i=0;i<200;i++)sim.tick(.1);
 assert.ok(merge.x<=-236&&(crossingTurn?through.z>=36:through.x<=-272),
  'loaded crossing traffic and a perpendicular merge both clear');
 assert.equal(sim.status().unsafeAgvBodyOverlaps,0);
 assert.ok(sim.eventCounts.TURN_RESERVED>0&&sim.eventCounts.TURN_RELEASED>0,'turn space has finite physical ownership');
 console.log('PASS: loaded merge/crossing turn reserves and releases swept clearance',crossingTurn);
}
