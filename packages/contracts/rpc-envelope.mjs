import {matchesContract} from './generated-runtime.mjs';
// Protocol v2 framing, separate from method-specific result schemas.
export function validResponseEnvelope(value){
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const keys=Object.keys(value);
  if(keys.length!==4||!Object.hasOwn(value,'requestId')||!Object.hasOwn(value,'dataAsOf')||!Object.hasOwn(value,'sourceVersion'))return false;
  if(!matchesContract('RpcMetadata',{dataAsOf:value.dataAsOf,sourceVersion:value.sourceVersion}))return false;
  if(value.dataAsOf!==null&&!/^[0-9]{8}$/.test(value.dataAsOf))return false;
  if(value.sourceVersion!==null&&(value.sourceVersion.length<1||value.sourceVersion.length>300))return false;
  const id=value.requestId;
  if(id!==null&&(typeof id!=='string'||id.length<1||id.length>100))return false;
  if(Object.hasOwn(value,'result'))return id!==null;
  if(!Object.hasOwn(value,'error'))return false;
  const error=value.error;
  return error!==null&&typeof error==='object'&&!Array.isArray(error)&&Object.keys(error).length===2&&
    Object.hasOwn(error,'code')&&Object.hasOwn(error,'message')&&
    typeof error.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)&&
    typeof error.message==='string'&&error.message.length>0&&error.message.length<=2000;
}
