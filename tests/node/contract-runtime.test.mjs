import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import path from 'node:path';
import {matchesContract} from '../../packages/contracts/generated-runtime.mjs';
test('shared boundary schema rejects malformed settings and event cursors identically',()=>{
  const cases=[['Settings',{colorMode:'red-up',closeToTray:false},true],['Settings',{colorMode:'green-up',closeToTray:true},true],...[
    null,[],{}, {colorMode:'blue',closeToTray:false},{colorMode:'red-up',closeToTray:0},{colorMode:'red-up',closeToTray:true,extra:'hidden'}
  ].map(v=>['Settings',v,false]),...[-1,0,1,1.5,9007199254740991,9007199254740992,true,'1',null].map(v=>['JobEventRequest',{after:v},typeof v==='number'&&Number.isSafeInteger(v)&&v>=0]),['JobEventRequest',{after:0,extra:1},false]];
  cases.push(['WatchlistCreateRequest',{name:'分组'},true],['WatchlistCreateRequest',{name:5},false],['WatchlistMembersRequest',{listId:'id'},true],['WatchlistChangeRequest',{listId:'id',instrumentId:'000001.SZ'},true],['WatchlistChangeRequest',{listId:'id',instrumentId:1},false],['WatchlistChangeRequest',{listId:'id',instrumentId:'x',extra:true},false],['WatchlistReorderRequest',{listId:'id',ids:['a','b']},true],['WatchlistReorderRequest',{listId:'id',ids:['a',1]},false]);
  const expected=cases.map(x=>x[2]);assert.deepEqual(cases.map(([name,value])=>matchesContract(name,value)),expected);
  const python=spawnSync(path.resolve('.venv312/Scripts/python.exe'),['-c',"import json,sys;sys.path.insert(0,'apps/data-service');from generated_contracts import matches_contract;print(json.dumps([matches_contract(n,v) for n,v,_ in json.load(sys.stdin)]))"],{input:JSON.stringify(cases),encoding:'utf8',windowsHide:true});assert.equal(python.status,0,python.stderr);assert.deepEqual(JSON.parse(python.stdout),expected);
  assert.equal(matchesContract('JobEventRequest',{after:Infinity}),false);assert.equal(matchesContract('Settings',undefined),false);
});
