// Spike-local transport: Omega's Anthropic wire shape -> OpenAI Responses.
// Task orchestration, eval execution and state remain in Omega.
import http from 'node:http';
import fs from 'node:fs/promises';
const remembered=new Map();
export function toResponses(b) {
  const input=[];
  for(const m of b.messages || [])for(const c of m.content || []){
    if(c.type==='text')input.push({role:m.role,content:c.text});
    if(c.type==='tool_use'){
      const original=remembered.get(c.id);
      if(original)input.push(...original);
      else input.push({type:'function_call',call_id:c.id,name:c.name,arguments:JSON.stringify(c.input)});
    }
    if(c.type==='tool_result')input.push({type:'function_call_output',call_id:c.tool_use_id,output:typeof c.content==='string'?c.content:JSON.stringify(c.content)});
  }
  return {model:b.model,input,instructions:(b.system || []).map(x=>x.text).join('\n'),
    tools:(b.tools || []).map(t=>({type:'function',name:t.name,description:t.description,parameters:t.input_schema,strict:false})),
    parallel_tool_calls:false,max_output_tokens:b.max_tokens,store:false,reasoning:{effort:'low'},include:['reasoning.encrypted_content']};
}
export function fromResponses(j) {
  const content=[];let reasoning=[];
  for(const o of j.output || []){
    if(o.type==='reasoning')reasoning.push(o);
    if(o.type==='message')for(const c of o.content || [])if(c.type==='output_text')content.push({type:'text',text:c.text});
    if(o.type==='function_call'){
      remembered.set(o.call_id,[...reasoning,o]);reasoning=[];
      content.push({type:'tool_use',id:o.call_id,name:o.name,input:JSON.parse(o.arguments)});
    }
  }
  const cached=j.usage?.input_tokens_details?.cached_tokens || 0;
  return {id:j.id,type:'message',role:'assistant',model:j.model,content,
    stop_reason:j.status==='incomplete'?'max_tokens':content.some(c=>c.type==='tool_use')?'tool_use':'end_turn',
    usage:j.usage?{input_tokens:j.usage.input_tokens-cached,cache_read_input_tokens:cached,output_tokens:j.usage.output_tokens}:undefined};
}
if(process.argv[1]?.endsWith('model-adapter.mjs')){
  const server=http.createServer(async(req,res)=>{
    try {
      if(req.url!=='/v1/messages' || req.method!=='POST'){res.writeHead(404);return res.end();}
      let raw='';for await(const c of req){raw+=c;if(raw.length>4e6)throw Error('Request too large');}
      const b=JSON.parse(raw);
      const r=await fetch((process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')+'/responses',{
        method:'POST',headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
        body:JSON.stringify(toResponses(b)),signal:AbortSignal.timeout(240000)});
      const j=await r.json();
      const record={at:new Date().toISOString(),status:r.status,id:j.id,model:j.model,usage:j.usage,error:j.error};
      await fs.appendFile(process.env.BROWSER_DEMO_ROOT+'/provider-usage.jsonl',JSON.stringify(record)+'\n',{mode:0o600});
      res.writeHead(r.status,{'content-type':'application/json'});res.end(JSON.stringify(r.ok?fromResponses(j):j));
    }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:error.message}}));}
  });
  server.listen(8798,'127.0.0.1',()=>console.log('Spike model transport: localhost:8798 -> OpenAI Responses (usage recorded)'));
}
