'use strict';
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
execFileSync(process.execPath,[path.join(__dirname,'../scripts/embed.js'),'--check'],{stdio:'inherit'});
const html=fs.readFileSync(path.join(__dirname,'../PORTGRID_Standalone.html'),'utf8');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'portgrid-syntax-'));
try{
 for(const id of ['control-layer','monitor-layer','engine','sceneModule']){
  const code=html.match(new RegExp('<script[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)</script>'))[1];
  const file=path.join(temporary,id+(id==='sceneModule'?'.mjs':'.js'));
  fs.writeFileSync(file,code);execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
console.log('PASS: all embedded scripts parse and match source modules');
