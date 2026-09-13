export function projectLink(target,project,documentPath){
 if(typeof target!=='string'||typeof project!=='string')return null;
 let value=target.trim().replace(/^<|>$/g,'');try{value=decodeURIComponent(value)}catch{return null}
 if(value.startsWith('#'))return null;
 value=value.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/,'').replaceAll('\\','/');
 const root=project.replaceAll('\\','/').replace(/\/$/,'');
 if(value.includes('\0')||value.length>1900||/^[a-z][a-z\d+.-]*:/i.test(value)&&! /^[a-z]:\//i.test(value))return null;
 const absolute=/^(?:[a-z]:\/|\/)/i.test(value);
 if(absolute){
  const insensitive=/^[a-z]:\//i.test(root),a=insensitive?value.toLowerCase():value,b=insensitive?root.toLowerCase():root;
  if(!a.startsWith(b+'/'))return null;value=value.slice(root.length+1);
 }
 if(documentPath&&!absolute){
  const base=projectLink(documentPath,project);if(!base)return null;
  const normalized=base.split('/').slice(0,-1);
  for(const part of value.split('/')){if(part==='..'){if(!normalized.length)return null;normalized.pop()}else if(part!=='.'&&part!=='')normalized.push(part)}
  value=normalized.join('/');
 }
 const parts=value.split('/');if(parts.some(p=>p==='..'||p.includes(':'))||!parts.at(-1))return null;
 value=parts.filter(p=>p!=='.'&&p!=='').join('/');return value||null;
}
// Render text through Vue interpolation; links never become HTML or executable URLs.
export function projectTextParts(text,project){
 const parts=[];let at=0;const pattern=/\[([^\]\n]{1,200})\]\((<[^>\n]+>|[^)\n]+)\)/g;
 for(const match of text.matchAll(pattern)){
  const file=projectLink(match[2],project);if(!file)continue;
  if(match.index>at)parts.push({text:text.slice(at,match.index)});parts.push({text:match[1],file});at=match.index+match[0].length;
 }
 if(at<text.length)parts.push({text:text.slice(at)});return parts;
}
