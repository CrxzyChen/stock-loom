import test from 'node:test';import assert from 'node:assert/strict';
import {renderCopilotMarkdown as render} from '../../apps/desktop/src/renderer/copilot-markdown.mjs';
test('renders structured replies and incomplete streaming fences',()=>{
 const html=render('# 分析\n\n**利润**\n\n- 增长\n\n|年|收入|\n|--|--|\n|2025|100|\n\n```js\nconst x = 1;','D:/project');
 for(const tag of ['<h1>','<strong>','<ul>','<table>','<pre><code'])assert.ok(html.includes(tag),tag);
 assert.match(render('`price` and ~~old~~',''),/<code>price<\/code> and <s>old<\/s>/);
});
test('untrusted content cannot inject HTML or active URLs and preserves scoped file links',()=>{
 const html=render('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![x](https://example.com/track)\n\n[记录](notes.md)\n\n[外部](../secret.md)','D:/project');
 assert.ok(!/<script|<img|href="javascript:/i.test(html));
 assert.match(html,/data-project-file="notes.md"/);assert.ok(!html.includes('data-project-file="../'));
 assert.match(render('[资料](<D:/project/notes.md:12>)','D:/project'),/data-project-file="notes.md"/);
});
