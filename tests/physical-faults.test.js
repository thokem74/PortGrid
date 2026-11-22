'use strict';
const assert=require('node:assert/strict'),make=require('../portgrid-engine');
function fixture(){let seed=3;return make({rng:()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296,dischargePerCall:3,loadPerCall:2,continuousVessels:false,preloadFutureCalls:false});}
{
 const sim=fixture();let serial=0;
 // Scenario setup before the first physical tick: fill the actual AGV-side
 // inbound stacks with identified, registered containers at valid elevations.
 for(const slot of sim.yardSlots.filter(s=>s.yard<3&&s.x<=sim.L.agvStorageMaxX))while(slot.stack.length<3){
  const id='FULL-YARD-'+(++serial),level=slot.stack.length;
  const c={id,site:'yard',yard:slot.yard,slot:slot.yard+'-'+slot.bay+'-'+slot.row,x:slot.x,z:slot.z,y:1.45+level*2.8,direction:'inbound',order:null,history:[]};
  sim.containers.set(id,c);slot.stack.push(id);
 }
 sim.tick(.3);
 assert.ok(sim.control.demandOutstanding>=9,'yard fullness cannot hide vessel demand');
 assert.equal(sim.control.liveMissions,0,'no AGV may pick up without a safe storage destination');
 assert.ok(sim.control.requests.every(r=>r.reason==='NO_SAFE_YARD_DESTINATION'));
 console.log('PASS: physically full inbound storage preserves demand and prevents unsafe pickup');
}
{
 const sim=fixture();let job;
 for(let i=0;i<2000;i++){sim.tick(.1);job=sim.jobs.find(j=>j.type==='IMPORT'&&j.phase==='RAISE');if(job)break;}
 assert.ok(job,'reproduce outage during an actual attached-container lift');
 const crane=job.sts,position={...crane.hook},cargo={x:job.container.x,y:job.container.y,z:job.container.z};
 crane.downUntil=sim.time+5;
 for(let i=0;i<40;i++)sim.tick(.1);
 assert.deepEqual(crane.hook,position,'outage freezes the physical spreader');
 assert.deepEqual({x:job.container.x,y:job.container.y,z:job.container.z},cargo,'cargo remains attached without movement');
 for(let i=0;i<30;i++)sim.tick(.1);
 assert.notDeepEqual(crane.hook,position,'physical handling resumes after outage expires');
 assert.equal(sim.status().manifestViolations,0);
 console.log('PASS: mid-lift crane outage freezes and resumes physical cargo safely');
}
{
 const sim=fixture(),call=sim.vesselCalls[0],entry=call.load[0];
 const slot=sim.yardSlots.find(s=>s.yard===3&&s.x===sim.L.agvStorageMaxX-2.75&&s.stack.length&&!sim.containers.get(s.stack.at(-1)).loadCall);
 assert.ok(slot,'reproduce the real storage column at the AGV booking boundary');
 const cargo=sim.containers.get(slot.stack.at(-1)),previous=sim.containers.get(entry.container);
 previous.loadCall=null;cargo.loadCall=call.id;entry.container=cargo.id;
 for(let i=0;i<9000;i++)sim.tick(.1);
 assert.ok(cargo.history.some(e=>e.action==='STOWED'),'manifest cargo at the booking boundary must be physically retrieved and stowed');
 assert.equal(sim.status().vesselsDeparted,3);
 assert.equal(sim.status().craneRailViolations,0);
 assert.equal(sim.status().transferOwnershipViolations,0);
 console.log('PASS: boundary-column export is physically retrieved without changing its identity');
}
