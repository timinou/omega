// Optional local-file deck. Beat-synced playback, cue/jog, loop and nudge.
export class SampleDeck {
  constructor(engine,key){this.engine=engine;this.key=key;this.bpm=engine.config.bpm;this.cue=0;this.loopBeats=0;this.offset=0;this.started=0;this.running=false;}
  async load(file){this.stop();this.buffer=await this.engine.ctx.decodeAudioData(await file.arrayBuffer());this.name=file.name;this.cue=0;this.offset=0;return {name:this.name,duration:this.buffer.duration};}
  rate(){return this.engine.config.bpm/this.bpm*(this.nudge||1);}
  position(){if(!this.running)return this.offset;let p=this.offset+(this.engine.ctx.currentTime-this.started)*this.rate();if(this.loopBeats){const length=60/this.bpm*this.loopBeats;p=this.cue+((p-this.cue)%length+length)%length;}return Math.min(this.buffer?.duration||0,Math.max(0,p));}
  play(time=this.engine.ctx.currentTime){if(!this.buffer)return;this.stop(false);const c=this.engine.ctx,s=c.createBufferSource();s.buffer=this.buffer;s.playbackRate.value=this.rate();
    if(this.loopBeats){s.loop=true;s.loopStart=this.cue;s.loopEnd=Math.min(this.buffer.duration,this.cue+60/this.bpm*this.loopBeats);}
    s.connect(this.engine.decks[this.key].input);s.start(time,Math.max(0,Math.min(this.buffer.duration-.001,this.offset)));this.source=s;this.started=time;this.running=true;
    s.onended=()=>{s.disconnect();if(this.source===s){this.running=false;this.source=null;}};
  }
  stop(remember=true){if(remember)this.offset=this.position();if(this.source){this.source.onended=null;try{this.source.stop();}catch{}this.source.disconnect();this.source=null;}this.running=false;}
  action(op,value){switch(op){case 'play':this.running?this.stop():this.play();break;
    case 'cue':this.stop();this.offset=this.cue;this.play();break;
    case 'set-cue':this.cue=this.position();break;
    case 'bpm':this.offset=this.position();this.bpm=Math.max(40,Math.min(240,value));if(this.running)this.play();break;
    case 'loop':this.loopBeats=value;this.offset=this.loopBeats?this.cue:this.position();if(this.running)this.play();break;
    case 'jog':{const on=this.running;this.stop();this.offset=Math.max(0,Math.min(this.buffer?.duration||0,this.offset+value));if(on)this.play();break;}
    case 'nudge':this.nudge=value;if(this.source)this.source.playbackRate.setTargetAtTime(this.rate(),this.engine.ctx.currentTime,.01);break;
    case 'clear':this.stop();this.buffer=null;this.name=null;break;
    default:throw new Error('Unknown deck operation '+op);}}
  configure(){if(this.source)this.source.playbackRate.setTargetAtTime(this.rate(),this.engine.ctx.currentTime,.02);}
  dispose(){this.stop();this.buffer=null;}
}
