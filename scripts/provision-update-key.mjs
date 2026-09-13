import fs from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync,createPublicKey} from 'node:crypto';
import {protectKey,readReleaseKey} from './update-key-store.mjs';
import {repository} from '../apps/desktop/src/main/updates.mjs';

const file=process.env.STOCK_UPDATE_SIGNING_KEY_FILE,keyId=process.env.STOCK_UPDATE_SIGNING_KEY_ID;
const repo=repository(process.env.STOCK_UPDATE_REPOSITORY??'CrxzyChen/stock-loom');
if(!file||!path.isAbsolute(file)||!file.endsWith('.dpapi.json')||!keyId||!/^[a-zA-Z0-9_-]{1,64}$/.test(keyId))throw Error('Set an absolute .dpapi.json signing-key path and a valid key ID.');
const relative=path.relative(process.cwd(),file);
if(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('Keep the release private key outside the source workspace.');
if(!fs.existsSync(file)){
 const pair=generateKeyPairSync('ed25519'),der=pair.privateKey.export({type:'pkcs8',format:'der'});
 try{const protectedKey=protectKey(der).toString('base64');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({format:1,keyId,repo,protectedKey}),{flag:'wx'})}finally{der.fill(0)}
}
const stored=JSON.parse(fs.readFileSync(file));if(stored.keyId!==keyId||stored.repo!==repo)throw Error('Stored key identity does not match requested identity.');
const publicKey=createPublicKey(readReleaseKey(file)).export({type:'spki',format:'pem'});
const trustFile='apps/desktop/src/main/update-trust.json';const trust=fs.existsSync(trustFile)?JSON.parse(fs.readFileSync(trustFile)):{};
if(trust[repo]?.[keyId]&&trust[repo][keyId]!==publicKey)throw Error('Existing pinned key must not be overwritten.');
trust[repo]={...trust[repo],[keyId]:publicKey};fs.writeFileSync(trustFile,JSON.stringify(trust,null,2)+'\n');
console.log('Pinned public release key. Private key remains DPAPI-protected outside the workspace.');
