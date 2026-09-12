import {overview} from './service-overview.mjs';
import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin});
function reply(id,result){process.stdout.write(JSON.stringify({dataAsOf:null,sourceVersion:null,requestId:id,result})+'\n')}
lines.on('line',line=>{
  const {requestId:id,method,params}=JSON.parse(line);
  if(method==='health')reply(id,overview);
  else if(process.argv.includes("--malformed"))process.stdout.write('invalid protocol\n');
  else if(method==='backup.restore')setTimeout(()=>process.exit(0),80);
  else setTimeout(()=>reply(id,method==='backup.create'?{path:'synthetic',files:1,bytes:1,sha256:'synthetic',createdAt:'synthetic'}:method==='storage.compact'?{converted:1,bundles:1,alreadyBundled:0,retainedOriginals:true}:{completed:true}),120);
});
