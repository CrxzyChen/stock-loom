import fs from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';

// Publish beside the chosen target only after the complete copy is verified.
// A failed export keeps the service's original archive and any pending file.
export async function saveBackup(backup,destination,io=fs){
  if(!path.isAbsolute(destination)||!path.isAbsolute(backup.path)||!Number.isSafeInteger(backup.bytes)||backup.bytes<0||!/^[a-f0-9]{64}$/.test(backup.sha256))throw Error('备份保存参数无效。');
  const pending=path.join(path.dirname(destination),'.stock-backup-'+randomUUID()+'.pending');
  try{
    await io.copyFile(backup.path,pending,constants.COPYFILE_EXCL);
    const stat=await io.stat(pending);
    if(stat.size!==backup.bytes)throw Error('备份副本大小不一致，未替换目标文件。');
    const digest=createHash('sha256');
    for await(const chunk of createReadStream(pending))digest.update(chunk);
    if(digest.digest('hex')!==backup.sha256)throw Error('备份副本校验失败，未替换目标文件。');
    const handle=await io.open(pending,'r+');
    try{await handle.sync()}finally{await handle.close()}
    await io.rename(pending,destination);
  }catch(error){
    if(error?.code==='ENOSPC')throw Error('STORAGE_FULL: 保存目标磁盘空间不足。请腾出空间后重试；已有目标文件未被替换，本地原始备份仍保留。');
    throw error;
  }
}
