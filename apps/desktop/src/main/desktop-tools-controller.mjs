import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {NativeDesktopSession} from '../../../../packages/computer-use/native-session.mjs';

const fail=(code,message)=>Object.assign(Error(message),{code});
const key=exe=>path.win32.normalize(exe).toLowerCase();

/** Owned by Electron. MCP connections receive opaque session IDs from openSession. */
export class DesktopToolsController extends EventEmitter{
 #sessions=new Map();#config={version:1,enabled:false,apps:[]};#changing=false;#closed=false;
 constructor({directory,enumerate,nativeOptions,validateThread=()=>true,nativeFactory=options=>new NativeDesktopSession(options)}){
  super();this.file=path.join(directory,'desktop-tools.json');this.enumerate=enumerate;this.nativeOptions=nativeOptions;this.nativeFactory=nativeFactory;this.validateThread=validateThread;
 }
 async load(){
  try{
   const config=JSON.parse(await fs.readFile(this.file,'utf8'));
   if(config.version!==1||typeof config.enabled!=='boolean'||!Array.isArray(config.apps)||config.apps.length>128||config.apps.some(a=>!a||typeof a.name!=='string'||typeof a.executable!=='string'||!path.win32.isAbsolute(a.executable)))throw Error('Invalid desktop settings');
   this.#config=config;
  }catch(e){if(e.code!=='ENOENT')throw fail('CONFIG_INVALID','电脑操作设置无法读取；访问保持关闭。');}
 }
 status(){return {enabled:this.#config.enabled,apps:this.#config.apps.map(a=>({...a})),sessions:[...this.#sessions].map(([id,s])=>({id,threadId:s.threadId,state:s.stopped?'stopped':s.active?'running':'ready',target:s.target}))};}
 async candidates(){
  const windows=await this.enumerate();
  return windows.filter(w=>w.executable&&path.win32.isAbsolute(w.executable)).map(w=>({id:w.id,title:w.title,name:path.win32.basename(w.executable),authorized:this.#config.apps.some(a=>key(a.executable)===key(w.executable))}));
 }
 async #save(config){
  if(this.#closed)throw fail('SESSION_CLOSED','Desktop controller closed');
  if(this.#changing)throw fail('BUSY','电脑操作设置正在保存。');
  this.#changing=true;
  try{
   // Revoke live workers before persisting; no stale grant remains active on disk failure.
   await this.stopAll();
   this.#config={...this.#config,enabled:false};
   await fs.mkdir(path.dirname(this.file),{recursive:true});
   const temporary=this.file+'.'+randomUUID()+'.pending';
   await fs.writeFile(temporary,JSON.stringify(config)+'\n',{flag:'wx'});await fs.rename(temporary,this.file);
   this.#config=config;this.emit('changed',this.status());return this.status();
  }finally{this.#changing=false;}
 }
 async enable(enabled){if(typeof enabled!=='boolean')throw fail('INVALID_ARGUMENT','启用状态无效。');return this.#save({...this.#config,enabled});}
 async grant(windowId){
  const actual=(await this.enumerate()).find(w=>w.id===windowId);
  if(!actual?.executable||!path.win32.isAbsolute(actual.executable))throw fail('WINDOW_GONE','应用已关闭，请重新选择。');
  const apps=this.#config.apps.filter(a=>key(a.executable)!==key(actual.executable));
  if(apps.length>=128)throw fail('LIMIT','授权应用数量已达上限。');
  apps.push({executable:actual.executable,name:path.win32.basename(actual.executable)});
  return this.#save({...this.#config,apps});
 }
 async revoke(executable){if(typeof executable!=='string')throw fail('INVALID_ARGUMENT','应用无效。');return this.#save({...this.#config,apps:this.#config.apps.filter(a=>key(a.executable)!==key(executable))});}
 openSession({threadId=null}={}){
  if(this.#closed)throw fail('SESSION_CLOSED','Desktop controller closed');
  if(this.#sessions.size>=32)throw fail('LIMIT','Too many desktop sessions');
  const id=randomUUID();this.#sessions.set(id,{threadId,native:null,active:false,target:null,stopped:false,operation:null,windows:new Map()});return id;
 }
 async invoke(id,method,args,context){
  const session=this.#sessions.get(id);
  if(!session||this.#closed)throw fail('SESSION_CLOSED','Unknown desktop session');
  if(this.#changing||!this.#config.enabled)throw fail('ACCESS_DENIED','电脑操作尚未启用。');
  if(session.stopped)throw fail('CANCELLED','桌面操作已停止，请 reset 后重新观察。');
  if(session.active)throw fail('BUSY','Desktop session is busy');
  session.native??=this.nativeFactory({...this.nativeOptions,apps:this.#config.apps.map(a=>a.executable)});
  const native=session.native;
  const operation=Symbol('desktop-operation');session.operation=operation;
  session.active=true;session.target=session.windows.get(args?.window?.id)??null;this.emit('changed',this.status());
  try{
   if(session.operation!==operation)throw fail('CANCELLED','Desktop operation was stopped');
   const result=await native.invoke(method,args,context);
   if(session.operation!==operation)throw fail('CANCELLED','Desktop operation was stopped');
   const observed=method==='listWindows'&&Array.isArray(result)?result:method==='inspectWindow'&&result?.window?[result.window]:[];
   for(const item of observed){if(typeof item?.id==='string'&&typeof item.title==='string'){session.windows.set(item.id,item.title);if(session.windows.size>128)session.windows.delete(session.windows.keys().next().value);}}
   return result;
  }
  catch(error){
   if(session.operation===operation&&['TIMEOUT','SESSION_CLOSED','CANCELLED'].includes(error.code))await this.stop(id);
   throw error;
  }
  finally{if(session.operation===operation){session.active=false;session.target=null;session.operation=null;this.emit('changed',this.status());}}
 }
 async bindThread(id,threadId){
  const session=this.#sessions.get(id);
  if(!session||typeof threadId!=='string'||!/^[a-f0-9-]{36}$/i.test(threadId)||!await this.validateThread(threadId))throw fail('ACCESS_DENIED','Unknown Codex thread');
  if(session.threadId&&session.threadId!==threadId)throw fail('ACCESS_DENIED','Desktop connection already belongs to another thread');
  session.threadId=threadId;this.emit('changed',this.status());
 }
 async stop(id){const session=this.#sessions.get(id);if(!session)return;session.stopped=true;session.operation=null;session.active=false;session.target=null;session.windows.clear();const native=session.native;session.native=null;await native?.close();this.emit('changed',this.status());}
 async reset(id){await this.stop(id);const session=this.#sessions.get(id);if(session)session.stopped=false;this.emit('changed',this.status());}
 async closeSession(id){await this.stop(id);this.#sessions.delete(id);this.emit('changed',this.status());}
 async stopAll(){await Promise.all([...this.#sessions.keys()].map(id=>this.stop(id)));}
 async close(){this.#closed=true;await this.stopAll();this.#sessions.clear();}
}
