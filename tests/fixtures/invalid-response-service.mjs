import {overview} from './service-overview.mjs';
import readline from 'node:readline';
let invalid=true;
for await(const line of readline.createInterface({input:process.stdin})){
  const request=JSON.parse(line);
  const result=request.method==='health'?(process.argv.includes('--invalid-health')?{protocolVersion:2,privateValue:'SYNTHETIC_PRIVATE_HEALTH'}:process.argv.includes('--stale-contract')?{...overview,contractFingerprint:'0'.repeat(64)}:overview):invalid?{privateValue:'SYNTHETIC_PRIVATE_RESPONSE'}:[];
  if(request.method!=='health')invalid=false;
  process.stdout.write(JSON.stringify({dataAsOf:null,sourceVersion:null,requestId:request.requestId,result})+'\n');
}
