// Test-only HTTPS and CONNECT proxies. Every request goes to the offline world.
// node tls-proxy.mjs HOST CERT KEY; backend must be the private listener on 8792.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
const [host, certFile, keyFile] = process.argv.slice(2);
if (!host?.endsWith('.ts.net') || !certFile || !keyFile) throw Error('HOST CERT KEY required');
const tls = https.createServer({cert:fs.readFileSync(certFile), key:fs.readFileSync(keyFile)}, (req,res)=>{
  const upstream=http.request({host:'127.0.0.1',port:8792,path:req.url,method:req.method,
    headers:{...req.headers,'x-forwarded-proto':'https'}}, reply=>{
      res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);
    });
  upstream.on('error',()=>{res.writeHead(502);res.end('Offline test world unavailable');});
  req.pipe(upstream);
});
tls.on('upgrade',(req,socket,head)=>{
  const upstream=http.request({host:'127.0.0.1',port:8792,path:req.url,headers:req.headers});
  upstream.on('upgrade',(res,peer,rest)=>{
    socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`+
      Object.entries(res.headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n');
    if(rest.length)socket.write(rest);if(head.length)peer.write(head);
    peer.pipe(socket);socket.pipe(peer);
    peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());
  });
  upstream.on('error',()=>socket.destroy());upstream.end();
});
tls.listen(19443,'127.0.0.1');
const proxy=http.createServer((_,res)=>{res.writeHead(405);res.end();});
proxy.on('connect',(req,socket,head)=>{
  if(req.url!==`${host}:8443`){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  const peer=net.connect(19443,'127.0.0.1',()=>{
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if(head.length)peer.write(head);peer.pipe(socket);socket.pipe(peer);
  });
  peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());
});
proxy.listen(19892,'127.0.0.1',()=>console.log('Emulator proxy → HTTPS 19443 → isolated Omega 8792'));
