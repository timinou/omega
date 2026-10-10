import crypto from 'node:crypto';
import {publicURL} from './sessions.mjs';

// Human-only host operations. Passwords, OTP seeds, OAuth tokens and item fields
// never cross this interface. Collection and approval happen on provider pages.
export class Credentials {
  constructor(manager){this.manager=manager;}
  async operation(id,verb,args={}){
    const m=this.manager,s=m.get(id);
    return m.lock(s,async()=>{
      if(s.status!=='running'||s.control!=='human')throw Error('Take human control before managing credentials.');
      if(s.provider==='native'){
        if(!['install-extension','extensions'].includes(verb))throw Error('Native credentials live in the browser extension. Use 1Password in the browser toolbar.');
        const url=verb==='extensions'?'chrome://extensions/':'https://chromewebstore.google.com/detail/1password-%E2%80%93-password-manag/aeblfdkhhhdcdjpifhhbdiojplfjncoa';
        await m.adapter.openHumanPage(s,url);s.url=url;m.event(s,'credentials/'+verb);await m.persist();return {status:'opened',type:'native-extension'};
      }
      const api=m.adapter.api(),vault=s.vaultId;
      if(!vault)throw Error('This browser has no credential vault. Reopen it with Kernel.');
      const options={id_or_name:vault};
      if(verb==='connect')return summarize(await api.vaults.items.upsert('1password-account',{
        ...options,type:'credential_account',spec:{provider:'1password',authorization:{method:'oauth',client:{type:'kernel_managed'}}}}));
      // Read the actual active page, never trust a URL supplied by the client.
      const pageURL=publicURL((await m.run(s,['get','url'])).url),origin=new URL(pageURL).origin;
      if(!origin.startsWith('https://'))throw Error('Credentials require an HTTPS website.');
      const hash=crypto.createHash('sha256').update(origin).digest('hex').slice(0,24);
      const binding=s.credentialKeys[origin] ||= {onepassword:`1pw-${hash}`,kernel:`login-${hash}`};
      await m.persist();
      let item;
      if(verb==='request'){
        const account=await api.vaults.items.retrieve('1password-account',options);
        if(account.state?.status!=='connected')throw Error('Connect your 1Password account first.');
        try{const previous=await api.vaults.items.retrieve(binding.onepassword,options);if(['failed','declined'].includes(previous.state?.status)){binding.onepassword=`1pw-${hash}-${crypto.randomUUID().slice(0,8)}`;await m.persist();}}catch(e){if(e.status!==404)throw e;}
        item=await api.vaults.items.upsert(binding.onepassword,{...options,type:'credential',spec:{provider:'1password',account:'1password-account',
          requests:{version:2,goal:'Sign in to the selected website',entries:[{type:'login',parameters:{website:origin},reason:'Use this website in Omega'}]}}});
        if(item.available_operations?.some(op=>op.type==='1pw_create_access_request'))item=await api.vaults.items.performOperation(binding.onepassword,{...options,type:'1pw_create_access_request',browser_id:s.kernelId});
      }else if(verb==='status'){
        item=await api.vaults.items.retrieve(binding.onepassword,options);
        if(item.available_operations?.some(op=>op.type==='1pw_access_request_status'))item=await api.vaults.items.performOperation(binding.onepassword,{...options,type:'1pw_access_request_status',browser_id:s.kernelId,timeout_seconds:1});
      }else if(verb==='fill'){
        if(binding.fillUnknown===s.kernelId)throw Error('The previous 1Password submission is uncertain. Inspect the website; do not retry in this browser.');
        item=await api.vaults.items.retrieve(binding.onepassword,options);
        if(!item.available_operations?.some(op=>op.type==='1pw_fill'))throw Error('1Password approval is not ready. Check approval status first.');
        // Mark unknown BEFORE issuing a submitting operation. A lost HTTP response
        // must not permit an accidental duplicate submission after host recovery.
        binding.fillUnknown=s.kernelId;await m.persist();
        item=await api.vaults.items.performOperation(binding.onepassword,{...options,type:'1pw_fill',browser_id:s.kernelId,page_url:pageURL});
        if(item.status!=='fill_unknown')binding.fillUnknown=false;
      }else if(verb==='collect'){
        item=await api.vaults.items.upsert(binding.kernel,{...options,type:'credential',spec:{provider:'kernel',description:new URL(origin).hostname,
          fields:[{name:'username',label:'Username or email',type:'text',required:true,sensitive:true},{name:'password',label:'Password',type:'password',required:true,sensitive:true}]}});
        if(item.available_operations?.some(op=>op.type==='collect'))item=await api.vaults.items.performOperation(binding.kernel,{...options,type:'collect'});
      }else if(verb==='fill-kernel'){
        item=await api.vaults.items.retrieve(binding.kernel,options);
        if(!item.available_operations?.some(op=>op.type==='fill'))throw Error('The saved login is not ready. Complete the secure credential form first.');
        const fields=['username','password'].map(field=>{
          const selector=args[field];if(typeof selector!=='string'||!selector.trim()||selector.length>512)throw Error('Supply a CSS selector for each login field.');return {field,selector};
        });
        item=await api.vaults.items.performOperation(binding.kernel,{...options,type:'fill',browser_id:s.kernelId,page_url:pageURL,fields});
      }else throw Error('Unknown credential operation');
      s.url=pageURL;m.event(s,'credentials/'+verb,{origin});await m.persist();
      return {...summarize(item),origin};
    });
  }
}
function summarize(item){
  return {type:item.type,status:item.state?.status || item.status || 'unknown',errorCode:item.error_code,
    ...(item.action?.url?{action:{name:item.action.name,url:item.action.url}}:{}),
    operations:(item.available_operations||[]).map(op=>op.type)};
}
