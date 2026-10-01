const {contextBridge:c,ipcRenderer:r}=require('electron');
c.exposeInMainWorld('P',{
 api:(p,method,body,type,raw)=>r.invoke('api',{p,method,body,type,raw}),cfg:()=>r.invoke('cfg'),setCfg:x=>r.invoke('setCfg',x),
 act:(type,target)=>r.invoke('act',{type,target}),ov:s=>r.send('ov',s),talk:()=>r.send('talk'),win:a=>r.send('win',a),
 envRead:()=>r.invoke('envRead'),envWrite:t=>r.invoke('envWrite',t),restart:()=>r.invoke('restart'),
 onCfg:f=>r.on('cfg',(e,v)=>f(v)),onTalk:f=>r.on('talk',()=>f())});
