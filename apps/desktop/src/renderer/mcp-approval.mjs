export function supportsMcpConfirmation(params){
 const schema=params?.requestedSchema;
 return ['form','openai/form','openaiForm'].includes(params?.mode)&&schema?.type==='object'&&schema.properties&&typeof schema.properties==='object'&&!Array.isArray(schema.properties)&&Object.keys(schema.properties).length===0&&(!schema.required||Array.isArray(schema.required)&&schema.required.length===0)&&Object.keys(schema).every(key=>['type','properties','required','$schema','title','description','additionalProperties'].includes(key));
}
export function offersMcpSession(params){
 const meta=params?._meta;
 return supportsMcpConfirmation(params)&&meta?.codex_approval_kind==='mcp_tool_call'&&(meta.persist==='session'||Array.isArray(meta.persist)&&meta.persist.includes('session'));
}
