const key=project=>'stock.copilot-draft.v1:'+project;
export function readCopilotDraft(storage,project){const value=JSON.parse(storage.getItem(key(project))??'null');return value?.version===1&&typeof value.text==='string'&&value.text.length<=100000?value.text:''}
export function saveCopilotDraft(storage,project,text){if(text)storage.setItem(key(project),JSON.stringify({version:1,text}));else storage.removeItem(key(project))}
