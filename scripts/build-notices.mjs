import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const hash=text=>createHash('sha256').update(text).digest('hex');
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8')),items=[];
for(const [directory,entry] of Object.entries(lock.packages)){
  if(!directory||entry.dev||entry.os&&!entry.os.includes('win32')||entry.cpu&&!entry.cpu.includes('x64'))continue;
  const manifest=path.join(directory,'package.json');if(!fs.existsSync(manifest))throw Error('Applicable production dependency is missing: '+directory);
  const pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
  if(pkg.version!==entry.version)throw Error('Installed package differs from lockfile: '+directory);
  const files=fs.readdirSync(directory,{withFileTypes:true}).filter(f=>f.isFile()&&/^(license|licence|copying|notice)(\.|$)/i.test(f.name)).map(f=>({path:path.join(directory,f.name),text:fs.readFileSync(path.join(directory,f.name),'utf8')}));
  if(pkg.name==='@openai/codex'&&['0.154.0','0.154.0-win32-x64'].includes(pkg.version)){
    const source=JSON.parse(fs.readFileSync('third-party/codex-0.154.0/source.json','utf8'));
    for(const file of source.files){
      const location=path.join('third-party/codex-0.154.0',file.name),raw=fs.readFileSync(location);
      if(hash(raw)!==file.sha256)throw Error('Supplemental Codex notice checksum changed');
      files.push({path:location,text:raw.toString('utf8'),upstream:file.url});
    }
  }
  if(pkg.name==='punycode.js'&&pkg.version==='2.3.1'){const location='third-party/punycode-2.3.1/LICENSE-MIT.txt';files.push({path:location,text:fs.readFileSync(location,'utf8'),upstream:'https://github.com/mathiasbynens/punycode.js/blob/v2.3.1/LICENSE-MIT.txt'})}
  items.push({name:pkg.name,version:pkg.version,scope:'npm production graph',license:typeof pkg.license==='string'?pkg.license:entry.license??null,resolved:entry.resolved??null,integrity:entry.integrity??null,files});
}
const python=spawnSync(path.resolve('.venv312/Scripts/python.exe'),[path.resolve('scripts/python-license-inventory.py')],{encoding:'utf8',windowsHide:true});
if(python.status!==0)throw Error('Python license inventory failed');items.push(...JSON.parse(python.stdout));
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
