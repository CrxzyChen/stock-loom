import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {saveBrowserTools,browserToolOptions} from '../apps/desktop/src/main/browser-tools-settings.mjs';

const directory=await fs.mkdtemp(path.resolve('.runtime/browser-concurrency-'));
await saveBrowserTools(directory,true);
const options=await browserToolOptions({directory,project:directory,command:process.execPath,entry:path.resolve('node_modules/@playwright/mcp/cli.js')});
const args=JSON.parse(options.config.find(x=>x.startsWith('mcp_servers.stock_browser.args=')).slice('mcp_servers.stock_browser.args='.length));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Concurrent browser fixture</title><p>Local fixture</p>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const clients=[0,1].map(i=>new Client({name:`browser-concurrency-${i}`,version:'1.0.0'}));
async function call(client,name,args={}){const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return JSON.stringify(result)}
try{
 await Promise.all(clients.map(client=>client.connect(new StdioClientTransport({command:process.execPath,args:[...args,'--headless'],stderr:'pipe'}))));
 await Promise.all(clients.map(client=>call(client,'browser_navigate',{url})));
 await call(clients[0],'browser_evaluate',{function:"() => { localStorage.setItem('owner', 'first-client'); return true; }"});
 assert.match(await call(clients[0],'browser_evaluate',{function:"() => localStorage.getItem('owner')"}),/first-client/);
 assert.doesNotMatch(await call(clients[1],'browser_evaluate',{function:"() => localStorage.getItem('owner')"}),/first-client/);
 await call(clients[0],'browser_close');
 assert.match(await call(clients[1],'browser_evaluate',{function:'() => document.title'}),/Concurrent browser fixture/);
 await call(clients[0],'browser_navigate',{url});
 assert.doesNotMatch(await call(clients[0],'browser_evaluate',{function:"() => localStorage.getItem('owner')"}),/first-client/);
 await Promise.all(clients.map(client=>call(client,'browser_close')));
 console.log('PASS: simultaneous clients, isolated storage, independent close, reopen without stale profile lock');
}finally{await Promise.allSettled(clients.map(client=>client.close()));await new Promise(resolve=>server.close(resolve))}
