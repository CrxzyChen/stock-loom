import MarkdownIt from 'markdown-it';
import {projectLink} from './project-links.mjs';

const markdown=new MarkdownIt({html:false,linkify:true,breaks:true});
const escape=markdown.utils.escapeHtml;
markdown.renderer.rules.link_open=(tokens,index,options,env)=>{
 const target=tokens[index].attrGet('href')??'';
 const file=projectLink(target,env.project);
 if(file)return `<a href="#" class="file-reference" data-project-file="${escape(file)}">`;
 if(/^https?:\/\//i.test(target))return `<a href="${escape(target)}" target="_blank" rel="noopener noreferrer">`;
 return '<a>';
};
// Keep model-provided images passive; rendering a response must not fetch URLs.
markdown.renderer.rules.image=(tokens,index)=>escape(tokens[index].content||'图片');
export function renderCopilotMarkdown(text,project){return markdown.render(text??'',{project})}
