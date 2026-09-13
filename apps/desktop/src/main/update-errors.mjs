export function updateError(code,message){return Object.assign(new Error(message),{code})}
const messages={
 UPDATE_MANIFEST_MISSING:'该版本暂不支持应用内更新，请打开下载页，手动下载安装包。',
 UPDATE_ASSET_MISSING:'发布文件不存在，请打开下载页或稍后重试。',
 UPDATE_NETWORK:'无法连接更新服务，请检查网络后重试。',
 UPDATE_RATE_LIMIT:'更新服务暂时限制请求，请稍后重试。',
 UPDATE_SIGNATURE:'更新清单签名无效或密钥不受信任，未安装任何文件。',
 UPDATE_COMPATIBILITY:'此版本未声明兼容当前资料，请查看发布说明。',
 UPDATE_INTEGRITY:'安装包不完整或校验失败，请重新下载。',
 UPDATE_FORMAT:'发布清单格式或版本信息不一致，请稍后重试或打开下载页。',
 UPDATE_SOURCE:'更新来源不受支持，已停止下载。'
};
export function updateErrorMessage(error){
 return messages[error?.code]??(error?.name==='TimeoutError'?'更新连接超时，请稍后重试。':'更新操作失败，请检查发布文件、网络或兼容性。');
}
