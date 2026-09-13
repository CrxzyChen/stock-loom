import test from 'node:test';import assert from 'node:assert/strict';
import {readWorkspace,writeWorkspace} from '../../apps/desktop/src/renderer/workspace-state.mjs';
test('comparison tabs restore and retired pages are discarded',()=>{
 const comparison='compare:000001.SZ,600000.SH';
 const storage={getItem:()=>JSON.stringify({version:1,tabs:['screen','market',comparison,'compare:000001.SZ,000001.SZ','compare:bad,600000.SH'],active:'screen',panel:'market'})};
 assert.deepEqual(readWorkspace(storage,'a'),{tabs:['market',comparison],active:'market',panel:'market'});
});
test('project tab order, selected tab and panel restore independently',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 writeWorkspace(storage,'project-a',{tabs:['holdings','file:notes/revenue.md','market'],active:'file:notes/revenue.md',panel:'project'});
 assert.deepEqual(readWorkspace(storage,'project-a'),{tabs:['holdings','file:notes/revenue.md','market'],active:'file:notes/revenue.md',panel:'project'});
 assert.deepEqual(readWorkspace(storage,'project-b'),{tabs:['market'],active:'market',panel:'market'});
 writeWorkspace(storage,'project-a',{tabs:[],active:null,panel:'stocks'});assert.equal(readWorkspace(storage,'project-a').active,null);
});
test('corrupt and unsupported persisted tabs do not execute or escape a project',()=>{
 const storage={getItem:()=>JSON.stringify({version:1,tabs:['market','market','file:../../secret','file:C:/secret','file:notes.md','javascript:alert(1)'],active:'missing',panel:'unknown'})};
 assert.deepEqual(readWorkspace(storage,'a'),{tabs:['market','file:notes.md'],active:'market',panel:'market'});
 assert.equal(readWorkspace({getItem:()=>'{bad'},'a').active,'market');
 assert.equal(writeWorkspace({setItem:()=>{throw Error('full')}},'a',{tabs:[],active:null,panel:'market'}),false);
});

test('mixed market tabs survive batch close and workspace reload',async()=>{
 const {closeTabs}=await import('../../apps/desktop/src/renderer/tab-actions.mjs');
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 const tabs=['market','index:000001.SH','sector:801780.SI','file:notes.md','stock:002403.SZ'];
 const closed=closeTabs(tabs,'index:000001.SH',['market','stock:002403.SZ']);
 writeWorkspace(storage,'p',{...closed,panel:'market'});
 assert.deepEqual(readWorkspace(storage,'p'),{tabs:['index:000001.SH','sector:801780.SI','file:notes.md'],active:'index:000001.SH',panel:'market'});
 writeWorkspace(storage,'p',{tabs:['index:malicious','sector:../x','sector:123.SI'],active:null,panel:'market'});
 assert.deepEqual(readWorkspace(storage,'p').tabs,[]);
});
