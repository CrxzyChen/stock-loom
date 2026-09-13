import {build} from 'esbuild';
import {build as buildVite} from 'vite';
import {buildWorkers} from './build-workers.mjs';
import fs from 'node:fs';
import {makeDesktopManifest} from './desktop-build-manifest.mjs';
import {spawnSync} from 'node:child_process';
const contracts=spawnSync(process.execPath,['scripts/generate-contracts.mjs','--check'],{stdio:'inherit',windowsHide:true});
if(contracts.status!==0)throw Error('Contract generation check failed');
await build({entryPoints:['apps/desktop/src/main/main.ts'],outfile:'dist/main/main.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await build({entryPoints:['apps/desktop/src/preload/preload.ts'],outfile:'dist/main/preload.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
const renderer=await buildVite({configFile:'apps/desktop/vite.config.ts'});
await buildWorkers();
fs.mkdirSync('build',{recursive:true});
const pdfAssets=[];
for(const folder of ['cmaps','standard_fonts','wasm']){
 const source=`node_modules/pdfjs-dist/${folder}`,target=`dist/renderer/pdf-assets/${folder}`;fs.mkdirSync(target,{recursive:true});
 for(const entry of fs.readdirSync(source,{withFileTypes:true})){if(!entry.isFile())continue;const file=`${target}/${entry.name}`;fs.copyFileSync(`${source}/${entry.name}`,file);pdfAssets.push(file)}
}
fs.writeFileSync('build/desktop-current.json',JSON.stringify(makeDesktopManifest(renderer,pdfAssets),null,2));
