import {NativeDesktopSession} from './native-session.mjs';
import {createComputerUseServer} from './mcp-server.mjs';

// Options are supplied by the trusted launcher, never from tool arguments.
export function createWindowsComputerUseServer(options){
 let native;
 const recycle=async()=>{const previous=native;native=null;await previous?.close();};
 return createComputerUseServer({
  invoke:(...args)=>{native??=new NativeDesktopSession(options);return native.invoke(...args);},
  onReset:recycle,onClose:recycle,
 });
}
