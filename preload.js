const {contextBridge:c,ipcRenderer:r}=require('electron');
c.exposeInMainWorld('P',{
 api:(p,method,body,type)=>r.invoke('api',{p,method,body,type}),cfg:()=>r.invoke('cfg'),setCfg:x=>r.invoke('setCfg',x),act:t=>r.invoke('act',t),
 ov:s=>r.send('ov',s),talk:()=>r.send('talk'),envRead:()=>r.invoke('envRead'),envWrite:t=>r.invoke('envWrite',t),restart:()=>r.invoke('restart'),
 onCfg:f=>r.on('cfg',(e,v)=>f(v)),onTalk:f=>r.on('talk',()=>f())});
