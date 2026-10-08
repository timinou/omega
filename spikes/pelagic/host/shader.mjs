// Shadertone browser backend. A failed compile preserves the previous program.
import {audioFeatures} from './features.mjs';
const VERTEX='attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}';
const HEADER=`precision highp float;
uniform vec3 iResolution;
uniform float iGlobalTime;
uniform float iTime;
uniform float iOvertoneVolume;
uniform float iAudioBass;
uniform float iAudioMid;
uniform float iAudioHigh;
uniform float iAudioOnset;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec4 iMouse;
uniform vec4 iDate;
uniform float iChannelTime[4];
uniform vec3 iChannelResolution[4];
`;
export class ShaderStage {
  constructor(canvas) {
    this.canvas=canvas;this.gl=canvas.getContext('webgl',{antialias:false,preserveDrawingBuffer:true,alpha:false});
    if(!this.gl)throw new Error('WebGL unavailable');
    const g=this.gl;
    this.buffer=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),g.STATIC_DRAW);
    this.audioTex=this.texture();this.empty=this.texture();this.previous=this.texture();g.bindTexture(g.TEXTURE_2D,this.previous);g.texImage2D(g.TEXTURE_2D,0,g.RGB,1,1,0,g.RGB,g.UNSIGNED_BYTE,new Uint8Array([0,0,0]));this.audio=new Uint8Array(512*2*4);
    this.fft=new Uint8Array(1024);this.wave=new Uint8Array(2048);this.uniforms={};this.frames=0;this.disposed=false;
    this.mouse=[0,0,0,0];
    this.move=e=>{const r=canvas.getBoundingClientRect();this.mouse[0]=(e.clientX-r.left)*canvas.width/r.width;this.mouse[1]=(r.bottom-e.clientY)*canvas.height/r.height;};
    this.down=e=>{this.move(e);this.mouse[2]=this.mouse[0];this.mouse[3]=this.mouse[1];};
    this.up=()=>{this.mouse[2]=-Math.abs(this.mouse[2]);this.mouse[3]=-Math.abs(this.mouse[3]);};
    canvas.addEventListener('pointermove',this.move);canvas.addEventListener('pointerdown',this.down);canvas.addEventListener('pointerup',this.up);
  }
  texture(){const g=this.gl,t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,1,1,0,g.RGBA,g.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));return t;}
  prepare(source) {
    const g=this.gl,created=[];
    const compile=(type,src)=>{const s=g.createShader(type);created.push(s);g.shaderSource(s,src);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw new Error(g.getShaderInfoLog(s));return s;};
    let p;
    try {
      // Upstream implicit uniforms are injected unless the source declares them.
      const header=HEADER.split('\n').filter(line=>{const m=line.match(/uniform \w+ (\w+)/);return !m || !new RegExp(`uniform\\s+\\w+\\s+${m[1]}\\b`).test(source);}).join('\n');
      const src=header+'\n#line 1\n'+source+(/void\s+main\s*\(/.test(source)?'':'\nvoid main(){mainImage(gl_FragColor,gl_FragCoord.xy);}\n');
      p=g.createProgram();g.attachShader(p,compile(g.VERTEX_SHADER,VERTEX));g.attachShader(p,compile(g.FRAGMENT_SHADER,src));g.linkProgram(p);
      if(!g.getProgramParameter(p,g.LINK_STATUS))throw new Error(g.getProgramInfoLog(p));
    } catch(e) {created.forEach(s=>g.deleteShader(s));if(p)g.deleteProgram(p);throw e;}
    created.forEach(s=>g.deleteShader(s));
    return {program:p,locations:new Map(),source};
  }
  activate(candidate,retain=false){
    if(!retain&&this.program&&this.program!==candidate.program)this.gl.deleteProgram(this.program);
    this.program=candidate.program;this.locations=candidate.locations;this.source=candidate.source;
    const g=this.gl;g.useProgram(this.program);const at=g.getAttribLocation(this.program,'position');
    g.bindBuffer(g.ARRAY_BUFFER,this.buffer);if(at>=0){g.enableVertexAttribArray(at);g.vertexAttribPointer(at,2,g.FLOAT,false,0,0);}
  }
  compile(source){this.activate(this.prepare(source));return true;
  }
  uniform(name,value) {
    const g=this.gl,p=this.program;if(!p)return;
    let loc=this.locations.get(name);if(loc===undefined){loc=g.getUniformLocation(p,name);this.locations.set(name,loc);}
    if(loc===null)return;
    if(Array.isArray(value)){const f=g[`uniform${value.length}fv`];if(f)f.call(g,loc,value);}
    else g.uniform1f(loc,value);
  }
  draw({time=0,beat=0,scene=0,energy=.2,accent=0,analyser=null,width,height,signals={},target=null,controls={}}={}) {
    if(this.disposed||!this.program)return;
    const g=this.gl,c=this.canvas;
    const w=width||Math.max(2,Math.round(c.clientWidth*Math.min(devicePixelRatio||1,1)*.8)),h=height||Math.max(2,Math.round(c.clientHeight*Math.min(devicePixelRatio||1,1)*.8));
    if(!target&&(c.width!==w||c.height!==h)){c.width=w;c.height=h;g.bindTexture(g.TEXTURE_2D,this.previous);g.texImage2D(g.TEXTURE_2D,0,g.RGB,w,h,0,g.RGB,g.UNSIGNED_BYTE,null);}
    let volume=0;
    if(analyser){analyser.getByteFrequencyData(this.fft);analyser.getByteTimeDomainData(this.wave);
      for(let i=0;i<this.wave.length;i++){const x=(this.wave[i]-128)/128;volume+=x*x;}volume=Math.sqrt(volume/this.wave.length);
    }else{this.fft.fill(0);this.wave.fill(128);}
    this.features=audioFeatures(this.fft,this.wave,{sampleRate:analyser?.context?.sampleRate??analyser?.sampleRate??44100,
      fftSize:analyser?.fftSize??2048,minDecibels:analyser?.minDecibels??-100,maxDecibels:analyser?.maxDecibels??-30});
    for(let i=0;i<512;i++)for(let row=0;row<2;row++){const x=row===0?this.fft[i*2]:this.wave[i*4],at=(row*512+i)*4;this.audio[at]=x;this.audio[at+1]=x;this.audio[at+2]=x;this.audio[at+3]=255;}
    g.bindFramebuffer(g.FRAMEBUFFER,target);g.viewport(0,0,w,h);g.useProgram(this.program);
    for(const [index,tex] of [[0,this.audioTex],[1,this.previous],[2,this.empty],[3,this.empty]]){g.activeTexture(g.TEXTURE0+index);g.bindTexture(g.TEXTURE_2D,tex);g.uniform1i(g.getUniformLocation(this.program,'iChannel'+index),index);}
    g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.audioTex);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,512,2,0,g.RGBA,g.UNSIGNED_BYTE,this.audio);
    this.uniform('iResolution',[w,h,1]);this.uniform('iGlobalTime',time);this.uniform('iTime',time);
    this.uniform('iOvertoneVolume',volume);this.uniform('iBeat',beat);this.uniform('iScene',scene);this.uniform('iEnergy',energy);this.uniform('iAccent',accent);
    this.uniform('iAudioBass',Math.max(this.features.bass,(signals.bass?.level||0)*1.5));this.uniform('iAudioMid',this.features.mid);
    this.uniform('iAudioHigh',this.features.high);this.uniform('iAudioOnset',Math.max(this.features.onset,signals.kick?.onset||0,controls.accent||0));
    for(const key of ['kick','bass','hat','snare','melody','atmosphere'])this.uniform('iStem'+key[0].toUpperCase()+key.slice(1),signals[key]?.level||0);
    this.uniform('iZoom',controls.zoom||0);this.uniform('iIntensity',controls.intensity??1);this.uniform('iSymmetry',controls.symmetry??6);
    this.uniform('iPalette',controls.palette??0);this.uniform('iFeedback',controls.feedback??0);
    this.uniform('iMouse',this.mouse);const now=new Date();this.uniform('iDate',[now.getFullYear(),now.getMonth()+1,now.getDate(),now.getHours()*3600+now.getMinutes()*60+now.getSeconds()]);
    const tl=g.getUniformLocation(this.program,'iChannelTime[0]');if(tl)g.uniform1fv(tl,[time,time,time,time]);
    const rl=g.getUniformLocation(this.program,'iChannelResolution[0]');if(rl)g.uniform3fv(rl,[512,2,1,w,h,1,1,1,1,1,1,1]);
    for(const [name,value] of Object.entries(this.uniforms))this.uniform(name,value);
    g.drawArrays(g.TRIANGLE_STRIP,0,4);
    g.activeTexture(g.TEXTURE1);g.bindTexture(g.TEXTURE_2D,this.previous);g.copyTexSubImage2D(g.TEXTURE_2D,0,0,0,0,0,w,h);
    this.frames++;this.volume=volume;
  }
  dispose({lose=true}={}){if(this.disposed)return;this.disposed=true;const g=this.gl;if(this.program)g.deleteProgram(this.program);g.deleteBuffer(this.buffer);g.deleteTexture(this.audioTex);g.deleteTexture(this.previous);g.deleteTexture(this.empty);this.canvas.removeEventListener('pointermove',this.move);this.canvas.removeEventListener('pointerdown',this.down);this.canvas.removeEventListener('pointerup',this.up);if(lose)g.getExtension('WEBGL_lose_context')?.loseContext();}
}
