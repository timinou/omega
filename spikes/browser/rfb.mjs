// Parse CLIENT RFB messages before forwarding. Agent control is enforced here,
// independently of noVNC's viewOnly UI and even on an already-connected viewer.
// Unknown protocol extensions fail closed; no arbitrary bytes reach the server.
export class RfbInput {
  constructor(canInput){this.canInput=canInput;this.buffer=Buffer.alloc(0);this.stage=0;}
  push(chunk){
    this.buffer=Buffer.concat([this.buffer,chunk]);if(this.buffer.length>1024*1024)throw Error('RFB input too large');
    const out=[];
    while(this.buffer.length){
      let n,allowed=true;
      if(this.stage<3){n=this.stage===0?12:1;}
      else{
        const b=this.buffer,t=b[0];
        if(t===0)n=20;
        else if(t===2){if(b.length<4)break;n=4+4*b.readUInt16BE(2);}
        else if(t===3)n=10;
        else if(t===4){n=8;allowed=this.canInput();}
        else if(t===5){n=6;allowed=this.canInput();}
        else if(t===6){if(b.length<8)break;const size=b.readInt32BE(4);n=8+Math.abs(size);allowed=this.canInput();}
        else if(t===150)n=10;
        else if(t===248){if(b.length<9)break;n=9+b[8];}
        else if(t===251){if(b.length<8)break;n=8+16*b[6];allowed=this.canInput();}
        else if(t===255){if(b.length<2)break;if(b[1]!==0)throw Error('Unsupported RFB extension');n=12;allowed=this.canInput();}
        else throw Error('Unsupported RFB message');
      }
      if(n>1024*1024)throw Error('RFB message too large');if(this.buffer.length<n)break;
      const packet=this.buffer.subarray(0,n);this.buffer=this.buffer.subarray(n);
      if(this.stage<3)this.stage++;
      if(allowed)out.push(packet);
    }
    return out;
  }
}
