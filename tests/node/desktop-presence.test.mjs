import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {DesktopPresence} from '../../apps/desktop/src/main/desktop-presence.mjs';
function fixture(){
  const notifications=[];let quits=0;
  class Tray extends EventEmitter{setToolTip(){}setContextMenu(menu){this.menu=menu}destroy(){this.destroyed=true}isDestroyed(){return !!this.destroyed}}
  class Notification extends EventEmitter{static isSupported(){return true}constructor(options){super();this.options=options;notifications.push(this)}show(){this.shown=true}close(){this.emit('close')}}
  const window={visible:true,minimized:false,isDestroyed:()=>false,isMinimized(){return this.minimized},restore(){this.minimized=false},show(){this.visible=true},hide(){this.visible=false},focus(){this.focused=true},isVisible(){return this.visible}};
  const presence=new DesktopPresence({Tray,Menu:{buildFromTemplate:items=>items},nativeImage:{createFromBitmap:()=>({isEmpty:()=>false})},Notification,getWindow:()=>window,quit:()=>quits++});
  return {presence,window,notifications,quits:()=>quits};
}
test('scheduled notification opens its exact conversation and stops after shutdown',()=>{const f=fixture();let opened=0;assert.equal(f.presence.notifyScheduled({title:'task',body:'important change',onClick:()=>opened++}),true);assert.equal(f.notifications[0].options.body,'important change');f.notifications[0].emit('click');assert.equal(opened,1);assert.equal(f.window.visible,true);f.presence.shutdown();assert.equal(f.presence.notifyScheduled({title:'task',body:'ignored'}),false)});
test('close defaults to exit; opted-in tray hides, reopens, and explicit exit bypasses hiding',()=>{
  const f=fixture();let prevented=0;const event={preventDefault:()=>prevented++};
  assert.equal(f.presence.close(event),false);assert.equal(prevented,0);
  f.presence.setEnabled(true);const tray=f.presence.tray;f.presence.close(event);assert.equal(f.window.visible,false);
  f.window.minimized=true;tray.emit('click');assert.equal(f.window.visible,true);assert.equal(f.window.minimized,false);
  tray.menu[2].click();assert.equal(f.quits(),1);
  f.presence.shutdown();assert.equal(tray.isDestroyed(),true);assert.equal(f.presence.close(event),false);
  f.presence.setEnabled(true);assert.equal(f.presence.tray,null);
});
test('hidden-window notifications are generic, clickable, bounded and failure isolated',()=>{
  const f=fixture();f.presence.setEnabled(true);f.presence.notify('research','succeeded');assert.equal(f.notifications.length,0);
  f.window.hide();f.presence.notify('research','cancelled');assert.equal(f.notifications.length,0);
  f.presence.notify('research','succeeded');assert.equal(f.notifications[0].shown,true);
  f.notifications[0].emit('click');assert.equal(f.window.visible,true);
  f.window.hide();for(let i=0;i<12;i++)f.presence.notify('data','failed');assert.equal(f.presence.notices.size,8);
  f.presence.Notification=class {static isSupported(){throw Error('OS unavailable')}};
  assert.doesNotThrow(()=>f.presence.notify('data','failed'));
  f.presence.setEnabled(false);assert.equal(f.presence.notices.size,0);assert.equal(f.window.visible,true);
});
test('close prompt supports background, exit and cancel without duplicate prompts',async()=>{
 const f=fixture();let resolve,calls=0;
 const dialog={showMessageBox:async(_window,options)=>{calls++;assert.equal(options.cancelId,2);return new Promise(r=>resolve=r)}};
 const pending=f.presence.requestClose(dialog);await f.presence.requestClose(dialog);assert.equal(calls,1);resolve({response:2});await pending;assert.equal(f.window.visible,true);assert.equal(f.quits(),0);
 await f.presence.requestClose({showMessageBox:async()=>({response:0})});assert.equal(f.window.visible,false);assert.ok(f.presence.tray);assert.equal(f.quits(),0);
 f.presence.show();await f.presence.requestClose({showMessageBox:async()=>({response:1})});assert.equal(f.quits(),1);
});
test('failed tray creation leaves window visible and close prompt can retry',async()=>{
 const f=fixture();f.presence.nativeImage.createFromBitmap=()=>({isEmpty:()=>true});
 await assert.rejects(f.presence.requestClose({showMessageBox:async()=>({response:0})}));assert.equal(f.window.visible,true);assert.equal(f.presence.closePrompt,false);
});
