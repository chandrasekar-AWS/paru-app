const {contextBridge:c,ipcRenderer:r}=require('electron');
c.exposeInMainWorld('P',{
 api:(p,method,body,type,raw)=>r.invoke('api',{p,method,body,type,raw}),cfg:()=>r.invoke('cfg'),setCfg:x=>r.invoke('setCfg',x),
 act:(type,target)=>r.invoke('act',{type,target}),ov:s=>r.send('ov',s),talk:()=>r.send('talk'),win:a=>r.send('win',a),
 envRead:()=>r.invoke('envRead'),envWrite:t=>r.invoke('envWrite',t),restart:()=>r.invoke('restart'),
 enroll:()=>r.send('enroll'),enrollDone:x=>r.send('enrollDone',x),openMain:s=>r.send('openMain',s),
 onCfg:f=>r.on('cfg',(e,v)=>f(v)),onTalk:f=>r.on('talk',()=>f()),onEnroll:f=>r.on('enroll',()=>f()),
 onEnrollDone:f=>r.on('enrollDone',(e,v)=>f(v)),onGoto:f=>r.on('goto',(e,v)=>f(v)),onFs:f=>r.on('fs',(e,v)=>f(v))});
