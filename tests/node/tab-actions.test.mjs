import test from 'node:test';import assert from 'node:assert/strict';
import {closeTargets,closeTabs} from '../../apps/desktop/src/renderer/tab-actions.mjs';
const tabs=['market','file:a.md','stock:002403.SZ','settings'];
test('context actions target clicked tab without changing active selection',()=>{
 assert.deepEqual(closeTargets(tabs,'file:a.md','right'),tabs.slice(2));
 assert.deepEqual(closeTargets(tabs,'file:a.md','others'),['market','stock:002403.SZ','settings']);
 assert.deepEqual(closeTargets(tabs,'settings','right'),[]);
 assert.deepEqual(closeTargets(tabs,'missing','all'),[]);
 assert.equal(closeTabs(tabs,'market',['settings']).active,'market');
});
test('batch closing preserves protected drafts and chooses surviving neighbors',()=>{
 const result=closeTabs(tabs,'stock:002403.SZ',tabs,{'file:a.md':true});
 assert.deepEqual(result,{tabs:['file:a.md'],active:'file:a.md',blocked:['file:a.md']});
 assert.equal(closeTabs(tabs,'file:a.md',['file:a.md']).active,'stock:002403.SZ');
 assert.equal(closeTabs(tabs,'settings',['settings']).active,'stock:002403.SZ');
 assert.deepEqual(closeTabs(tabs,'market',tabs),{tabs:[],active:null,blocked:[]});
});
