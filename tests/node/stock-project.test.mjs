import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {initializeStockProject} from '../../apps/desktop/src/main/stock-project.mjs';
test('default project exposes editable AGENTS instructions without overwriting user guidance',async()=>{
 const folder=await fs.mkdtemp(path.resolve('.runtime/tests/stock-project-'));
 assert.equal((await initializeStockProject(folder)).created,true);
 assert.match(await fs.readFile(path.join(folder,'AGENTS.md'),'utf8'),/MCP/);
 await fs.writeFile(path.join(folder,'AGENTS.md'),'My investing principles');
 assert.equal((await initializeStockProject(folder)).created,false);
 assert.equal(await fs.readFile(path.join(folder,'AGENTS.md'),'utf8'),'My investing principles');
});
