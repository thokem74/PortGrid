'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),file=path.join(root,'PORTGRID_Standalone.html');
let html=fs.readFileSync(file,'utf8');
for(const [id,name] of [['control-layer','portgrid-control.js'],['monitor-layer','portgrid-monitor.js'],['engine','portgrid-engine.js']]){
 const source=fs.readFileSync(path.join(root,name),'utf8').trim();
 const pattern=new RegExp('(<script id="'+id+'"[^>]*>)([\\s\\S]*?)(</script>)');
 if(!pattern.test(html)){
  assert.ok(!process.argv.includes('--check'),'missing embedded '+id);
  html=html.replace('<script id="engine"',`<script id="${id}">\n${source}\n</script>\n<script id="engine"`);
 }else if(process.argv.includes('--check'))assert.equal(html.match(pattern)[2].trim(),source,'stale embedded '+id);
 else html=html.replace(pattern,(_,open,old,close)=>open+'\n'+source+'\n'+close);
}
if(!process.argv.includes('--check'))fs.writeFileSync(file,html);
console.log(process.argv.includes('--check')?'Embedded sources match':'Embedded sources updated');
