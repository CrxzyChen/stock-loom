const namePattern=/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
function serverName(name){if(typeof name!=='string'||!namePattern.test(name)||name==='stock')throw Error('服务名只能包含字母、数字、下划线或横线，stock 为内置服务。')}
export function mcpDefinition(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('MCP 配置无效。');
  if(Object.keys(value).sort().join(',')==='url'){
    let url;try{url=new URL(value.url)}catch{throw Error('请输入有效的 MCP URL。')}
    if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw Error('使用 HTTPS 或本机 HTTP 地址；不要在地址中填写凭据或查询参数。');
    return {url:url.href,enabled:true};
  }
  if(Object.keys(value).sort().join(',')!=='args,command'||typeof value.command!=='string'||!value.command.trim()||value.command.length>4096||/[\r\n\0]/.test(value.command)||!Array.isArray(value.args)||value.args.length>100||value.args.some(arg=>typeof arg!=='string'||arg.length>8192||arg.includes('\0')))throw Error('请输入命令和 JSON 字符串参数数组。');
  return {command:value.command,args:value.args,enabled:true};
}
export class NativeMcpConfig{
  constructor(client,location){this.client=client;this.location=location}
  async read(){
    await this.client.start();const {path:project}=await this.location();const result=await this.client.request('config/read',{cwd:project,includeLayers:true}),user=result.layers?.find(x=>x.name?.type==='user');
    // User layer only. Never return environment values, headers or command arguments.
    const servers=user?.config?.mcp_servers??{};
    return {project,file:user?.name?.file??null,version:user?.version??null,servers:Object.entries(servers).filter(([name])=>name!=='stock').map(([name,server])=>({name,enabled:server.enabled!==false,effectiveEnabled:result.config?.mcp_servers?.[name]?result.config.mcp_servers[name].enabled!==false:null,type:typeof server.command==='string'?'stdio':typeof server.url==='string'?'http':'unknown'}))};
  }
  async write(input){
    if(!input||!['definition,name,project,version','enabled,name,project,version'].includes(Object.keys(input).sort().join(','))||typeof input.version!=='string'||typeof input.project!=='string')throw Error('配置参数无效，请重新读取。');
    serverName(input.name);const current=await this.read();if(current.project!==input.project||current.version!==input.version)throw Error('配置或项目已变更，请重新读取后保存。');
    const exists=current.servers.some(x=>x.name===input.name);let keyPath,value;
    if(Object.hasOwn(input,'definition')){if(exists)throw Error('同名服务已存在，请使用新名称；原配置保留。');keyPath=`mcp_servers.${input.name}`;value=mcpDefinition(input.definition)}
    else{if(!exists||typeof input.enabled!=='boolean')throw Error('服务不存在或状态无效。');keyPath=`mcp_servers.${input.name}.enabled`;value=input.enabled}
    const result=await this.client.request('config/value/write',{keyPath,value,mergeStrategy:'replace',expectedVersion:input.version});return {status:result.status,...await this.read()};
  }
}
