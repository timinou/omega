import {spawn} from 'node:child_process';

// Same protocol as browser.port in Beam Lisp: a 4-byte BE length plus JSON.
// Requests are serialized, not multiplexed. Timeout destroys the owner so a
// late response can never be mistaken for the next operation's response.
export class BrowserPort {
  constructor(executable) {
    this.child=spawn(executable,[],{stdio:['pipe','pipe','pipe']});
    this.buffer=Buffer.alloc(0);this.serial=0;this.queue=Promise.resolve();
    this.closed=new Promise(resolve=>this.child.once('close',(code,signal)=>resolve({code,signal})));
    this.child.stdin.on('error',()=>this.fail(Error('Native helper input closed.')));
    this.child.stderr.on('data',()=>{}); // Private child logs live in its runtime directory.
    this.child.stdout.on('data',chunk=>this.receive(chunk));
    this.child.on('error',()=>this.fail(Error('Native browser helper could not start. Run native setup.')));
    this.child.on('close',()=>this.fail(Error('Native browser helper exited. Reopen the saved profile.')));
  }
  fail(error){this.error=error;this.pending?.reject(error);this.pending=null;}
  receive(chunk){
    this.buffer=Buffer.concat([this.buffer,chunk]);
    while(this.buffer.length>=4){
      const n=this.buffer.readUInt32BE(0);
      if(!n||n>8*1024*1024){this.fail(Error('Invalid native browser response'));this.child.kill();return;}
      if(this.buffer.length<n+4)return;
      const bytes=this.buffer.subarray(4,n+4);this.buffer=this.buffer.subarray(n+4);
      const pending=this.pending;this.pending=null;
      try{const response=JSON.parse(bytes);if(!pending||response.id!==pending.id)throw Error('Native browser response mismatch');
        if(!response.ok)pending.reject(Error(response.error));else pending.resolve(response.result);
      }catch(e){pending?.reject(e);this.fail(e);this.child.kill();}
    }
  }
  request(command,timeout=60000){
    const next=this.queue.catch(()=>{}).then(()=>new Promise((resolve,reject)=>{
      if(this.error)return reject(this.error);
      const id=++this.serial,bytes=Buffer.from(JSON.stringify({...command,id}));
      if(bytes.length>8*1024*1024)return reject(Error('Native browser command too large'));
      const header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);
      const timer=setTimeout(()=>{this.fail(Error('Native browser request timed out; helper stopped.'));this.child.kill();},timeout);
      this.pending={id,resolve:value=>{clearTimeout(timer);resolve(value);},reject:e=>{clearTimeout(timer);reject(e);}};
      this.child.stdin.write(Buffer.concat([header,bytes]),e=>{if(e)this.fail(e);});
    }));this.queue=next;return next;
  }
  async close(){this.child.stdin.end();return this.closed;}
}
