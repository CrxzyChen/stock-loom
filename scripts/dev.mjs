import {build} from 'esbuild';
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import electron from 'electron';
import {buildWorkers} from './build-workers.mjs';
await build({entryPoints:['apps/desktop/src/main/main.ts'],outfile:'dist/main/main.cjs',bundle:true,platform:'node',format:'cjs',external:['electron']});
await build({entryPoints:['apps/desktop/src/preload/preload.ts'],outfile:'dist/main/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron']});
await buildWorkers();
const server=await createServer({configFile:'apps/desktop/vite.config.ts'});
await server.listen();
const child=spawn(electron,['.'],{stdio:'inherit',env:{...process.env,STOCK_DEV_URL:'http://127.0.0.1:5173'}});
let closing=false;
async function stop(){if(closing)return;closing=true;child.kill();await server.close()}
child.on('exit',async()=>{await stop();process.exit(0)});
process.on('SIGINT',stop);process.on('SIGTERM',stop);
