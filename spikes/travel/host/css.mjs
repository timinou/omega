export const css = `
.travel{--ivory:#fbf6ec;--sand:#efe5d2;--sand2:#e3d5ba;--ink:#243a3d;--muted:#6b7a76;--teal:#0f6f73;--deep:#0b4a52;--sea:#d6ebe8;--clay:#b5603a;--clay-bg:#fbe9dd;--amber:#9a6a0c;--amber-bg:#fbf0d0;--ok:#1d7a52;--ok-bg:#dff0e6;--line:#e2d6bd;
 position:relative;height:100%;min-width:0;overflow:auto;container-type:inline-size;container-name:travel;background:var(--ivory);color:var(--ink);font:14px/1.55 'Avenir Next',Optima,Candara,ui-sans-serif,system-ui,sans-serif}
.travel *{box-sizing:border-box}.travel h1,.travel h2,.travel h3{font-family:Georgia,'Palatino Linotype',serif;font-weight:600;color:var(--deep);margin:0}
.travel button,.travel input,.travel select,.travel textarea{font:inherit;color:inherit}
.travel button{cursor:pointer;border:1px solid var(--sand2);background:#fff;border-radius:999px;padding:6px 14px;transition:background .12s,border-color .12s}
.travel button:hover:not(:disabled){background:var(--sea);border-color:var(--teal)}.travel button:disabled{opacity:.5;cursor:default}
.travel button.primary{background:var(--teal);border-color:var(--teal);color:#fff}.travel button.primary:hover:not(:disabled){background:var(--deep)}
.travel button.ghost{background:transparent;border-color:transparent;color:var(--teal);padding:4px 8px}.travel button.on{background:var(--deep);color:#fff;border-color:var(--deep)}
.travel a{color:var(--teal);text-decoration:none;border-bottom:1px solid #9cc7c4}.travel a:hover{border-color:var(--teal)}
.travel input,.travel select,.travel textarea{width:100%;border:1px solid var(--sand2);border-radius:8px;padding:7px 10px;background:#fff}
.travel input:focus,.travel textarea:focus,.travel select:focus,.travel button:focus-visible{outline:2px solid var(--teal);outline-offset:1px}
.travel textarea{min-height:76px;resize:vertical}.travel label{display:block;font-size:12px;color:var(--muted);font-weight:600}.travel label>input,.travel label>select,.travel label>textarea{margin-top:4px;font-weight:400;color:var(--ink)}
.travel label.check{display:flex;gap:8px;align-items:flex-start;font-weight:400;color:var(--ink);font-size:13px}.travel label.check input{width:auto;margin-top:3px}
.tv-head{background:linear-gradient(135deg,var(--deep),var(--teal));color:#f7f1e3;padding:20px 26px 0;position:relative}
.tv-head:after{content:'';display:block;height:10px;margin:18px -26px 0;background:repeating-linear-gradient(90deg,var(--sand) 0 14px,var(--clay) 14px 16px,var(--sand) 16px 30px,var(--teal) 30px 32px)}
.tv-eyebrow{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#bfe0dc;font-weight:700}
.tv-head h1{color:#fff;font-size:28px;line-height:1.15;margin:4px 0 12px}
.tv-strip{display:flex;flex-wrap:wrap;gap:8px}.tv-chip{background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.22);border-radius:12px;padding:6px 12px;min-width:0}
.tv-chip small{display:block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#bfe0dc}.tv-chip b{font-weight:600;color:#fff}
.tv-chip.unknown{border-style:dashed}.tv-chip.unknown b{color:#ffe2b8}
.tv-nav{display:flex;gap:4px;flex-wrap:wrap;padding:10px 20px;background:var(--sand);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5;align-items:center}
.tv-nav button{border-color:transparent;background:transparent}.tv-nav button.on{background:var(--deep);color:#fff}.tv-nav .sp{flex:1}
.tv-nav .count{display:inline-block;min-width:18px;font-size:11px;background:var(--sea);color:var(--deep);border-radius:9px;padding:0 6px;margin-left:5px}.tv-nav button.on .count{background:#fff3}
.tv-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,380px);gap:20px;padding:20px 24px 48px;align-items:start}
.tv-body.single{grid-template-columns:minmax(0,1fr)}.tv-main,.tv-side{min-width:0}.tv-side{position:sticky;top:64px}
.tv-sec{margin:0 0 26px}.tv-sec>h2{font-size:19px;margin-bottom:4px}.tv-sec>p.lede{margin:0 0 12px;color:var(--muted);font-size:13px}
.tv-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 12px;position:relative;min-width:0}
.tv-card.sel{border-color:var(--teal);box-shadow:0 0 0 2px var(--sea)}.tv-card.short{border-left:5px solid var(--clay)}
.tv-card h3{font-size:16px;line-height:1.3;margin-bottom:2px;overflow-wrap:anywhere}.tv-card .dom{font-size:12px;color:var(--muted)}
.tv-row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.tv-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.tv-b{display:inline-flex;gap:5px;align-items:baseline;font-size:11.5px;border-radius:999px;padding:2px 10px;border:1px solid var(--line);background:var(--ivory);color:var(--ink)}
.tv-b i{font-style:normal;font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:700}
.tv-b.ok{background:var(--ok-bg);border-color:#a9d6bd;color:#12583a}.tv-b.warn{background:var(--amber-bg);border-color:#e6cd86;color:#6e4a05}
.tv-b.bad{background:var(--clay-bg);border-color:#efb99b;color:#7d3a1c}.tv-b.mute{color:var(--muted)}.tv-b.link{background:var(--sea);border-color:#a8d3cf;color:var(--deep)}
.tv-q{border-left:3px solid var(--teal);margin:8px 0;padding:2px 12px;font-size:12.5px;color:#3d5558;background:#f6faf8;border-radius:0 8px 8px 0;overflow-wrap:anywhere}
.tv-q small{display:block;color:var(--muted)}.tv-note{font-size:12px;color:var(--muted)}.tv-warn{font-size:12.5px;color:#6e4a05;background:var(--amber-bg);border-radius:8px;padding:6px 10px;margin:8px 0}
.tv-err{font-size:13px;color:#7d3a1c;background:var(--clay-bg);border:1px solid #efb99b;border-radius:10px;padding:8px 12px;margin:8px 0}
.tv-ok{font-size:13px;color:#12583a;background:var(--ok-bg);border-radius:10px;padding:8px 12px;margin:8px 0}
.tv-form{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:16px}.tv-form .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tv-search{display:flex;gap:8px;align-items:center}.tv-search input{flex:1}.tv-presets{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.tv-presets button{font-size:12px;padding:3px 11px;background:var(--ivory)}
.tv-busy:after{content:'';display:inline-block;width:11px;height:11px;margin-left:8px;border:2px solid var(--sea);border-top-color:var(--teal);border-radius:50%;animation:tvspin .8s linear infinite;vertical-align:-1px}
@keyframes tvspin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.tv-busy:after{animation:none}}
.tv-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.tv-table th,.tv-table td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left;min-width:150px}.tv-table th{background:var(--sand);font-size:12px;color:var(--deep)}
.tv-table tr:last-child td{border-bottom:0}.tv-table td.crit,.tv-table th.crit{min-width:130px;background:var(--ivory);font-weight:600;color:var(--deep);position:sticky;left:0}
.tv-scroll{overflow-x:auto;border-radius:12px}.tv-unk{color:var(--muted);font-style:italic}
.tv-detail h2{font-size:18px;margin-bottom:6px}.tv-detail details{border-top:1px solid var(--line);padding:8px 0}.tv-detail summary{cursor:pointer;font-weight:600;color:var(--deep)}
.tv-list{list-style:none;margin:0;padding:0}.tv-list li{padding:6px 0;border-bottom:1px dashed var(--line)}.tv-list li:last-child{border:0}
.tv-empty{padding:22px;border:1px dashed var(--sand2);border-radius:14px;color:var(--muted);text-align:center;background:#fffdf8}
.tv-foot{padding:14px 24px 30px;font-size:11.5px;color:var(--muted);border-top:1px solid var(--line)}
.tv-draft{width:100%;min-height:200px;font:12.5px/1.55 ui-monospace,Menlo,monospace;background:#fffdf8}
@container travel (max-width:760px){.tv-body{grid-template-columns:minmax(0,1fr);padding:14px}.tv-side{position:static}.tv-head{padding:14px 14px 0}.tv-head h1{font-size:22px}.tv-head:after{margin:14px -14px 0}.tv-nav{padding:8px 10px}.tv-search{flex-wrap:wrap}.tv-foot{padding:12px 14px}}
.travel-browser{position:relative;height:100%;min-width:0;display:flex;flex-direction:column;background:var(--ivory);font:13px/1.4 system-ui,sans-serif;color:var(--ink)}
.travel-browser .bar{display:flex;gap:6px;align-items:center;padding:8px 10px;background:var(--sand);border-bottom:1px solid var(--line);flex-wrap:wrap}
.travel-browser button{cursor:pointer;border:1px solid var(--sand2);background:#fff;border-radius:999px;padding:4px 12px;font:inherit}.travel-browser button:hover:not(:disabled){background:var(--sea)}.travel-browser button:disabled{opacity:.5}
.travel-browser .where{flex:1;min-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--deep)}
.travel-browser .msg{padding:6px 12px;font-size:12px;color:#7d3a1c;background:var(--clay-bg)}.travel-browser .msg:empty{display:none}
.travel-browser .empty{margin:auto;padding:30px;text-align:center;color:var(--muted)}.travel-browser iframe{flex:1;width:100%;border:0;background:#fff}
.pane.view:has(> .view-body > .travel,> .view-body > .travel-browser){position:relative;min-width:0;min-height:0;overflow:hidden}
.pane.view:has(> .view-body > .travel,> .view-body > .travel-browser) > .view-body{position:absolute;inset:0}
@media(max-width:900px){
 #panes:has(.travel,.travel-browser){grid-template-columns:minmax(0,1fr)!important;grid-template-rows:minmax(110px,22%) minmax(0,1fr)!important}
 #panes:has(.travel-browser){grid-template-rows:minmax(90px,16%) minmax(0,1fr) minmax(0,1fr)!important}
}
`;
