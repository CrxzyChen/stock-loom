import http from 'node:http';
export async function responseFixture(record,secret,control={}){
const server=http.createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString();record.requests.push({path:req.url,method:req.method,authenticated:req.headers.authorization==='Bearer '+secret,model:body?JSON.parse(body).model:null});
 if(req.method!=='POST'||req.url!=='/v1/responses'){res.writeHead(404);res.end();return}
 if(control.fail){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Synthetic provider failure for recovery verification',type:'invalid_request_error',code:'fixture_failure'}}));return}
 const text='CONNECTION_OK',item={id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[],logprobs:[]}]},response={id:'resp_fixture',object:'response',created_at:1,model:'fixture-model',status:'completed',output:[item],usage:{input_tokens:5,output_tokens:2,total_tokens:7,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});let sequence_number=0;const send=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,sequence_number:sequence_number++,...value})}\n\n`);
 send('response.created',{response:{...response,status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});send('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});send('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:text});send('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text});send('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part:item.content[0]});send('response.output_item.done',{output_index:0,item});send('response.completed',{response});res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
return server;
}
