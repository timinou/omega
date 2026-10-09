import {KernelBrowser} from '../kernel.mjs';
export function fixture({page}={}){
  const calls=[],profiles=new Map(),browsers=new Map(),items=new Map();let serial=0,clock=1000;
  const stamp=()=>new Date(++clock).toISOString();
  const missing=()=>{throw Object.assign(Error('not found'),{status:404});};
  const record=(name,fn)=>(...a)=>{calls.push([name,...a]);return fn(...a);};
  const sdk={
    profiles:{
      retrieve:record('profiles.retrieve',async name=>profiles.get(name)||[...profiles.values()].find(p=>p.id===name)||missing()),
      create:record('profiles.create',async({name})=>{if(profiles.has(name))throw Object.assign(Error('conflict'),{status:409});const p={id:'p-'+(++serial),name,updated_at:stamp()};profiles.set(name,p);return p;}),
      delete:record('profiles.delete',async name=>{profiles.delete(name);})},
    vaults:{
      upsert:record('vaults.upsert',async({name})=>({id:'v-'+name,name})),
      delete:record('vaults.delete',async()=>{}),
      items:{
        upsert:record('items.upsert',async(key,body)=>{
          if(items.has(key))return items.get(key);
          const item={key,type:body.type,spec:body.spec,state:{status:body.type==='credential_account'?'pending_authorization':'pending_collection'},available_operations:[],action:{name:body.type==='credential_account'?'1password_oauth':'collect',url:'https://approval.onkernel.com/secret-approval'}};
          if(body.spec.provider==='1password'&&body.type==='credential'){item.state.status='pending_authorization';item.available_operations=[{type:'1pw_create_access_request'}];}
          items.set(key,item);return item;
        }),
        retrieve:record('items.retrieve',async key=>items.get(key)||missing()),
        performOperation:record('items.performOperation',async(key,body)=>{
          if(body.type==='1pw_fill')return {type:'1pw_fill',status:'fill_submitted'};
          if(body.type==='fill')return {type:'fill',status:'completed',fields:[]};
          const item=items.get(key)||missing();
          if(body.type==='1pw_create_access_request'){item.available_operations=[{type:'1pw_access_request_status'}];item.action={name:'1password_access_approval',url:'https://approval.onkernel.com/secret-request'};}
          if(body.type==='1pw_access_request_status'){item.state.status='ready';item.available_operations=[{type:'1pw_fill'}];delete item.action;}
          return item;
        })}},
    browsers:{
      list:record('browsers.list',()=>({async *[Symbol.asyncIterator](){for(const b of browsers.values())if(!b.deleted_at)yield b;}})),
      create:record('browsers.create',async body=>{
        const id='k-'+(++serial),p=[...profiles.values()].find(p=>p.id===body.profile.id);
        const b={session_id:id,name:body.name,headless:body.headless,profile:p,profile_save_changes:true,
          cdp_ws_url:'wss://fixture.onkernel.com/private-cdp-token',browser_live_view_url:'https://fixture.onkernel.com/private-live-token',...body,profile:p};
        browsers.set(id,b);return b;
      }),
      retrieve:record('browsers.retrieve',async name=>browsers.get(name)||[...browsers.values()].find(b=>b.name===name)||missing()),
      deleteByID:record('browsers.delete',async id=>{const b=browsers.get(id)||missing();b.deleted_at=stamp();profiles.get(b.profile.name).updated_at=stamp();}),
      playwright:{execute:record('playwright.execute',async(id,body)=>{
        if(page){const result=await new Function('page','context',`return (async()=>{${body.code}})()`)(page,page.context());return {success:true,result};}
        const args=JSON.parse(body.code.match(/, (\[[^\n]*\])\);$/)[1]);
        const result={url:'https://example.com/',snapshot:'- heading "Test"',png:Buffer.from('png').toString('base64')};
        return {success:true,result:args[0]==='eval'?{result:'[]'}:result};
      })}
    }};
  return {adapter:new KernelBrowser({client:sdk,env:{}}),sdk,calls,profiles,browsers,items};
}
