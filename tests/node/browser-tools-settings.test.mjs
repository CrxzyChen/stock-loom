import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {readBrowserTools,saveBrowserTools,browserToolOptions,browserToolsStatus} from '../../apps/desktop/src/main/browser-tools-settings.mjs';
test('browser opt-in persists; disabled config never enables browser or creates output',async()=>{
const directory=await fs.mkdtemp(path.resolve('.runtime/browser-settings-'));assert.equal(await readBrowserTools(directory),false);
const options=await browserToolOptions({directory,project:directory,command:'node',entry:'missing'});assert.deepEqual(options.config,['mcp_servers.stock_browser.enabled=false']);await assert.rejects(fs.access(path.join(directory,'sources')));
await assert.rejects(saveBrowserTools(directory,'true'));await saveBrowserTools(directory,true);assert.equal(await readBrowserTools(directory),true);await saveBrowserTools(directory,false);assert.equal(await readBrowserTools(directory),false);
});
test('enabled browser uses project output and private profile; rejects linked output',async(t)=>{
const directory=await fs.mkdtemp(path.resolve('.runtime/browser-paths-')),project=path.join(directory,'project'),outside=path.join(directory,'outside');await fs.mkdir(project);await fs.mkdir(outside);await saveBrowserTools(directory,true);
const entry=path.resolve('node_modules/@playwright/mcp/cli.js');if(!(await browserToolsStatus(directory,entry)).browserInstalled){t.skip('Requires installed Edge');return}const options=await browserToolOptions({directory,project,command:'electron',entry});assert.ok(options.config.some(x=>x.includes('--user-data-dir')));assert.ok(options.config.some(x=>x.includes('--output-dir')));assert.equal(options.env.ELECTRON_RUN_AS_NODE,'1');
const linked=path.join(directory,'linked');await fs.mkdir(linked);await fs.symlink(outside,path.join(linked,'sources'),'junction');await assert.rejects(browserToolOptions({directory,project:linked,command:'electron',entry}),/链接/);await assert.rejects(fs.access(path.join(outside,'browser')));
});
