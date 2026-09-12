import fs from 'node:fs/promises';
import path from 'node:path';
export const zoomLevels=[0.75,0.9,1,1.1,1.25,1.5];
export async function readWindowZoom(directory){
  try{const value=JSON.parse(await fs.readFile(path.join(directory,'window-view.json'),'utf8'));return zoomLevels.includes(value.zoom)?value.zoom:1}catch{return 1}
}
export async function saveWindowZoom(directory,zoom){
  if(!zoomLevels.includes(zoom))throw Error('请选择支持的缩放比例。');
  await fs.mkdir(directory,{recursive:true});
  const file=path.join(directory,'window-view.json');
  await fs.writeFile(file+'.pending',JSON.stringify({version:1,zoom})+'\n');
  await fs.rename(file+'.pending',file);
}
