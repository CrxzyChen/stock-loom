const json=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
export function itemContent(item){
 if(item.type==='userMessage')return (item.content??[]).map(c=>{if(c.type==='localImage')return '附件：'+String(c.path??'图片').split(/[\\/]/).pop();if(c.type==='image')return '附件：图片';if(c.text?.startsWith('用户附加的项目文件：')){try{return '附件：'+JSON.parse(c.text.slice('用户附加的项目文件：'.length)).split('/').pop()}catch{}}return c.text??''}).join('\n');
 if(item.type==='reasoning')return (item.summary??[]).join('\n');
 if(item.type==='mcpToolCall')return `${item.server} · ${item.tool}`;
 if(item.type==='fileChange')return `修改 ${(item.changes??[]).length} 个文件`;
 if(item.type==='webSearch')return item.query??'搜索网页';
 if(item.type==='dynamicToolCall')return [item.namespace,item.tool].filter(Boolean).join(' · ');
 if(item.type==='imageView')return item.path;
 if(item.type==='imageGeneration')return item.savedPath??'生成图片';
 if(item.type==='sleep')return `等待 ${Math.ceil(item.durationMs/1000)} 秒`;
 if(item.type==='contextCompaction')return 'Codex 已整理会话上下文';
 return item.text??item.command??item.name??item.type;
}
export function itemOutput(item){
 if(item.type==='reasoning')return ''; // Never surface the private content field.
 if(item.type==='fileChange')return (item.changes??[]).map(c=>`${c.path} · ${c.kind?.type??''}\n${c.diff??''}`).join('\n\n');
 if(item.type==='webSearch')return json({action:item.action,results:item.results});
 if(item.type==='functionCallOutput')return json(item.output??'');
 if(item.type==='dynamicToolCall')return json(item.contentItems??[]);
 return item.aggregatedOutput??(item.result?json(item.result):item.error?json(item.error):'');
}
