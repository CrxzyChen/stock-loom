import test from 'node:test';import assert from 'node:assert/strict';import {stockListView} from '../../apps/desktop/src/renderer/stock-list-view.mjs';
test('list price filters exclude missing values; both sort directions put missing last',()=>{
 const items=[{id:'a',name:'Alpha'},{id:'b',name:'Beta'},{id:'c',name:'Gamma'}],quotes={a:{close:null},b:{close:12},c:{close:8}};
 assert.deepEqual(stockListView(items,quotes,{order:'priceAsc'}).items.map(i=>i.id),['c','b','a']);assert.deepEqual(stockListView(items,quotes,{order:'priceDesc'}).items.map(i=>i.id),['b','c','a']);
 assert.deepEqual(stockListView(items,quotes,{minimum:'10'}).items.map(i=>i.id),['b']);assert.deepEqual(stockListView(items,quotes,{text:'gamma'}).items.map(i=>i.id),['c']);
 assert.ok(stockListView(items,quotes,{minimum:'20',maximum:'10'}).error);assert.deepEqual(items.map(i=>i.id),['a','b','c']);
});
