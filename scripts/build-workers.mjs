import {build} from 'esbuild';
export async function buildWorkers(){
  await build({entryPoints:['apps/research-tools/workspace-cli.mjs'],outfile:'dist/tools/workspace-cli.mjs',bundle:true,platform:'node',format:'esm',target:'node22'});
  await build({entryPoints:['apps/research-tools/workspace-mcp-server.mjs'],outfile:'dist/tools/workspace-mcp-server.mjs',bundle:true,platform:'node',format:'esm',target:'node22',banner:{js:"import {createRequire as makeRequire} from 'node:module'; const require=makeRequire(import.meta.url);"}});
  await build({entryPoints:['apps/research-tools/mcp-server.mjs'],outfile:'dist/tools/mcp-server.mjs',bundle:true,platform:'node',format:'esm',target:'node22',banner:{js:"import {createRequire as makeRequire} from 'node:module'; const require=makeRequire(import.meta.url);"}});
}
