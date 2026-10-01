const {app,BrowserWindow,globalShortcut,Tray,Menu,screen,ipcMain,dialog,shell,nativeImage,session}=require('electron');
const fs=require('fs'),path=require('path'),cp=require('child_process');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
let mainWin,ov,tray,cfgPath,agent;

/* ---------- settings ---------- */
const defDir=()=>fs.existsSync('E:\\agent\\agent.py')?'E:\\agent':path.join(process.resourcesPath,'agent');
const PERMS={mic:false,contacts:false,photos:false,calls:false,apps:false,files:false,
  search:false,download:false,upload:false,reply:false,update:false,onlineCalls:false,browser:false};
const DEF=()=>({server:'http://localhost:8000',key:'',lang:'auto',wake:true,voice:'en-IN-NeerjaNeural',rate:0,
  agentDir:defDir(),theme:'dark',accent:'#5a8bff',fontSize:'normal',orbSize:'small',closeQuits:false,interrupt:true,voiceLock:false,voiceprint:null,voiceThr:0.9,
  askEach:true,autoHide:0,onboarded:false,perms:{...PERMS}});
const cfg=()=>{try{const c={...DEF(),...JSON.parse(fs.readFileSync(cfgPath,'utf8'))};c.perms={...PERMS,...c.perms};return c}catch{return DEF()}};
const base=()=>cfg().server.replace(/\/$/,'');
const push=()=>{const n=cfg();[mainWin,ov].forEach(w=>w&&!w.isDestroyed()&&w.webContents.send('cfg',n));return n};

/* ---------- python agent ---------- */
const up=async()=>{try{return(await fetch(base()+'/voice',{signal:AbortSignal.timeout(1500)})).ok}catch{return false}};
async function ensureAgent(){
  if(await up())return;const c=cfg();
  if(!/localhost|127\.0\.0\.1/.test(c.server)||!fs.existsSync(path.join(c.agentDir,'agent.py')))return;
  agent=cp.spawn('python',['-m','uvicorn','agent:app','--port','8000'],{cwd:c.agentDir,windowsHide:true,stdio:'ignore'});agent.on('error',()=>{});
}
const killAgent=()=>new Promise(r=>cp.exec("for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do taskkill /f /pid %a",{shell:'cmd.exe'},()=>r()));

/* ---------- windows ---------- */
const showMain=()=>{mainWin.show();mainWin.focus()};
const talk=()=>ov.webContents.send('talk');
const goto_=sec=>{showMain();mainWin.webContents.send('goto',sec)};
const bg=t=>t==='light'?'#ffffff':'#000000';
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>mainWin&&showMain());
app.whenReady().then(async()=>{
  cfgPath=path.join(app.getPath('userData'),'cfg.json');
  // microphone only when the user granted it in Paru's permission screen
  session.defaultSession.setPermissionRequestHandler((w,p,cb)=>cb(p==='media'));
  session.defaultSession.setPermissionCheckHandler((w,p)=>p==='media');
  const preload=path.join(__dirname,'preload.js'),icon=nativeImage.createFromPath(path.join(__dirname,'build','icon.png'));
  mainWin=new BrowserWindow({width:1060,height:700,minWidth:840,minHeight:560,show:false,title:'Paru',frame:false,
    backgroundColor:bg(cfg().theme),icon,webPreferences:{preload}});
  mainWin.setMenuBarVisibility(false);mainWin.loadFile('app.html');
  mainWin.on('close',e=>{if(!app.isQuitting){e.preventDefault();mainWin.hide()}});
  mainWin.on('enter-full-screen',()=>mainWin.webContents.send('fs',true));mainWin.on('leave-full-screen',()=>mainWin.webContents.send('fs',false));
  const wa=screen.getPrimaryDisplay().workArea,W=380,H=340;
  ov=new BrowserWindow({width:W,height:H,x:wa.x+wa.width-W-10,y:wa.y+8,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,
    resizable:false,focusable:false,show:false,hasShadow:false,webPreferences:{preload,backgroundThrottling:false}});
  ov.setAlwaysOnTop(true,'screen-saver');ov.loadFile('overlay.html');
  tray=new Tray(icon.resize({width:16,height:16}));tray.setToolTip('Paru');tray.on('click',showMain);
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Paru',click:showMain},{label:'Talk now',click:talk},{label:'Stop / start listening in background',click:()=>{const c=cfg();fs.writeFileSync(cfgPath,JSON.stringify({...c,wake:!c.wake}));push()}},
    {label:'Restart agent',click:async()=>{await killAgent();ensureAgent()}},{label:'Quit',click:()=>{app.isQuitting=true;app.quit()}}]));
  globalShortcut.register('Control+Shift+Space',talk);
  app.setLoginItemSettings({openAtLogin:true,args:['--hidden']});
  if(!cfg().key||!cfg().onboarded||!process.argv.includes('--hidden'))showMain();
  ensureAgent();
});
app.on('window-all-closed',()=>{});
app.on('will-quit',()=>{globalShortcut.unregisterAll();try{agent&&agent.kill()}catch{}});

