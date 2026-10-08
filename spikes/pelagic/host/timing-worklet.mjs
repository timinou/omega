// Timestamp travels in the silent probe's second channel, not an asynchronous
// message queue. Delayed messages or cancelled pilots cannot shift associations.
// Float32 timestamp quantization is below .125 ms at twenty minutes.
class TimingProbe extends AudioWorkletProcessor {
  process(inputs,outputs){
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
