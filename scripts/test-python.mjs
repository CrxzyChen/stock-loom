import {spawnSync} from 'node:child_process';
import path from 'node:path';
const python=path.resolve(process.platform==='win32'?'.venv312/Scripts/python.exe':'.venv312/bin/python');
const result=spawnSync(python,['-m','unittest','discover','-s','tests/python','-v'],{stdio:'inherit'});
if(result.error)console.error('Unable to start project Python. Create .venv312 first.');
process.exit(result.status??1);