/* ---------- window buttons (red / yellow / green) ---------- */
ipcMain.on('win',(e,a)=>{const w=BrowserWindow.fromWebContents(e.sender);if(!w)return;
  if(a==='close'){if(w===mainWin&&cfg().closeQuits){app.isQuitting=true;app.quit()}else w.hide()}else if(a==='min')w.minimize();else if(a==='full')w.setFullScreen(!w.isFullScreen());else if(a==='full-exit'&&w.isFullScreen())w.setFullScreen(false)});

/* ---------- overlay / talk / voice training ---------- */
ipcMain.on('enroll',()=>ov.webContents.send('enroll'));
ipcMain.on('enrollDone',(e,r)=>mainWin.webContents.send('enrollDone',r));
ipcMain.on('openMain',(e,sec)=>goto_(sec||'general'));
ipcMain.handle('winState',()=>mainWin.isFullScreen());
ipcMain.on('ov',(e,s)=>{s?ov.showInactive():ov.hide()});ipcMain.on('talk',talk);

/* ---------- config ---------- */
ipcMain.handle('cfg',()=>cfg());
ipcMain.handle('setCfg',(e,c)=>{const cur=cfg();if(c.perms)c.perms={...cur.perms,...c.perms};
  fs.writeFileSync(cfgPath,JSON.stringify({...cur,...c}));const n=push();return n});
ipcMain.handle('envRead',()=>{try{return fs.readFileSync(path.join(cfg().agentDir,'env.txt'),'utf8')}catch{try{return fs.readFileSync(path.join(cfg().agentDir,'env.example.txt'),'utf8')}catch{return ''}}});
ipcMain.handle('envWrite',async(e,t)=>{fs.writeFileSync(path.join(cfg().agentDir,'env.txt'),t,'utf8');await killAgent();setTimeout(ensureAgent,800);return true});
ipcMain.handle('restart',async()=>{await killAgent();setTimeout(ensureAgent,800);return true});
ipcMain.handle('api',async(e,{p,method,body,type,raw})=>{
  try{const r=await fetch(base()+p,{method:method||'GET',headers:{'x-key':cfg().key,'Content-Type':type||'application/json'},
    body:body==null?undefined:(typeof body==='string'?body:Buffer.from(body)),signal:AbortSignal.timeout(40000)});
    if(raw){if(!r.ok)return{error:'tts'};return{audio:Buffer.from(await r.arrayBuffer())}}
    return await r.json()}catch{return{error:'unreachable'}}});

/* ---------- actions the assistant may do (each one checks your permission) ---------- */
const FOLDERS={pictures:['pictures','photos'],photos:['pictures','photos'],videos:['videos','photos'],downloads:['downloads','files'],
  documents:['documents','files'],desktop:['desktop','files']};
