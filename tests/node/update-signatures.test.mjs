import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync,sign} from 'node:crypto';
import {updateSigningBytes,verifyUpdateEnvelope} from '../../apps/desktop/src/main/update-signatures.mjs';
const pair=generateKeyPairSync('ed25519'),repo='owner/repo',trust={[repo]:{v1:pair.publicKey.export({type:'spki',format:'pem'})}};
const payload={version:'0.2.0',sha256:'a'.repeat(64),minDataSchema:5};
const envelope=()=>({format:2,keyId:'v1',payload:{...payload},signature:sign(null,updateSigningBytes(repo,payload),pair.privateKey).toString('base64')});
test('signed metadata binds repository, package hash and compatibility; unsigned or unknown keys fail closed',()=>{
 assert.deepEqual(verifyUpdateEnvelope(envelope(),repo,trust),payload);
 for(const field of ['version','sha256','minDataSchema']){const e=envelope();e.payload[field]=field==='minDataSchema'?1:'changed';assert.throws(()=>verifyUpdateEnvelope(e,repo,trust),/签名校验/)}
 assert.throws(()=>verifyUpdateEnvelope(envelope(),'other/repo',{'other/repo':trust[repo]}),/签名校验/);
 assert.throws(()=>verifyUpdateEnvelope(payload,repo,trust),/缺少有效签名/);
 assert.throws(()=>verifyUpdateEnvelope({...envelope(),keyId:'v2'},repo,trust),/不受信任/);
 assert.throws(()=>verifyUpdateEnvelope(envelope(),repo),/不受信任/);
});
test('key rotation requires a previously shipped trusted key and revoked keys are rejected',()=>{
 const second=generateKeyPairSync('ed25519'),e=envelope();e.keyId='v2';e.signature=sign(null,updateSigningBytes(repo,payload),second.privateKey).toString('base64');const rotated={[repo]:{...trust[repo],v2:second.publicKey.export({type:'spki',format:'pem'})}};
 assert.deepEqual(verifyUpdateEnvelope(e,repo,rotated),payload);
 assert.throws(()=>verifyUpdateEnvelope(envelope(),repo,{[repo]:{v2:rotated[repo].v2}}),/不受信任/);
});
