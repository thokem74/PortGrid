'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path');
const tests=['source-parity.test.js','control.unit.test.js','reliability.unit.test.js','traffic.test.js','physical-faults.test.js','sts-supply.test.js','transfer-ownership.test.js'];
const scenarios=['complete-small-seed3','complete-small-seed7','normal-load-first-service',...[3,7,11].map(seed=>'complete-normal-seed'+seed)];
if(process.argv.includes('--extended'))scenarios.push('temporary-yard-outage','blocked-parking-release','complete-high-seed3','continuous-small-seed7','loaded-delivery-outage','full-storage-recovery',...[3,7,11].map(seed=>'continuous-normal-seed'+seed));
let failures=0;
for(const args of [...tests.map(file=>[file]),...scenarios.map(name=>['integration.acceptance.js',name])]){
 const result=spawnSync(process.execPath,[path.join(__dirname,args[0]),...args.slice(1)],{stdio:'inherit'});
 if(result.status!==0){failures++;console.error('FAILED',args.join(' '),result.error||result.signal||result.status);}
}
process.exitCode=failures?1:0;
