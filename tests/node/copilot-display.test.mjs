import test from 'node:test';import assert from 'node:assert/strict';import {itemContent,itemOutput} from '../../apps/desktop/src/renderer/copilot-display.mjs';
test('file changes retain reviewable diff and public tool outputs remain visible',()=>{
 const file={type:'fileChange',changes:[{path:'notes.md',kind:{type:'add'},diff:'fixture'}]};assert.equal(itemContent(file),'修改 1 个文件');assert.match(itemOutput(file),/notes.md · add\nfixture/);
 assert.match(itemOutput({type:'webSearch',query:'annual report',results:[{url:'https://example.com/report'}]}),/example.com/);
 assert.equal(itemOutput({type:'functionCallOutput',output:'tool output'}),'tool output');
});
test('reasoning only displays native public summary, never private content',()=>{
 const item={type:'reasoning',summary:['公开摘要'],content:['private detail']};assert.equal(itemContent(item),'公开摘要');assert.equal(itemOutput(item),'');
});
