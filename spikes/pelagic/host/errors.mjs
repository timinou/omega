import {plain} from './audio.mjs';
// The self-hosted reader throws structured BL diagnostics, not always JS Error.
export function errorText(error){
 const value=plain(error),message=value?.message??value?.msg??value?.error?.message??value?.error?.msg??(typeof value?.error==='string'?value.error:null);
 if(typeof message==='string')return message+(Number.isInteger(value.line)?' (source line '+value.line+')':'');
 if(typeof value==='string')return value;
 try{return JSON.stringify(value)||String(error);}catch{return String(error);}
}
