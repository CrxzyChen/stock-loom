import test from 'node:test';import assert from 'node:assert/strict';import {projectLink,projectTextParts} from '../../apps/desktop/src/renderer/project-links.mjs';
test('project links normalize native Windows paths and optional source positions',()=>{
 const root='D:\\MyProjects\\Stock';assert.equal(projectLink('notes.md',root),'notes.md');assert.equal(projectLink('<D:/MyProjects/stock/notes/收入.md:12>',root),'notes/收入.md');assert.equal(projectLink('notes/report%20one.md#L10',root),'notes/report one.md');
 for(const bad of ['../secret','D:/MyProjects/stock-other/a','C:/other/a','https://example.com','javascript:alert(1)','file:///D:/MyProjects/Stock/a','notes/%2e%2e/secret','//host/share','D:/MyProjects/Stock/a:stream'])assert.equal(projectLink(bad,root),null,bad);
});
test('file references are safe text segments, with external links and markup retained as plain text',()=>{
 assert.deepEqual(projectTextParts('See [资料](notes.md) and [site](https://example.com) <script>x</script>','D:/project'),[{text:'See '},{text:'资料',file:'notes.md'},{text:' and [site](https://example.com) <script>x</script>'}]);
});
