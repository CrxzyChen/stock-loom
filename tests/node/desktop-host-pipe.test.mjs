import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopHostClient,startDesktopHostPipe} from '../../packages/computer-use/host-pipe.mjs';

test('host pipe authenticates, binds connections independently and supports out-of-band stop',async()=>{
 let sequence=0,finished;const sessions=new Set(),stopped=[];
 const controller={
  openSession(){const id=String(++sequence);sessions.add(id);return id;},
  async closeSession(id){sessions.delete(id);},
  async invoke(id,method,_args,{emitImage}){if(method==='slow')return new Promise((_,reject)=>{finished=reject;});emitImage({mimeType:'image/png',data:'fixture'});return id;},
  async stop(id){stopped.push(id);finished?.(Object.assign(Error('Stopped'),{code:'CANCELLED'}));},async reset(){},
 };
 const pipe=await startDesktopHostPipe(controller);
 const a=new DesktopHostClient(pipe),b=new DesktopHostClient(pipe),wrong=new DesktopHostClient({...pipe,token:'wrong'});
 try{
  await assert.rejects(wrong.invoke('listWindows',{}),{code:'SESSION_CLOSED'});
  const images=[];assert.equal(await a.invoke('listWindows',{}, {emitImage:image=>images.push(image)}),'1');
  assert.equal(await b.invoke('listWindows',{}),'2');assert.equal(images.length,1);
  const abort=new AbortController();const pending=a.invoke('slow',{}, {signal:abort.signal});const rejected=assert.rejects(pending,{code:'CANCELLED'});
  for(let i=0;i<50&&!finished;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(finished);
  abort.abort();await rejected;await a.reset();assert.deepEqual(stopped,['1']);
 }finally{a.close();b.close();wrong.close();await pipe.close();}
});

test('lost host connection rejects outstanding operations',async()=>{
 let entered;const ready=new Promise(resolve=>entered=resolve);
 const pipe=await startDesktopHostPipe({openSession:()=> 'one',closeSession:async()=>{},invoke:async()=>{entered();return new Promise(()=>{});}});
 const client=new DesktopHostClient(pipe);
 const pending=client.invoke('read',{}),rejected=assert.rejects(pending,{code:'SESSION_CLOSED'});
 await ready;await pipe.close();await rejected;client.close();
});
