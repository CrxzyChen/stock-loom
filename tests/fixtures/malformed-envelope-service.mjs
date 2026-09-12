import readline from 'node:readline';
import {overview} from './service-overview.mjs';
for await(const line of readline.createInterface({input:process.stdin})){
  const {requestId:id,method}=JSON.parse(line);
  let response={requestId:id,result:overview,dataAsOf:null,sourceVersion:null};
  if(method!=='health'){
    const mode=process.argv[2];
    response=mode==='legacy'?{id,result:[]}:mode==='both'?{requestId:id,result:[],error:{code:'BAD',message:'SYNTHETIC_PRIVATE'}}:
      mode==='missing'?{requestId:id}:mode==='null'?null:
      {requestId:id,error:{code:'BAD',message:{private:'SYNTHETIC_PRIVATE'}}};
  }
  if(response!==null)response={dataAsOf:null,sourceVersion:null,...response};
  if(method!=='health'&&process.argv[2]==='bad-metadata')response={requestId:id,result:[],dataAsOf:123,sourceVersion:null};
  process.stdout.write(JSON.stringify(response)+'\n');
}
