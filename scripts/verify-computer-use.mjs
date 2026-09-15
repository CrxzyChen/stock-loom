import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export function verifyComputerUse(record,{native=record.native,javascript=record.javascript}={}){
 if(record.schemaVersion!==1||!Array.isArray(record.files)||!record.files.length)throw Error('Computer Use build record missing');
 const expected=new Set();let bytes=0;
 for(const entry of record.files){
  const [kind,...parts]=entry.file.split('/');
  if(!['native','javascript'].includes(kind)||parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\'))||path.isAbsolute(entry.file))throw Error('Invalid Computer Use manifest path');
  let file=kind==='native'?native:javascript;
  if(fs.lstatSync(file).isSymbolicLink())throw Error('Computer Use root is linked');
  for(const part of parts){file=path.join(file,part);if(fs.lstatSync(file).isSymbolicLink())throw Error('Computer Use artifact is linked');}
  const data=fs.readFileSync(file);
  if(data.length!==entry.bytes||createHash('sha256').update(data).digest('hex')!==entry.sha256)throw Error('Computer Use artifact differs from build: '+entry.file);
  if(expected.has(entry.file.toLowerCase()))throw Error('Duplicate Computer Use artifact');expected.add(entry.file.toLowerCase());bytes+=data.length;
 }
 const actual=[];
 function walk(folder,prefix){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Linked artifact');const name=prefix+'/'+entry.name;if(entry.isDirectory())walk(path.join(folder,entry.name),name);else if(entry.isFile())actual.push(name.toLowerCase());}}
 walk(native,'native');walk(javascript,'javascript');
 if(actual.length!==expected.size||actual.some(file=>!expected.has(file)))throw Error('Unlisted Computer Use artifacts');
 for(const file of ['native/stockloom.computeruse.exe','native/coreclr.dll','javascript/host-stdio.mjs','javascript/js-worker.mjs','javascript/stock-loom.extension.json','javascript/plugin/stock-loom-desktop/.codex-plugin/plugin.json','javascript/plugin/stock-loom-desktop/skills/stock-loom-desktop/skill.md'])if(!expected.has(file))throw Error('Required Computer Use runtime missing: '+file);
 if(!actual.some(file=>file.endsWith('.wasm')))throw Error('QuickJS WASM missing');
 return {files:expected.size,bytes,selfContained:true};
}
