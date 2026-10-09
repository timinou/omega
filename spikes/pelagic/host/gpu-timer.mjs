// Nonblocking GPU evidence; never wait for a result or grow an unbounded queue.
// https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query/
export class GpuTimer {
 constructor(gl){this.gl=gl;this.ext=gl.getExtension('EXT_disjoint_timer_query');this.pending=[];this.active=null;this.histogram=new Uint32Array(1001);this.count=0;this.max=0;this.last=0;this.disjoint=0;}
 begin(){if(!this.ext||this.active||this.pending.length>=4)return;this.active=this.ext.createQueryEXT();this.ext.beginQueryEXT(this.ext.TIME_ELAPSED_EXT,this.active);}
 end(){if(!this.active)return;this.ext.endQueryEXT(this.ext.TIME_ELAPSED_EXT);this.pending.push(this.active);this.active=null;}
 poll(){const e=this.ext;if(!e)return;
  if(this.gl.getParameter(e.GPU_DISJOINT_EXT)){this.disjoint+=this.pending.length;for(const q of this.pending)e.deleteQueryEXT(q);this.pending=[];this.last=0;return;}
  while(this.pending.length&&e.getQueryObjectEXT(this.pending[0],e.QUERY_RESULT_AVAILABLE_EXT)){
   const q=this.pending.shift(),ms=e.getQueryObjectEXT(q,e.QUERY_RESULT_EXT)/1e6;e.deleteQueryEXT(q);
   if(!Number.isFinite(ms)||ms<0)continue;this.last=ms;this.max=Math.max(this.max,ms);this.histogram[Math.min(1000,Math.round(ms*10))]++;this.count++;
  }
 }
 report(){let sum=0,p95=null;for(let i=0;this.count&&i<this.histogram.length;i++){sum+=this.histogram[i];if(sum>=this.count*.95){p95=i/10;break;}}return {available:!!this.ext,samples:this.count,p95Ms:p95,maxMs:this.max,pending:this.pending.length,disjoint:this.disjoint};}
 dispose(){if(!this.ext)return;this.end();for(const q of this.pending)this.ext.deleteQueryEXT(q);this.pending=[];}
}
