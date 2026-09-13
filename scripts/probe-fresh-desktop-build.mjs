import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(),base=path.join(root,'.runtime/tests');fs.mkdirSync(base,{recursive:true});
const directory=fs.mkdtempSync(path.join(base,'fresh-desktop-'));
// Copy only source/config inputs. Dependencies resolve from the existing ancestor
// node_modules; this is intentionally not a clean-machine installation test.
for(const entry of ['apps','packages','scripts','package.json','package-lock.json','tsconfig.json'])fs.cpSync(path.join(root,entry),path.join(directory,entry),{recursive:true});
assert.equal(fs.existsSync(path.join(directory,'dist')),false);
const env={PATH:''};for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
const result=spawnSync(process.execPath,[path.join(directory,'scripts/build-desktop.mjs')],{cwd:directory,env,stdio:'inherit',windowsHide:true});
assert.equal(result.status,0,'Fresh desktop build failed');
const files=['dist/main/main.cjs','dist/main/preload.cjs','dist/renderer/index.html','dist/tools/mcp-server.mjs'];
const outputs=files.map(file=>({file,bytes:fs.statSync(path.join(directory,file)).size,sha256:createHash('sha256').update(fs.readFileSync(path.join(directory,file))).digest('hex')}));
const record={createdAt:new Date().toISOString(),directory,node:process.version,nodeExecutable:process.execPath,pathEmpty:true,preexistingDist:false,sharedAncestorNodeModules:true,pythonServiceBuilt:false,passed:true,outputs};
fs.writeFileSync(path.join(root,'validation/fresh-desktop-build.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
