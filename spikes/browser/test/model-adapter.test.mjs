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
