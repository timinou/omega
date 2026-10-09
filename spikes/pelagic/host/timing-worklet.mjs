// Timestamp travels in the silent probe's second channel, not an asynchronous
// message queue. Delayed messages or cancelled pilots cannot shift associations.
// Float32 timestamp quantization is below .125 ms at twenty minutes.
class TimingProbe extends AudioWorkletProcessor {
  constructor(){super();this.clocks=new Map();this.port.onmessage=({data})=>{
    if(data.op==='clock'){if(this.clocks.size>=8&&!this.clocks.has(data.id)){data.port.close();return;}this.clocks.get(data.id)?.port.close();const state={port:data.port,waiting:false};data.port.onmessage=()=>{state.waiting=false;};data.port.start?.();this.clocks.set(data.id,state);}
    else if(data.op==='unclock'){this.clocks.get(data.id)?.port.close();this.clocks.delete(data.id);}
  };}
  process(inputs,outputs){
    if(this.clocks.size){const clock={time:currentFrame/sampleRate,sampleRate};for(const state of this.clocks.values())if(!state.waiting){state.waiting=true;state.port.postMessage(clock);}}
    const impulse=inputs[0]?.[0],stamp=inputs[0]?.[1];
    if(impulse&&stamp)for(let i=0;i<impulse.length;i++)if(impulse[i]>.5){
      // Simultaneous pilots add; divide by their summed impulse amplitude.
      this.port.postMessage({expected:stamp[i]/impulse[i],actual:(currentFrame+i)/sampleRate});
    }
    for(const output of outputs)for(const channel of output)channel.fill(0);
    return true;
  }
}
registerProcessor('pelagic-timing-probe',TimingProbe);
