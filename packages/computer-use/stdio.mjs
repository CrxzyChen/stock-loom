import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createWindowsComputerUseServer} from './windows-server.mjs';

if(process.platform!=='win32')throw Error('Computer Use requires Windows');
const command=process.env.STOCK_DESKTOP_EXECUTABLE;
if(!command)throw Error('Missing trusted desktop launcher configuration');
const windows=JSON.parse(process.env.STOCK_DESKTOP_ALLOWED_WINDOWS??'[]');
const args=JSON.parse(process.env.STOCK_DESKTOP_EXECUTABLE_ARGS??'[]');
if(!Array.isArray(windows)||windows.length>128||windows.some(w=>typeof w!=='string'||w.length>128)||!Array.isArray(args)||args.some(a=>typeof a!=='string'))throw Error('Invalid desktop launcher configuration');
const runtime=createWindowsComputerUseServer({command,args,windows});
const close=()=>{void runtime.close().finally(()=>process.exit(0));};
process.once('SIGTERM',close);process.once('SIGINT',close);process.stdin.once('end',close);
await runtime.server.connect(new StdioServerTransport());
