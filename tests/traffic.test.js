'use strict';
const assert=require('node:assert/strict'),createEngine=require('../portgrid-engine');
const sim=createEngine({rng:()=>.5,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});
const a=sim.agvs[2],b=sim.agvs[14];
Object.assign(a,{x:-275,z:-72,heading:Math.PI/2,stageBay:null,route:[],state:'RETURNING'});
Object.assign(b,{x:-264,z:-72,heading:Math.PI,route:[],state:'DOCKED'});
const path=sim.routing.planAGV(a,'parking');
assert.ok(path.length>1);
assert.ok(Math.abs(path[1].x-a.x)<.1,'escape must preserve vertical body orientation while adjacent loaded vehicle blocks rotation');
assert.notEqual(path[1].z,a.z,'escape makes physical progress on a connected graph edge');
assert.ok(sim.agvGuideGraph.edges.get('-275,-72').some(e=>e.to===`${path[1].x},${path[1].z}`));
console.log('PASS: quay turn escape uses an executable graph edge');
Object.assign(a,{x:-308,z:0,heading:Math.PI/2,load:null,route:[{x:-308,z:0},{x:-378,z:0}],routeIndex:1});
Object.assign(b,{x:-297,z:0,heading:Math.PI,route:[],load:'test-load'});
const escape=sim.routing.planEscape(a);
assert.ok(escape,'parking-return cycle has a physical escape');
assert.equal(escape.x,-308);
assert.ok(Math.abs(escape.z)===12);
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
for(const [v,z] of [[rear,60],[front,75]])Object.assign(v,{x:317,z,heading:Math.PI/2,pending:'FIXTURE',job:null,state:'TRAVEL',route:[{x:317,z},{x:317,z:200}],routeIndex:1});
for(let i=0;i<20;i++)convoy.tick(.1);
assert.ok(front.z>76,'permit holder must let a physically leading truck clear');
assert.ok(front.z-rear.z>=13,'truck separation remains enforced during permit transfer');
assert.ok(convoy.eventCounts.TRUCK_PERMIT_TRANSFER>0);
console.log('PASS: truck journey permit transfers to physical blocker');
const reverse=convoy.routing.reverseTruckRoute({x:297,z:100,routeIndex:2,
 route:[{x:348,z:123},{x:297,z:123},{x:297,z:92},{x:221,z:92}]});
assert.deepEqual(reverse,[{x:297,z:100},{x:297,z:123},{x:348,z:123}],
 'truck recovery reverses the traversed route instead of cutting across occupied gate pockets');
console.log('PASS: truck recovery retraces the physical approach');
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
 Object.assign(empty,{x:-244,z:12,heading:0,load:null,route:[{x:-244,z:36},{x:-244,z:12},{x:-242,z:12}],routeIndex:2});
 Object.assign(loaded,{x:-231,z:8,heading:Math.PI/2,load:'FIXTURE',route:[{x:-231,z:0},{x:-231,z:12}],routeIndex:1});
 assert.deepEqual(sim.routing.planEscape(empty),{x:-244,z:36},'directed connector can retreat over its actual incoming edge');
 Object.assign(empty,{x:-121,z:12,heading:Math.PI/2,route:[{x:-121,z:12},{x:-110,z:12}],routeIndex:1});
 Object.assign(loaded,{x:-121,z:-24,heading:Math.PI/2,load:null,route:[{x:-121,z:-24},{x:-121,z:0}],routeIndex:1});
 const escape=sim.routing.planEscape(empty);
 assert.ok(!escape||escape.x!==-121||escape.z!==0,'an escape cannot enter a converging AGV approach');
 console.log('PASS: connector retreat and predictive escape conflict checks');
}
{
 const sim=createEngine({rng:()=>.5,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});
 const v=sim.agvs[0];Object.assign(v,{x:-221,z:81.5,heading:0,route:[],state:'AVAILABLE'});
 // Saturate the quay's route costs. Parking must still be excluded as a
 // shortcut between two terminal destinations.
 for(let i=1;i<sim.agvs.length;i++)Object.assign(sim.agvs[i],{x:-297+i*11,z:12,route:[{x:-297+i*11,z:12},{x:-308+i*11,z:12}],routeIndex:1});
 const path=sim.routing.planAGV(v,'sts',sim.sts[8]);
 assert.ok(path.every(p=>p.x>=-330),'terminal transport cannot bypass traffic through parking');
 assert.ok(path.every((p,i)=>i<2||i===path.length-1||p.x!==path[i-2].x||p.z!==path[i-2].z),'route contains no intermediate dead-end spur');
 Object.assign(v,{x:-350,z:-12,state:'RETURNING',route:[]});
 const home=sim.routing.planAGV(v,'parking');
 assert.equal(home[1].x,-426,'an AGV already on its return connector continues toward home');
 console.log('PASS: terminal routes exclude parking bypasses and preserve parking return direction');
}
