import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';

if(process.platform!=='win32')throw Error('Computer Use packaging requires Windows');
const root=process.cwd(),directory=path.resolve('build/computer-use',randomUUID()),native=path.join(directory,'native'),javascript=path.join(directory,'javascript');
await fs.mkdir(directory,{recursive:true});
const dotnet=process.env.STOCK_DOTNET_BUILD??path.resolve('.runtime/dotnet10/dotnet.exe');
const sdk=spawnSync(dotnet,['--version'],{encoding:'utf8',windowsHide:true});
if(sdk.status!==0||sdk.stdout.trim()!=='10.0.401')throw Error('Computer Use build requires .NET SDK 10.0.401');
const result=spawnSync(dotnet,['publish','services/computer-use-windows/StockLoom.ComputerUse.csproj','-c','Release','-r','win-x64','--self-contained','true','-p:RestoreLockedMode=true','-o',native],{stdio:'inherit',windowsHide:true,env:{...process.env,DOTNET_CLI_HOME:path.resolve('.runtime/dotnet-home'),DOTNET_CLI_TELEMETRY_OPTOUT:'1'}});
if(result.error)throw result.error;if(result.status!==0)throw Error('Computer Use native publish failed');
const banner={js:"import {createRequire as makeRequire} from 'node:module'; const require=makeRequire(import.meta.url);"};
await build({entryPoints:['packages/computer-use/host-stdio.mjs'],outfile:path.join(javascript,'host-stdio.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',banner});
await build({entryPoints:['packages/computer-use/js-worker.mjs'],outfile:path.join(javascript,'js-worker.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',external:['quickjs-emscripten']});
const packages=new Map(),require=createRequire(path.join(root,'package.json'));
async function copyPackage(name,resolve=require){
 let manifest,pkg,folder=path.dirname(resolve.resolve(name));
 while(!manifest){
  try{const candidate=JSON.parse(await fs.readFile(path.join(folder,'package.json'),'utf8'));if(candidate.name===name){manifest=path.join(folder,'package.json');pkg=candidate;break;}}catch(error){if(error.code!=='ENOENT')throw error;}
  const parent=path.dirname(folder);if(parent===folder)throw Error('Cannot locate package metadata: '+name);folder=parent;
 }
 if(packages.has(name)){if(packages.get(name)!==pkg.version)throw Error('Conflicting Computer Use dependency: '+name);return;}
 packages.set(name,pkg.version);
 const source=path.dirname(manifest),target=path.join(javascript,'node_modules',name);
 await fs.cp(source,target,{recursive:true,filter:async file=>{if((await fs.lstat(file)).isSymbolicLink())throw Error('Dependency symlink is not allowed: '+name);return true;}});
 for(const dependency of Object.keys(pkg.dependencies??{}))await copyPackage(dependency,createRequire(manifest));
}
await copyPackage('quickjs-emscripten');
await fs.cp('packages/computer-use/plugin',path.join(javascript,'plugin'),{recursive:true});
await fs.copyFile('packages/computer-use/stock-loom.extension.json',path.join(javascript,'stock-loom.extension.json'));
const files=[];
async function collect(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isSymbolicLink())throw Error('Unexpected build link');if(entry.isDirectory())await collect(file);else if(entry.isFile()){const data=await fs.readFile(file);files.push({file:path.relative(directory,file).replaceAll('\\','/'),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}}}
await collect(directory);
const record={schemaVersion:1,createdAt:new Date().toISOString(),directory,native,javascript,packages:[...packages].map(([name,version])=>({name,version})),files};
await fs.writeFile('build/computer-use-current.json',JSON.stringify(record,null,2));
console.log(JSON.stringify({directory,files:files.length,bytes:files.reduce((sum,f)=>sum+f.bytes,0),packages:record.packages}));
