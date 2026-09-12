import {randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';
import {workspaceTools} from '../research-tools/workspace-tools.mjs';
import {matchesRpcRequest,matchesRpcResponse,matchesContract} from '../../packages/contracts/generated-runtime.mjs';
import {computeBarIndicators} from '../research-tools/bar-indicators.mjs';

// A scoped data connector, not an agent runtime. Reads the UI's live service.
export class WorkspaceToolBroker{
  constructor(callService,enqueueSync=null){this.callService=callService;this.enqueueSync=enqueueSync;this.token=randomBytes(32).toString('hex');this.runId=randomUUID();this.revoked=false}
  revoke(){this.revoked=true}
  async read(method,params){
    if(this.revoked||!matchesRpcRequest(method,params))throw Error('股票工具参数无效。');
    const result=await this.callService(method,params);
    if(this.revoked||!matchesRpcResponse(method,result))throw Error('数据连接已失效或响应无效。');
    if(method==='bars.read'&&(result.snapshotId!==params.snapshotId||result.adjustment!==params.adjustment||result.offset!==params.offset))throw Error('日线数据不属于请求范围。');
    if(result&&(method==='index.read'||method==='market.read')){
      const key=method==='index.read'?'indexId':'marketId';
      if(result[key]!==params[key]||(params.snapshotId&&result.snapshotId!==params.snapshotId))throw Error('市场数据不属于请求范围。');
    }
    return result;
  }
  async call(request){
    if(this.revoked||!request||Object.keys(request).sort().join(',')!=='arguments,runId,token,tool'||typeof request.token!=='string'||! /^[0-9a-f]{64}$/.test(request.token)||!timingSafeEqual(Buffer.from(request.token),Buffer.from(this.token))||request.runId!==this.runId)throw Error('数据连接已失效。');
    const tool=workspaceTools.find(t=>t[0]===request.tool);if(!tool)throw Error('未知股票工具。');
    const parsed=tool[3].safeParse(request.arguments);if(!parsed.success)throw Error('股票工具参数无效。');
    if(tool[2]?.startsWith('scheduler.')){const result=await this.callService(tool[2],parsed.data);if(this.revoked)throw Error('连接已失效。');return result}
    if(request.tool==='compute_bar_indicators')return computeBarIndicators(parsed.data,(m,p)=>this.read(m,p));
    if(tool[2]?.endsWith('.sync')){
      if(!this.enqueueSync)throw Error('同步连接不可用。');
      const result=await this.enqueueSync(tool[2],parsed.data);
      if(this.revoked||!matchesContract('Job',result)||result.kind!==tool[2])throw Error('同步任务响应无效。');
      return result;
    }
    return this.read(tool[2],parsed.data);
  }
}
