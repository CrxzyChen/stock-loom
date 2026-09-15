import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const hash=text=>createHash('sha256').update(text).digest('hex');
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8')),items=[];
function noticeFiles(directory){
  const files=[];
  function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    const file=path.join(folder,entry.name);
    if(entry.isDirectory()&&!['node_modules','.git'].includes(entry.name))walk(file);
    else if(entry.isFile()&&(/(^|[._-])(license|licence|copying|notice)([._-]|$)/i.test(entry.name)||/thirdpartynotices/i.test(entry.name)))files.push({path:file,text:fs.readFileSync(file,'utf8')});
  }}
  walk(directory);return files;
}
for(const [directory,entry] of Object.entries(lock.packages)){
  if(!directory||entry.dev||entry.os&&!entry.os.includes('win32')||entry.cpu&&!entry.cpu.includes('x64'))continue;
  const manifest=path.join(directory,'package.json');if(!fs.existsSync(manifest))throw Error('Applicable production dependency is missing: '+directory);
  const pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
  if(pkg.version!==entry.version)throw Error('Installed package differs from lockfile: '+directory);
  const files=noticeFiles(directory);
  if(pkg.name==='pako'&&pkg.version==='1.0.11'){
    const file=path.join(directory,'lib/zlib/README');files.push({path:file,text:fs.readFileSync(file,'utf8')});
  }
  if(pkg.name==='@openai/codex'&&['0.154.0','0.154.0-win32-x64'].includes(pkg.version)){
    const source=JSON.parse(fs.readFileSync('third-party/codex-0.154.0/source.json','utf8'));
    for(const file of source.files){
      const location=path.join('third-party/codex-0.154.0',file.name),raw=fs.readFileSync(location);
      if(hash(raw)!==file.sha256)throw Error('Supplemental Codex notice checksum changed');
      files.push({path:location,text:raw.toString('utf8'),upstream:file.url});
    }
  }
  if(pkg.name==='punycode.js'&&pkg.version==='2.3.1'){const location='third-party/punycode-2.3.1/LICENSE-MIT.txt';files.push({path:location,text:fs.readFileSync(location,'utf8'),upstream:'https://github.com/mathiasbynens/punycode.js/blob/v2.3.1/LICENSE-MIT.txt'})}
  if(pkg.name==='isarray'&&pkg.version==='1.0.0'){
    const location=path.join(directory,'README.md'),text=fs.readFileSync(location,'utf8');
    if(!text.includes('Copyright (c) 2013 Julian Gruber')||!text.includes('Permission is hereby granted'))throw Error('isarray embedded license missing');
    files.push({path:location,text});
  }
  if(pkg.name==='@napi-rs/canvas-win32-x64-msvc'&&pkg.version==='0.1.100'){
    const parent=JSON.parse(fs.readFileSync('node_modules/@napi-rs/canvas/package.json','utf8'));
    if(parent.version!==pkg.version)throw Error('Canvas native notice version mismatch');
    const location='node_modules/@napi-rs/canvas/LICENSE';
    files.push({path:location,text:fs.readFileSync(location,'utf8'),upstream:'https://github.com/Brooooooklyn/canvas'});
  }
  if(pkg.name==='saxes'&&pkg.version==='5.0.1'){
    const source=JSON.parse(fs.readFileSync('third-party/saxes-5.0.1/source.json','utf8'));
    for(const file of source.files){const location=path.join('third-party/saxes-5.0.1',file.name),raw=fs.readFileSync(location);if(hash(raw)!==file.sha256)throw Error('saxes license checksum changed');files.push({path:location,text:raw.toString('utf8'),upstream:file.url})}
  }
  if(pkg.name==='chainsaw'&&pkg.version==='0.1.0'){
    const source=JSON.parse(fs.readFileSync('third-party/chainsaw-0.1.0/source.json','utf8'));
    for(const file of source.files){const location=path.join('third-party/chainsaw-0.1.0',file.name),raw=fs.readFileSync(location);if(hash(raw)!==file.sha256)throw Error('chainsaw notice checksum changed');files.push({path:location,text:raw.toString('utf8'),upstream:file.url})}
  }
  let supplementalLicense=null,licenseSource=null;
  if((pkg.name==='binary'&&pkg.version==='0.3.0')||(pkg.name==='buffers'&&pkg.version==='0.1.1')){
    const base=path.join('third-party',`${pkg.name}-${pkg.version}`),source=JSON.parse(fs.readFileSync(path.join(base,'source.json'),'utf8'));
    if(source.name!==pkg.name||source.version!==pkg.version)throw Error('Supplemental notice version mismatch');
    for(const file of source.files){const location=path.join(base,file.name),raw=fs.readFileSync(location);if(hash(raw)!==file.sha256)throw Error('Supplemental notice checksum changed');files.push({path:location,text:raw.toString('utf8'),upstream:file.url})}
    supplementalLicense=source.declaredLicense;licenseSource=source.provenance;
  }
  items.push({name:pkg.name,version:pkg.version,scope:'npm production graph',license:typeof pkg.license==='string'?pkg.license:entry.license??supplementalLicense,licenseSource,resolved:entry.resolved??null,integrity:entry.integrity??null,files});
}
const python=spawnSync(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('scripts/python-license-inventory.py')],{encoding:'utf8',windowsHide:true});
if(python.status!==0)throw Error('Python license inventory failed');items.push(...JSON.parse(python.stdout));
const desktopNative=spawnSync(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('scripts/computer-use-license-inventory.py')],{encoding:'utf8',windowsHide:true});
if(desktopNative.status!==0)throw Error('Computer Use license inventory failed: '+desktopNative.stderr);items.push(...JSON.parse(desktopNative.stdout));
items.push({name:'Electron + Chromium',version:fs.readFileSync('node_modules/electron/dist/version','utf8').trim(),scope:'runtime',license:'See bundled texts',files:['LICENSE','LICENSES.chromium.html'].map(file=>({path:'node_modules/electron/dist/'+file,text:fs.readFileSync('node_modules/electron/dist/'+file,'utf8')}))});
const output=path.resolve('build/notices');fs.mkdirSync(path.join(output,'texts'),{recursive:true});
const native=spawnSync(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('scripts/native-runtime-inventory.py')],{encoding:'utf8',windowsHide:true});
if(native.status!==0)throw Error('Native runtime inventory failed: '+native.stderr);
const nativeInventory=JSON.parse(native.stdout);
fs.writeFileSync(path.join(output,'native-runtime.json'),JSON.stringify(nativeInventory,null,2));
for(const item of items){
  item.files=item.files.map(file=>{const digest=hash(file.text),filename=digest+(file.path.endsWith('.html')?'.html':'.txt');fs.writeFileSync(path.join(output,'texts',filename),file.text);return {source:path.basename(file.path),upstream:file.upstream??null,sha256:digest,file:'texts/'+filename}});
  item.needsReview=!item.license||!item.files.length;
}
const inventory={createdAt:new Date().toISOString(),target:'Windows x64',scope:'Installed production npm graph, named Python distributions, CPython, OpenSSL, SQLite and Electron notices; not a full binary SBOM',lockSha256:hash(fs.readFileSync('package-lock.json')),items,unresolved:['Codex Rust/native transitive notices and source provenance require separate verification','libffi, Microsoft CRT and statically linked native dependencies require binary provenance and notice review','Exact shipped dependency pruning and license obligations require release review']};
fs.writeFileSync(path.join(output,'inventory.json'),JSON.stringify(inventory,null,2));
fs.writeFileSync(path.join(output,'README.txt'),'Stock Loom third-party inventory\n\nLicense declarations are package metadata, not a legal compatibility determination.\nSee inventory.json for versions, provenance, missing-text flags and text file hashes.\nChromium notices are HTML. Other notice files are plain text.\n');
fs.appendFileSync(path.join(output,'README.txt'),'See native-runtime.json for exact frozen-service native file hashes, PE imports, local byte matches and unresolved provenance. This is not a complete binary SBOM or a redistribution approval.\n');
fs.appendFileSync(path.join(output,'README.txt'),'\n'+items.map(item=>`${item.name} ${item.version}\n  Scope: ${item.scope}\n  Declared license: ${item.license??'Not declared in metadata'}\n  Review: ${item.needsReview?'Required':'Text collected; release review pending'}\n  Texts: ${item.files.map(file=>file.file).join(', ')||'None bundled'}\n`).join('\n'));
fs.writeFileSync('validation/dependency-inventory-summary.json',JSON.stringify({createdAt:inventory.createdAt,packages:items.length,needsReview:items.filter(x=>x.needsReview).map(x=>({name:x.name,version:x.version,license:x.license,texts:x.files.length})),unresolved:inventory.unresolved},null,2));
console.log(JSON.stringify({packages:items.length,needsReview:items.filter(x=>x.needsReview).length,output}));
