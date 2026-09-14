import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {readReleaseKey} from './update-key-store.mjs';

const source=process.env.STOCK_UPDATE_SIGNING_KEY_FILE;
const backup=process.env.STOCK_UPDATE_BACKUP_FILE;
const recovery=process.env.STOCK_UPDATE_RECOVERY_FILE;
for(const file of [source,backup,recovery]){
 if(!file||!path.isAbsolute(file))throw Error('Explicit absolute key and backup paths are required.');
 const relative=path.relative(process.cwd(),file);
 if(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('Keep private key backups outside the repository.');
}
if(path.dirname(backup)===path.dirname(recovery))throw Error('Store recovery password separately from encrypted backup.');
const key=readReleaseKey(source);
if(fs.existsSync(backup)||fs.existsSync(recovery))throw Error('Backup paths already exist; do not overwrite recovery material.');
const passphrase=randomBytes(32).toString('base64url');
const encrypted=key.export({type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase});
for(const file of [backup,recovery])fs.mkdirSync(path.dirname(file),{recursive:true});
fs.writeFileSync(recovery,passphrase,{flag:'wx',mode:0o600});
fs.writeFileSync(backup,encrypted,{flag:'wx',mode:0o600});
const restored=createPrivateKey({key:fs.readFileSync(backup),passphrase:fs.readFileSync(recovery,'utf8')});
const challenge=randomBytes(32);
if(!verify(null,challenge,createPublicKey(key),sign(null,challenge,restored)))throw Error('Recovery verification failed.');
console.log('Encrypted portable backup created; recovery sign/verify passed. No secret material printed.');
