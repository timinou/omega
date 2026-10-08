// One WebGL context, three bounded layer targets, audio-clock transition progress.
import {ShaderStage} from './shader.mjs';
const COMPOSITE=`precision mediump float;
uniform vec3 iResolution;uniform sampler2D a;uniform sampler2D b;uniform sampler2D c;
uniform float progress;uniform float overlay;uniform float mode;
void main(){vec2 uv=gl_FragCoord.xy/iResolution.xy;float f=progress;
 if(mode>1.5)f=smoothstep(length(uv-.5)*1.5-.08,length(uv-.5)*1.5+.08,progress);
 else if(mode>.5){float h=fract(sin(dot(floor(uv*140.),vec2(12.9898,78.233)))*43758.5453);f=smoothstep(h-.06,h+.06,progress);}
 vec3 base=mix(texture2D(a,uv).rgb,texture2D(b,uv).rgb,clamp(f,0.,1.));
 vec3 accent=texture2D(c,uv).rgb;gl_FragColor=vec4(1.-(1.-base)*(1.-accent*overlay),1.);}`;
const NAMES=['bathymetry','current','cathedral','afterglow'];
export class SceneStage extends ShaderStage {
  constructor(canvas){super(canvas);this.pool=new Map();this.targets=[];this.visual=null;this.transition=null;this.size='';
    this.compositor=this.prepare(COMPOSITE);this.defaultPrevious=this.previous;
    for(let i=0;i<3;i++)this.targets.push({texture:this.texture(),framebuffer:this.gl.createFramebuffer(),previous:this.texture()});
  }
  cached(source){
    if(!this.pool.has(source))this.pool.set(source,this.prepare(source));
    return this.pool.get(source);
  }
  compile(source){this.baseSource=source;const c=this.cached(source);this.activate(c,true);return true;}
  validateState(state){
    const visual=state.visual;
    if(typeof visual.scene!=='string')throw new Error('Primary scene must have a name');
    if(visual.shader)this.cached(visual.shader);
    for(const name of [visual.scene,visual.overlay].filter(Boolean)) {
      if(!NAMES.includes(name)&&!state.scenes[name])throw new Error('Unknown scene '+name);
      this.cached(state.scenes[name]?.shader||visual.shader||this.baseSource);
    }
    for(const definition of Object.values(state.scenes))this.cached(definition.shader);
    this.prune([state]);return true;
  }
  prune(extra=[]){
    const protectedSources=new Set([this.baseSource,this.source]);
    for(const state of [this.visual,this.transition?.from,...extra])if(state)for(const name of [state.visual.scene,state.visual.overlay].filter(Boolean))protectedSources.add(state.scenes[name]?.shader||state.visual.shader||this.baseSource);
    for(const [source,c] of this.pool)if(this.pool.size>10&&!protectedSources.has(source)){this.gl.deleteProgram(c.program);this.pool.delete(source);}
  }
  setState(state,beat){
    const signature=s=>JSON.stringify([s.visual,...[s.visual.scene,s.visual.overlay].filter(Boolean).map(name=>s.scenes[name])]);
    if(this.visual&&signature(this.visual)!==signature(state))this.transition={from:this.visual,start:beat,end:beat+state.visual.beats};
    this.visual=state;this.prune();
  }
  reset(){this.transition=null;const g=this.gl;for(const target of this.targets){g.bindTexture(g.TEXTURE_2D,target.previous);g.texImage2D(g.TEXTURE_2D,0,g.RGB,1,1,0,g.RGB,g.UNSIGNED_BYTE,new Uint8Array([0,0,0]));}this.size='';}
  draw(options={}){
    if(!this.visual){super.draw(options);return;}
    const g=this.gl,c=this.canvas,outputW=options.width||Math.max(2,Math.round(c.clientWidth*.8)),outputH=options.height||Math.max(2,Math.round(c.clientHeight*.8));
    const scale=options.width?.75:1,w=Math.round(outputW*scale),h=Math.round(outputH*scale);this.renderSize=[w,h];
    if(c.width!==outputW||c.height!==outputH){c.width=outputW;c.height=outputH;}
    if(this.size!==w+'x'+h){this.size=w+'x'+h;
      for(const target of this.targets){g.bindTexture(g.TEXTURE_2D,target.texture);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,w,h,0,g.RGBA,g.UNSIGNED_BYTE,null);
        g.bindFramebuffer(g.FRAMEBUFFER,target.framebuffer);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,target.texture,0);
        if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('Scene framebuffer unavailable');
        g.bindTexture(g.TEXTURE_2D,target.previous);g.texImage2D(g.TEXTURE_2D,0,g.RGB,w,h,0,g.RGB,g.UNSIGNED_BYTE,null);}}
    const visual=this.visual.visual,progress=this.transition?Math.max(0,Math.min(1,(options.beat-this.transition.start)/(this.transition.end-this.transition.start))):1;
    const layers=[this.transition?.from||null,this.visual,visual.overlay?this.visual:null];
    const savedUniforms=this.uniforms;
    layers.forEach((state,index)=>{
      const target=this.targets[index];
      if(!state){g.bindFramebuffer(g.FRAMEBUFFER,target.framebuffer);g.clearColor(0,0,0,1);g.clear(g.COLOR_BUFFER_BIT);return;}
      const name=index===2?visual.overlay:state.visual.scene,definition=state.scenes[name]||{};
      this.activate(this.cached(definition.shader||state.visual.shader||this.baseSource),true);
      this.previous=target.previous;this.uniforms={...savedUniforms,...state.visual.uniforms};
      const signals=options.signals||{};
      const controls={...state.visual,...definition.controls};
      for(const [key,mapping] of Object.entries(definition.mappings||{})) {
        const [scope,stem,feature]=mapping.signal;let value=signals[scope==='deck'?'deck-'+stem:scope==='master'?'master':stem]?.[feature]||0;if(feature==='pitch')value=Math.max(0,Math.min(1,Math.log2(Math.max(20,value)/20)/10));
        controls[key]=(controls[key]||0)+value*mapping.amount;
      }
      for(const [key,lo,hi] of [['zoom',0,.5],['accent',0,1],['intensity',.1,2],['symmetry',3,16],['feedback',0,.7],['palette',0,1]])if(controls[key]!==undefined)controls[key]=Math.max(lo,Math.min(hi,controls[key]));
      super.draw({...options,width:w,height:h,scene:definition.scene??Math.max(0,NAMES.indexOf(name)),target:target.framebuffer,controls});
    });
    this.uniforms=savedUniforms;this.previous=this.defaultPrevious;
    this.activate(this.compositor,true);g.bindFramebuffer(g.FRAMEBUFFER,null);g.viewport(0,0,outputW,outputH);this.uniform('iResolution',[outputW,outputH,1]);
    this.targets.forEach((target,index)=>{g.activeTexture(g.TEXTURE0+index);g.bindTexture(g.TEXTURE_2D,target.texture);g.uniform1i(g.getUniformLocation(this.program,['a','b','c'][index]),index);});
    this.uniform('progress',progress);this.uniform('overlay',visual.mix);this.uniform('mode',visual.transition==='iris'?2:visual.transition==='dissolve'?1:0);
    g.drawArrays(g.TRIANGLE_STRIP,0,4);if(progress>=1)this.transition=null;
  }
  resources(){return {programs:this.disposed?0:this.pool.size+1,targets:this.targets.length,renderSize:this.renderSize,outputSize:[this.canvas.width,this.canvas.height],transition:!!this.transition};}
  dispose(options){if(this.disposed)return;const g=this.gl;
    for(const c of this.pool.values())g.deleteProgram(c.program);this.pool.clear();
    for(const t of this.targets){g.deleteFramebuffer(t.framebuffer);g.deleteTexture(t.texture);g.deleteTexture(t.previous);}this.targets=[];
    g.deleteProgram(this.compositor.program);this.program=null;super.dispose(options);}
}
