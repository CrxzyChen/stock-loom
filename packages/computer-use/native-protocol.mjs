export function validateNativeHello(value){
 if(value?.ready!==true||value.protocol!==1||typeof value.version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?$/.test(value.version))throw Object.assign(Error('Unsupported native protocol or build metadata'),{code:'PROTOCOL_ERROR'});
 const expected=['windows.observe','windows.capture','windows.input'];
 if(!Array.isArray(value.capabilities)||value.capabilities.length!==expected.length||!expected.every(c=>value.capabilities.includes(c)))throw Object.assign(Error('Unsupported native capabilities'),{code:'PROTOCOL_ERROR'});
 return {protocol:value.protocol,version:value.version,capabilities:[...value.capabilities]};
}
