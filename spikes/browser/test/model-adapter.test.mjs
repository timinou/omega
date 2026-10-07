import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toResponses,fromResponses} from '../procurement/model-adapter.mjs';
test('transport preserves tool-call identity, reasoning and inclusive cached input accounting',()=>{
 const raw={id:'r1',model:'fixture',status:'completed',usage:{input_tokens:1000,input_tokens_details:{cached_tokens:400},output_tokens:90},output:[{type:'reasoning',id:'reason1',encrypted_content:'opaque'},{type:'function_call',id:'fc1',call_id:'call1',name:'eval',arguments:'{"code":"(ls)"}'}]};
 const response=fromResponses(raw);
 assert.equal(response.stop_reason,'tool_use');
 assert.deepEqual(response.usage,{input_tokens:600,cache_read_input_tokens:400,output_tokens:90});
 const request=toResponses({model:'fixture',system:[{text:'system'}],messages:[{role:'assistant',content:response.content},{role:'user',content:[{type:'tool_result',tool_use_id:'call1',content:'files'}]}],tools:[{name:'eval',input_schema:{type:'object'}}]});
 assert.equal(request.input[0].type,'reasoning');
 assert.equal(request.input[1].call_id,'call1');
 assert.equal(request.input[2].call_id,'call1');
 assert.equal(request.input[2].output,'files');
 assert.equal(request.store,false);
 assert.equal(request.tools[0].strict,false);
});
test('chat transport preserves reasoning, tool IDs and DeepSeek cache accounting',async()=>{
 const {toChat,fromChat}=await import('../procurement/model-adapter.mjs');
 const result=fromChat({id:'ds1',model:'fixture',choices:[{finish_reason:'tool_calls',message:{reasoning_content:'reason',content:null,tool_calls:[{id:'ds-call',function:{name:'eval',arguments:'{"code":"(ls)"}'}}]}}],usage:{prompt_tokens:700,prompt_cache_hit_tokens:500,completion_tokens:50}});
 assert.deepEqual(result.usage,{input_tokens:200,cache_read_input_tokens:500,output_tokens:50});
 const request=toChat({model:'fixture',messages:[{role:'assistant',content:result.content},{role:'user',content:[{type:'tool_result',tool_use_id:'ds-call',content:'files'}]}]});
 assert.equal(request.messages[1].reasoning_content,'reason');
 assert.equal(request.messages[1].tool_calls[0].id,'ds-call');
 assert.equal(request.messages[2].tool_call_id,'ds-call');
});
