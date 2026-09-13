import {createPublicKey,verify} from 'node:crypto';
import trust from './update-trust.json' with {type:'json'};

// Provision release public keys before shipping an updater-enabled build.
// Keys from downloaded metadata are never trusted automatically.
export const updateTrust=Object.freeze(Object.fromEntries(Object.entries(trust).map(([repo,keys])=>[repo,Object.freeze(keys)])));
export function updateSigningBytes(repo,manifest){
 return Buffer.from(JSON.stringify(['stock-loom-update-v1',repo,Object.fromEntries(Object.keys(manifest).sort().map(k=>[k,manifest[k]]))]),'utf8');
}
export function verifyUpdateEnvelope(envelope,repo,trust=updateTrust){
 if(!envelope||Object.keys(envelope).sort().join(',')!=='format,keyId,payload,signature'||envelope.format!==2||typeof envelope.keyId!=='string'||!envelope.payload||typeof envelope.payload!=='object'||Array.isArray(envelope.payload)||typeof envelope.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature))throw Error('更新清单缺少有效签名。');
 const pinned=trust[repo]?.[envelope.keyId];if(!pinned)throw Error('更新签名密钥不受信任，请使用官方安装包手动更新。');
 const publicKey=createPublicKey(pinned);
 if(publicKey.asymmetricKeyType!=='ed25519'||!verify(null,updateSigningBytes(repo,envelope.payload),publicKey,Buffer.from(envelope.signature,'base64')))throw Error('更新清单签名校验失败。');
 return envelope.payload;
}
