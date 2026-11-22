/* Dependency-free Chromium/CDP smoke test. Uses a disposable browser profile. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),http=require('node:http');
const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'portgrid-browser-'));
const reports=path.join(root,'reports');fs.mkdirSync(reports,{recursive:true});
const {createHash}=require('node:crypto');
const sourceHashes=Object.fromEntries(['portgrid-engine.js','portgrid-control.js','portgrid-monitor.js','PORTGRID_Standalone.html'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
const errors=[],consoleErrors=[];let browser,socket,server;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,seconds=30){const deadline=Date.now()+seconds*1000;while(Date.now()<deadline){const result=await fn();if(result)return result;await delay(100);}throw Error('Browser condition timed out');}
async function main(){
 server=http.createServer((req,res)=>{
  if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(req.url!=='/'&&req.url!=='/PORTGRID_Standalone.html'){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(path.join(root,'PORTGRID_Standalone.html')));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=spawn(process.env.BROWSER_BIN||'/usr/bin/chromium',['--headless','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'--window-size=1600,1000','--use-angle=swiftshader','--enable-unsafe-swiftshader','about:blank'],{stdio:['ignore','ignore','pipe']});
 let browserLog='';browser.stderr.on('data',data=>{browserLog+=data;});browser.on('error',error=>errors.push(String(error)));
 const portFile=path.join(profile,'DevToolsActivePort');
 await until(()=>{if(browser.exitCode!=null)throw Error('Chromium exited: '+browserLog);return fs.existsSync(portFile);});
 const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
 const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 let seq=0;const pending=new Map();
 socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(message.error):p.resolve(message.result);}}
  else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
  else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')consoleErrors.push(message.params.args);
 };
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await send('Runtime.enable');await send('Page.enable');
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 await until(()=>evaluate('!!(window.PORTGRID && document.querySelector("#render canvas") && document.querySelector("#loading").style.display === "none")'),45);
 const start=await evaluate('({time:PORTGRID.time,positions:PORTGRID.agvs.map(v=>({x:v.x,z:v.z}))})');
 await until(async()=>await evaluate('PORTGRID.time')>start.time+15,45);
 const moved=await evaluate('PORTGRID.agvs.map(v=>({x:v.x,z:v.z}))');
 assert.ok(moved.some((v,i)=>Math.hypot(v.x-start.positions[i].x,v.z-start.positions[i].z)>1),'AGVs physically move in rendered simulation');
 const extended=process.argv.includes('--extended'),coverage={parkingExit:false,quayStand:false,yardJunction:false,truckCorridor:false};
 if(extended){
  for(const target of [60,180,360,600,900]){
   while(await evaluate('PORTGRID.time')<target){
    const sample=await evaluate(`(()=>{for(let i=0;i<100&&PORTGRID.running;i++)PORTGRID.tick(.1);
     return {running:PORTGRID.running,
      parkingExit:PORTGRID.agvs.some(v=>v.route.length&&v.x<-308&&v.z<0),
      quayStand:PORTGRID.agvs.some(v=>v.state==='DOCKED'&&PORTGRID.sts.some(q=>Math.abs(v.x-q.homeX)<.2)&&v.z<0),
      yardJunction:PORTGRID.agvs.some(v=>v.route.length&&v.x>=-328&&v.x<=-244&&v.z>=36),
      truckCorridor:PORTGRID.trucks.some(v=>v.route.length&&v.x>=221&&v.x<=317)};})()`);
    assert.ok(sample.running,'rendered engine must remain running');
    for(const key of Object.keys(coverage))coverage[key]||=sample[key];
    await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
   }
   console.log('Rendered progress',target,JSON.stringify(coverage));
  }
  assert.ok(Object.values(coverage).every(Boolean),'observe parking exits, STS stands, yard junctions and truck corridors');
 }
 for(const view of ['top','quay']){
  await evaluate(`document.querySelector('[data-view="${view}"]').click()`);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const screenshot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(reports,'browser-'+view+'.png'),Buffer.from(screenshot.data,'base64'));
 }
 const status=await evaluate('PORTGRID.diagnostics()');
 assert.equal(status.unsafeAgvBodyOverlaps,0);assert.equal(status.gridRouteFailures,0);assert.equal(status.manifestViolations,0);
 assert.equal(status.transferOwnershipViolations,0);assert.equal(status.craneRailViolations,0);assert.equal(status.eventCounts.JOB_ERROR||0,0);
 assert.equal(errors.length,0);assert.equal(consoleErrors.length,0);
 fs.writeFileSync(path.join(reports,'browser-smoke.json'),JSON.stringify({passed:true,sourceHashes,extended,coverage,time:status.time,errors,consoleErrors,status},null,2));
 console.log('PASS: Chromium rendering, top/quay cameras, actual AGV motion, console and safety smoke checks');
}
main().catch(error=>{fs.writeFileSync(path.join(reports,'browser-smoke.json'),JSON.stringify({passed:false,sourceHashes,error:String(error),errors,consoleErrors},null,2));console.error(error);process.exitCode=1;}).finally(async()=>{
 if(socket)socket.close();if(browser){browser.kill();await delay(500);}if(server)server.close();fs.rmSync(profile,{recursive:true,force:true});
});
