// Silent probe path: measure actual sample onset in the AudioContext render graph.
// This is not a microphone loopback or hardware output latency measurement.
class TimingProbe extends AudioWorkletProcessor {
  constructor(){super();this.expected=[];this.port.onmessage=e=>{if(Number.isFinite(e.data))this.expected.push(e.data);if(this.expected.length>128)this.expected.shift();};}
  process(inputs,outputs){
    const channel=inputs[0]?.[0];
    if(channel)for(let i=0;i<channel.length;i++)if(channel[i]>.5){
      const expected=this.expected.shift();if(expected!==undefined)this.port.postMessage({expected,actual:(currentFrame+i)/sampleRate});
      break;
    }
    for(const output of outputs)for(const channel of output)channel.fill(0);
    return true;
  }
}
registerProcessor('pelagic-timing-probe',TimingProbe);
