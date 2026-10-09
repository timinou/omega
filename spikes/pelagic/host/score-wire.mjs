// The realm boundary restores BL's shared graph catalog. No score computation.
import {prepareGraph} from './audio.mjs';
export function freezeGraph(graph){
 let count=0;
 const visit=(value,depth=0)=>{
  if(++count>4096||depth>64)throw new Error('Preparation graph exceeds bounds');
  if(value&&typeof value==='object'){for(const child of Object.values(value))visit(child,depth+1);Object.freeze(value);}
 };
 visit(graph);prepareGraph(graph);return graph;
}
export function scoreDecoder(){
 const graphs=[];
 return {
  decode(packet){
   if(!Array.isArray(packet.graphs)||graphs.length+packet.graphs.length>64)throw new Error('Invalid preparation graph catalog');
   const additions=packet.graphs.map((entry,i)=>{
    if(entry?.id!==graphs.length+i)throw new Error('Out-of-order preparation graph');
    return freezeGraph(entry.graph);
   });
   const catalog=graphs.concat(additions);
   const rows=packet.rows.map(row=>{
    if(!Array.isArray(row)||row.length>64)throw new Error('Invalid preparation row');
    return row.map(voice=>{
     if(!voice||typeof voice!=='object'||!Number.isInteger(voice.graph)||voice.graph<0||voice.graph>=catalog.length)throw new Error('Unknown preparation graph');
     return {...voice,graph:catalog[voice.graph]};
    });
   });
   graphs.push(...additions);return rows;
  },
  get size(){return graphs.length;}
 };
}
