// Coalesce refreshes without dropping a request made during an in-flight read.
export function createRefreshQueue(read){
 let pending=null,requested=false;
 return function refresh(){
  requested=true;
  if(!pending)pending=(async()=>{
   try{while(requested){requested=false;await read()}}
   finally{pending=null}
  })();
  return pending;
 };
}
