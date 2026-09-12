import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ServiceClient} from '../apps/desktop/src/main/service-client.mjs';
import {CONTRACT_FINGERPRINT} from '../packages/contracts/generated-runtime.mjs';
export async function verifyPackagedService(binary){
  const base=path.resolve('.runtime/tests');await fs.mkdir(base,{recursive:true});
  const directory=await fs.mkdtemp(path.join(base,'packaged-handshake-'));
  const systemRoot=process.env.SystemRoot??process.env.SYSTEMROOT;
  if(!systemRoot||!path.isAbsolute(systemRoot))throw Error('Missing Windows system directory');
  const env={...process.env};
  for(const key of Object.keys(env))if(['PATH','PYTHONHOME','PYTHONPATH'].includes(key.toUpperCase()))delete env[key];
  env.PATH=[path.dirname(binary),path.join(systemRoot,'System32'),systemRoot].join(path.delimiter);
  const service=new ServiceClient(binary,['--data-dir',directory],{env});
  try{
    const health=await service.start();
    return {createdAt:new Date().toISOString(),binary,sha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),contractFingerprint:CONTRACT_FINGERPRINT,protocolVersion:health.protocolVersion,schemaVersion:health.schemaVersion,systemPathOnly:true,fixture:directory,passed:true};
  }finally{await service.stop()}
}
