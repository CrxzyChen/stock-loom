import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

// One atomically persisted association is authoritative for both the selected
// project and its data service. The previous database is never moved or deleted.
export class ProjectData{
  constructor(directory){this.directory=directory;this.file=path.join(directory,'project-data.json');this.state=null;this.changing=false}
  async load(){
    let state;try{state=JSON.parse(await fs.readFile(this.file,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw Error('项目资料关联文件无法读取，原资料保留。')}
    if(state?.version!==1||!Array.isArray(state.bindings)||!state.bindings.length||!state.bindings.every(b=>typeof b.project==='string'&&path.isAbsolute(b.project)&&typeof b.profile==='string'&&path.isAbsolute(b.profile))||!state.bindings.some(b=>b.project===state.activeProject)||new Set(state.bindings.map(b=>b.project)).size!==state.bindings.length)throw Error('项目资料关联无效，原资料保留。');
    this.state=state;return state;
  }
  current(){return this.state.bindings.find(b=>b.project===this.state.activeProject).profile}
  async persist(state){
    await fs.mkdir(this.directory,{recursive:true});const pending=this.file+'.'+randomUUID()+'.pending',handle=await fs.open(pending,'wx');
    try{await handle.writeFile(JSON.stringify(state,null,2));await handle.sync()}finally{await handle.close()}
    await fs.rename(pending,this.file);this.state=state;
  }
  async initialize(project,profile){if(!this.state)await this.persist({version:1,activeProject:await fs.realpath(project),bindings:[{project:await fs.realpath(project),profile:path.resolve(profile)}]});return this.state}
  async switch(project,service){
    if(this.changing)throw Error('正在切换资料库。');this.changing=true;
    const previous=service.args.at(-1);
    try{
      project=await fs.realpath(project);if(project===this.state.activeProject)return;
      const known=this.state.bindings.find(b=>b.project===project);
      const profile=known?.profile??path.join(this.directory,'project-data',createHash('sha256').update(project).digest('hex'));
      if(known)await fs.access(path.join(profile,'stock.sqlite'));
      const next={...this.state,activeProject:project,bindings:known?this.state.bindings:[...this.state.bindings,{project,profile}]};
      await service.stop();service.args[service.args.length-1]=profile;service.restarts=0;
      try{await service.start();const overview=await service.call('overview');await this.persist(next);return overview}
      catch(error){await service.stop();service.args[service.args.length-1]=previous;service.restarts=0;await service.start();throw error}
    }finally{this.changing=false}
  }
  async rebind(service){
    const previous=this.current(),profile=service.args.at(-1);if(previous===profile)return;
    const next={...this.state,bindings:this.state.bindings.map(b=>b.project===this.state.activeProject?{...b,profile}:b)};
    try{await this.persist(next)}catch(error){await service.stop();service.args[service.args.length-1]=previous;await service.start();throw error}
  }
}
