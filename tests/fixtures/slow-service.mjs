import {overview} from './service-overview.mjs';
// Protocol fixture deliberately stays alive after stdin EOF to exercise forced shutdown.
import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin});
lines.on('line',line=>{const request=JSON.parse(line);process.stdout.write(JSON.stringify({dataAsOf:null,sourceVersion:null,requestId:request.requestId,result:overview})+'\n')});
setInterval(()=>{},1000);
