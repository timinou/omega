// Package-owned DOM resource; BL owns the model, commands and layout.
export function createHost(){return {mount(root){
 const wrap=document.createElement('div');wrap.style.cssText='height:100%;display:flex;flex-direction:column;background:#f8f5ef;padding:12px;box-sizing:border-box;gap:8px';
 const label=document.createElement('strong'),link=document.createElement('a'),frame=document.createElement('iframe'),excerpt=document.createElement('pre');
 link.textContent='Open original PDF at cited page';link.target='_blank';link.rel='noopener';frame.title='Retained original procurement document';frame.style.cssText='flex:1;min-height:200px;border:1px solid #ddd';excerpt.style.cssText='white-space:pre-wrap;overflow:auto;flex:1;font:13px/1.6 monospace';
 wrap.append(label,link,frame,excerpt);root.append(wrap);let current;const resize=()=>{wrap.style.height=Math.max(250,window.innerHeight-wrap.getBoundingClientRect().top-56)+'px';};window.addEventListener('resize',resize);requestAnimationFrame(resize);
 return {update(model){label.textContent=model.label||'Original source';const src=typeof model.src==='string'&&model.src.startsWith('/procurement/artifact/')?model.src:null;
 if(src!==current){if(src){frame.src=src;link.href=src;}else{frame.removeAttribute('src');link.removeAttribute('href');}current=src;}
 frame.hidden=!src;link.hidden=!src;excerpt.textContent=model.excerpt||'Select a requirement to inspect its retained source.';excerpt.hidden=Boolean(src);
 },dispose(){window.removeEventListener('resize',resize);frame.src='about:blank';wrap.remove();}};
 },dispose(){}};}