const NEVER=/^(explorer|winlogon|csrss|svchost|lsass|services|system|wininit|smss|dwm|paru)(\.exe)?$/i;
const ALIAS={whatsapp:'whatsapp:',settings:'ms-settings:',calendar:'outlookcal:',mail:'outlookmail:',calculator:'calc',camera:'microsoft.windows.camera:',
  store:'ms-windows-store:',teams:'msteams:',spotify:'spotify:',telegram:'tg:','file explorer':'explorer',explorer:'explorer','task manager':'taskmgr',
  paint:'mspaint',word:'winword',excel:'excel',powerpoint:'powerpnt',chrome:'chrome',edge:'msedge',firefox:'firefox','vs code':'code',vscode:'code',terminal:'wt',cmd:'cmd',notepad:'notepad'};
const EXE={whatsapp:'WhatsApp.exe',chrome:'chrome.exe',edge:'msedge.exe',firefox:'firefox.exe',spotify:'Spotify.exe',telegram:'Telegram.exe',teams:'ms-teams.exe',
  word:'WINWORD.EXE',excel:'EXCEL.EXE',powerpoint:'POWERPNT.EXE',notepad:'notepad.exe',calculator:'CalculatorApp.exe','vs code':'Code.exe',vscode:'Code.exe',paint:'mspaint.exe'};
const ask=async msg=>{if(!cfg().askEach)return true;const r=await dialog.showMessageBox({type:'question',buttons:['Allow','Cancel'],defaultId:1,cancelId:1,title:'Paru',message:msg});return r.response===0};
const need=k=>cfg().perms[k]?null:'no-permission:'+k;
ipcMain.handle('act',async(e,{type,target})=>{
  target=String(target||'').trim();const browse=u=>shell.openExternal(u);
  try{
    if(type==='open_app'){ let n=need('apps');if(n)return n;
      if(!/^[\w .:\/\\-]{1,120}$/.test(target))return 'blocked';
      if(/^https?:\/\//.test(target)||/^[\w-]+\.[a-z]{2,}$/i.test(target)){if(n=need('browser'))return n;browse(/^https?/.test(target)?target:'https://'+target);return 'ok'}
      if(!await ask('Paru wants to open: '+target))return 'denied';
      cp.exec('start "" "'+(ALIAS[target.toLowerCase()]||target)+'"',{shell:'cmd.exe'});return 'ok'}
    if(type==='close_app'){ const n=need('apps');if(n)return n;
      if(!/^[\w .-]{1,60}$/.test(target)||NEVER.test(target))return 'blocked';
      if(!await ask('Paru wants to close: '+target))return 'denied';
      const exe=EXE[target.toLowerCase()]||(/\.exe$/i.test(target)?target:target.replace(/\s+/g,'')+'.exe');
      return await new Promise(r=>cp.execFile('taskkill',['/IM',exe,'/F'],err=>r(err?'notfound':'ok')))}
    if(type==='open_url'){ const n=need('browser');if(n)return n;
      const u=/^https?:\/\//i.test(target)?target:'https://'+target;if(!/^https?:\/\/[\w.-]+/i.test(u))return 'blocked';browse(u);return 'ok'}
    if(type==='web_search'){ const n=need('search');if(n)return n;if(!target)return 'blocked';
      browse('https://www.google.com/search?q='+encodeURIComponent(target));return 'ok'}
    if(type==='open_folder'){ const f=FOLDERS[target.toLowerCase()];if(!f)return 'blocked';const n=need(f[1]);if(n)return n;
      await shell.openPath(app.getPath(f[0]));return 'ok'}
    if(type==='download'){ const n=need('download');if(n)return n;
      if(!/^https:\/\/[\w.-]+\/\S*$/i.test(target))return 'blocked';
      if(!await ask('Paru wants to download:\n'+target))return 'denied';
      const r=await fetch(target,{signal:AbortSignal.timeout(120000)});if(!r.ok)return 'failed';
      const len=+r.headers.get('content-length')||0;if(len>500e6)return 'toobig';
      let name=decodeURIComponent(new URL(target).pathname.split('/').pop()||'download').replace(/[^\w.\- ]/g,'_').slice(0,80)||'download';
      const dest=path.join(app.getPath('downloads'),name);fs.writeFileSync(dest,Buffer.from(await r.arrayBuffer()));shell.showItemInFolder(dest);return 'ok'}
  }catch{return 'failed'}
  return 'blocked'});
