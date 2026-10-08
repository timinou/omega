// Web Audio interpreter for pure BL UGen graphs. No score/pattern logic here.
export function plain(x) {
  if (x?.constructor?.name === "Flt") return x.v;
  if (x?.entries && x.constructor?.name === 'HMap') {
    return Object.fromEntries([...x.entries()].map(([k,v]) => [k.fq ?? String(k), plain(v)]));
  }
  if (x?.toArray) return x.toArray().map(plain);
  if (x?.fq) return x.fq;
  return x;
}
export function random(seed = 1) {
  let n = seed >>> 0;
  return () => { n ^= n << 13; n ^= n >>> 17; n ^= n << 5; return (n >>> 0) / 4294967296; };
}
const supported = new Set(['param','sin-osc','saw','pulse','lf-tri','white-noise','pink-noise',
  'mul','add','sub','div','lpf','hpf','rlpf','pan2','env-gen','line','x-line']);
export function validateGraph(g, depth=0) {
  if (depth > 64) throw new Error('UGen graph exceeds 64 levels');
  if (typeof g === 'number') { if (!Number.isFinite(g)) throw new Error('Non-finite UGen value'); return; }
  if (Array.isArray(g)) { g.forEach(v => validateGraph(v,depth+1)); return; }
  if (!g || !supported.has(g.ugen)) throw new Error(`Unsupported UGen: ${g?.ugen ?? String(g)}`);
  for (const [k,v] of Object.entries(g)) {
    if (['in','freq','pan','rq','from','to','dur','inputs'].includes(k)) validateGraph(v,depth+1);
  }
  if (g.ugen === 'env-gen' && !['perc','adsr'].includes(g.envelope?.envelope)) throw new Error('Unsupported envelope');
}
export class AudioEngine {
  constructor(context, config={}) {
    this.ctx=context; this.voices=new Map(); this.serial=0; this.disposed=false;
    this.config={bpm:122,filter:1,space:.45,echo:.32,master:.72,crossfade:.5,'deck-a':.9,'deck-b':.9,...config};
    const c=context;
    this.mix=c.createGain(); this.dry=c.createGain(); this.dry.gain.value=.85;
    this.mix.connect(this.dry);
    this.delay=c.createDelay(4); this.feedback=c.createGain(); this.echo=c.createGain();
    this.delayFilter=c.createBiquadFilter(); this.delayFilter.type='lowpass'; this.delayFilter.frequency.value=3200;
    this.mix.connect(this.delay); this.delay.connect(this.delayFilter);
    this.delayFilter.connect(this.feedback); this.feedback.connect(this.delay);
    this.delayFilter.connect(this.echo);
    this.reverb=c.createConvolver(); this.reverb.buffer=this.impulse(4.8,2607);
    this.wet=c.createGain(); this.mix.connect(this.reverb); this.reverb.connect(this.wet);
    this.compressor=c.createDynamicsCompressor();
    Object.assign(this.compressor.threshold,{value:-13}); this.compressor.knee.value=8;
    this.compressor.ratio.value=12; this.compressor.attack.value=.003; this.compressor.release.value=.22;
    for (const n of [this.dry,this.wet,this.echo]) n.connect(this.compressor);
    this.output=c.createGain(); this.compressor.connect(this.output);
    this.analyser=c.createAnalyser(); this.analyser.fftSize=2048; this.analyser.smoothingTimeConstant=.18;
    this.output.connect(this.analyser); this.analyser.connect(c.destination);
    this.decks={};
    for (const key of ['a','b']) {
      const input=c.createGain(), low=c.createBiquadFilter(), mid=c.createBiquadFilter(), high=c.createBiquadFilter();
      low.type='lowshelf'; low.frequency.value=160;
      mid.type='peaking'; mid.frequency.value=1000; mid.Q.value=.7;
      high.type='highshelf'; high.frequency.value=6000;
      const filter=c.createBiquadFilter(); filter.type='lowpass'; filter.Q.value=.45;
      const duck=c.createGain(), gain=c.createGain();
      input.connect(low); low.connect(mid); mid.connect(high); high.connect(filter); filter.connect(duck); duck.connect(gain); gain.connect(this.mix);
      this.decks[key]={input,low,mid,high,filter,duck,gain};
    }
    this.noise=new Map(); this.configure(this.config,0);
  }
  impulse(seconds,seed) {
    const c=this.ctx,n=Math.floor(c.sampleRate*seconds),buf=c.createBuffer(2,n,c.sampleRate),rng=random(seed);
    for(let ch=0;ch<2;ch++) {
      const a=buf.getChannelData(ch); let smooth=0;
      for(let i=0;i<n;i++) { smooth=.68*smooth+.32*(rng()*2-1); a[i]=smooth*Math.pow(1-i/n,2.5)*(i<600 ? i/600 : 1); }
    }
    return buf;
  }
  noiseBuffer(pink) {
    if(this.noise.has(pink)) return this.noise.get(pink);
    const c=this.ctx,buf=c.createBuffer(1,c.sampleRate*2,c.sampleRate),a=buf.getChannelData(0),rng=random(pink?8123:9187);
    let b0=0,b1=0,b2=0;
    for(let i=0;i<a.length;i++) {
      const w=rng()*2-1;
      b0=.997*b0+.029*w; b1=.97*b1+.11*w; b2=.8*b2+.28*w;
      a[i]=pink ? (b0+b1+b2+w*.15)*.55 : w;
    }
    this.noise.set(pink,buf); return buf;
  }
  configure(values,time=this.ctx.currentTime) {
    Object.assign(this.config,values); const c=this.config;
    const set=(p,v)=>{p.cancelScheduledValues(time);p.setTargetAtTime(v,time,.025);};
    set(this.output.gain,Math.max(0,Math.min(1,c.master)));
    set(this.wet.gain,c.space*.8); set(this.echo.gain,c.echo*.55); set(this.feedback.gain,Math.min(.7,c.echo+.12));
    set(this.delay.delayTime,60/c.bpm*.75);
    for(const [key,d] of Object.entries(this.decks)) {
      const f=key==='a' ? Math.cos(c.crossfade*Math.PI/2) : Math.sin(c.crossfade*Math.PI/2);
      set(d.gain.gain,c['deck-'+key]*f);
      set(d.filter.frequency,Math.min(20000,9000*c.filter*c.filter));
      for(const band of ['low','mid','high']) set(d[band].gain,values[`eq-${key}-${band}`] ?? this.config[`eq-${key}-${band}`] ?? 0);
    }
  }
  trigger(input,time=this.ctx.currentTime) {
    if(this.disposed) throw new Error('Audio engine disposed');
    const v=plain(input); validateGraph(v.graph);
    const c=this.ctx, params=v.params || {}, start=Math.max(time,c.currentTime), owned=[], sources=[], controls=new Map();
    const resolve=x=>x?.ugen==='param' ? (params[x.key] ?? x.default) : x;
    const num=(x)=>{ const y=resolve(x); if(typeof y!=='number'||!Number.isFinite(y)) throw new Error('Expected numeric control'); return y; };
    let release=0;
    const find=x=>{
      if (!x || typeof x !== 'object') return;
      if (x.ugen==='env-gen') release=Math.max(release,x.envelope.envelope==='adsr' ? x.envelope.release : num(x.envelope.release)+num(x.envelope.attack));
      Object.values(x).forEach(y=>{ if(Array.isArray(y))y.forEach(find); else if(typeof y==='object')find(y); });
    };find(v.graph);
    const duration=Math.min(30,Math.max(.03,(params.dur ?? 1)+release+.08)), end=start+duration;
    const own=n=>{owned.push(n);return n;};
    const connect=(value,param)=>{
      if(typeof value==='number') param.value=value;
      else {param.value=0;value.connect(param);}
    };
    const constant=value=>{
      const n=own(c.createConstantSource());n.offset.value=value;n.start(start);n.stop(end);sources.push(n);return n;
    };
    const signal=x=>typeof x==='number'?constant(x):x;
    const compile=x=>{
      if(x?.ugen==='param'){if(!controls.has(x.key))controls.set(x.key,constant(num(x)));return controls.get(x.key);}
      x=resolve(x); if(typeof x==='number')return x;
      if(Array.isArray(x))return sum(x.map(compile));
      switch(x.ugen) {
        case 'sin-osc':case 'saw':case 'pulse':case 'lf-tri': {
          const n=own(c.createOscillator());n.type={'sin-osc':'sine',saw:'sawtooth',pulse:'square','lf-tri':'triangle'}[x.ugen];
          connect(compile(x.freq),n.frequency);n.start(start);n.stop(end);sources.push(n);return n;
        }
        case 'white-noise':case 'pink-noise': {
          const n=own(c.createBufferSource());n.buffer=this.noiseBuffer(x.ugen==='pink-noise');n.loop=true;
          n.start(start,(this.serial*.173)%1.8);n.stop(end);sources.push(n);return n;
        }
        case 'add':return sum(x.inputs.map(compile));
        case 'mul': {
          const a=x.inputs.map(compile);let value=a.shift();
          for(const b of a){ if(typeof value==='number'&&typeof b==='number'){value*=b;continue;}
            const n=own(c.createGain());signal(value).connect(n);connect(b,n.gain);value=n; }
          return value;
        }
        case 'sub': {return sum([compile(x.inputs[0]),compile({ugen:'mul',inputs:[-1,x.inputs[1]]})]); }
        case 'div': {const [a,b]=x.inputs.map(compile);if(typeof b!=='number'||b===0)throw new Error('Graph division requires nonzero numeric denominator');
          const n=own(c.createGain());signal(a).connect(n);n.gain.value=1/b;return n;}
        case 'lpf':case 'hpf':case 'rlpf': {
          const n=own(c.createBiquadFilter());n.type=x.ugen==='hpf'?'highpass':'lowpass';
          connect(compile(x.freq),n.frequency);n.Q.value=x.rq ? 1/Math.max(.1,num(x.rq)) : .707;
          signal(compile(x.in)).connect(n);return n;
        }
        case 'pan2': { const n=own(c.createStereoPanner());connect(compile(x.pan),n.pan);signal(compile(x.in)).connect(n);return n; }
        case 'line':case 'x-line': {
          const n=constant(0);n.offset.setValueAtTime(num(x.from),start);
          if(x.ugen==='x-line') {if(num(x.from)<=0||num(x.to)<=0)throw new Error('x-line requires positive endpoints');n.offset.exponentialRampToValueAtTime(num(x.to),start+num(x.dur));}
          else n.offset.linearRampToValueAtTime(num(x.to),start+num(x.dur));return n;
        }
        case 'env-gen': {
          const n=constant(0),e=x.envelope,p=n.offset,a=num(e.attack),r=num(e.release);
          p.setValueAtTime(0,start);p.linearRampToValueAtTime(1,start+a);
          if(e.envelope==='perc') {p.exponentialRampToValueAtTime(.0001,start+a+r);p.setValueAtTime(0,start+a+r+.01);}
          else {const decay=num(e.decay),s=num(e.sustain),gate=Math.max(a+decay,params.dur??1);
            p.linearRampToValueAtTime(s,start+a+decay);p.setValueAtTime(s,start+gate);p.linearRampToValueAtTime(0,start+gate+r);}
          return n;
        }
        default:throw new Error('Unsupported UGen '+x.ugen);
      }
    };
    const sum=values=>{
      if(values.every(x=>typeof x==='number'))return values.reduce((a,b)=>a+b,0);
      const n=own(c.createGain());values.forEach(x=>signal(x).connect(n));return n;
    };
    let result;
    try {result=signal(compile(v.graph));} catch(e){for(const s of sources){try{s.stop();}catch{}}owned.forEach(n=>n.disconnect());throw e;}
    const level=own(c.createGain());level.gain.value=1;result.connect(level);
    level.connect(this.decks[v.deck==='a'?'a':'b'].input);
    if(v.synth==='kick') {
      const p=this.decks.a.duck.gain;p.cancelScheduledValues(start);p.setValueAtTime(.5,start);p.linearRampToValueAtTime(1,start+.27);
    }
    const id=++this.serial;
    this.voices.set(id,{id,params,level,owned,sources,controls,end,synth:v.synth});
    const last=sources[sources.length-1];
    if(last)last.onended=()=>{owned.forEach(n=>n.disconnect());this.voices.delete(id);};
    return id;
  }
  ctl(id,params,time=this.ctx.currentTime) {
    const v=this.voices.get(id);if(!v)throw new Error('Voice no longer active');
    for(const [key,value] of Object.entries(params)) {
      if(!v.controls.has(key))throw new Error('No live control '+key+' on this voice');
      if(!Number.isFinite(value))throw new Error('Control must be finite');
      v.controls.get(key).offset.setTargetAtTime(value,time,.02);v.params[key]=value;
    }
  }
  kill(id){const v=this.voices.get(id);if(v){v.level.gain.setTargetAtTime(0,this.ctx.currentTime,.005);for(const s of v.sources){try{s.stop(this.ctx.currentTime+.03);}catch{}}}}
  stop(){for(const id of this.voices.keys())this.kill(id);}
  dispose(){if(this.disposed)return;this.disposed=true;this.stop();for(const d of Object.values(this.decks))Object.values(d).forEach(n=>n.disconnect());
    for(const n of [this.mix,this.dry,this.delay,this.feedback,this.echo,this.delayFilter,this.reverb,this.wet,this.compressor,this.output,this.analyser])n.disconnect();this.voices.clear();}
}
export function wav(buffer) {
  const frames=buffer.length,channels=buffer.numberOfChannels,data=new ArrayBuffer(44+frames*channels*2),v=new DataView(data);
  const str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,data.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,buffer.sampleRate,true);
  v.setUint32(28,buffer.sampleRate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);
  str(36,'data');v.setUint32(40,frames*channels*2,true);
  const a=Array.from({length:channels},(_,i)=>buffer.getChannelData(i));let at=44;
  for(let i=0;i<frames;i++)for(let ch=0;ch<channels;ch++){const x=Math.max(-1,Math.min(1,a[ch][i]));v.setInt16(at,x<0?x*32768:x*32767,true);at+=2;}
  return data;
}
