const {app,BrowserWindow,globalShortcut,Tray,Menu,screen,ipcMain,dialog,shell,nativeImage,session}=require('electron');
const fs=require('fs'),path=require('path'),cp=require('child_process');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
let mainWin,ov,tray,cfgPath,agent;
const defDir=()=>fs.existsSync('E:\\agent\\agent.py')?'E:\\agent':path.join(process.resourcesPath,'agent');
const DEF=()=>({server:'http://localhost:8000',key:'',lang:'en',wake:true,voice:'',agentDir:defDir()});
const cfg=()=>{try{return{...DEF(),...JSON.parse(fs.readFileSync(cfgPath,'utf8'))}}catch{return DEF()}};
const base=()=>cfg().server.replace(/\/$/,'');
const up=async()=>{try{return(await fetch(base()+'/voice',{signal:AbortSignal.timeout(1500)})).ok}catch{return false}};
async function ensureAgent(){
  if(await up())return;const c=cfg();
  if(!/localhost|127\.0\.0\.1/.test(c.server)||!fs.existsSync(path.join(c.agentDir,'agent.py')))return;
  agent=cp.spawn('python',['-m','uvicorn','agent:app','--port','8000'],{cwd:c.agentDir,windowsHide:true,stdio:'ignore'});agent.on('error',()=>{});
}
const killAgent=()=>new Promise(r=>cp.exec("for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do taskkill /f /pid %a",{shell:'cmd.exe'},()=>r()));
const showMain=()=>{mainWin.show();mainWin.focus()};
const talk=()=>ov.webContents.send('talk');
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>mainWin&&showMain());
app.whenReady().then(async()=>{
  cfgPath=path.join(app.getPath('userData'),'cfg.json');
  session.defaultSession.setPermissionRequestHandler((w,p,cb)=>cb(p==='media'));
  const preload=path.join(__dirname,'preload.js'),icon=nativeImage.createFromPath(path.join(__dirname,'build','icon.png'));
  mainWin=new BrowserWindow({width:980,height:680,show:false,title:'Paru',backgroundColor:'#14100f',autoHideMenuBar:true,icon,webPreferences:{preload}});
  mainWin.loadFile('app.html');
  mainWin.on('close',e=>{if(!app.isQuitting){e.preventDefault();mainWin.hide()}});
  const {width}=screen.getPrimaryDisplay().workAreaSize;
  ov=new BrowserWindow({width:420,height:390,x:width-440,y:10,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,resizable:false,focusable:false,show:false,hasShadow:false,webPreferences:{preload,backgroundThrottling:false}});
  ov.setAlwaysOnTop(true,'screen-saver');ov.loadFile('overlay.html');
  tray=new Tray(icon.resize({width:16,height:16}));tray.setToolTip('Paru');tray.on('click',showMain);
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Paru',click:showMain},{label:'Talk now',click:talk},{label:'Restart agent',click:async()=>{await killAgent();ensureAgent()}},{label:'Quit',click:()=>{app.isQuitting=true;app.quit()}}]));
  globalShortcut.register('Control+Shift+Space',talk);
  app.setLoginItemSettings({openAtLogin:true,args:['--hidden']});
  if(!cfg().key||!process.argv.includes('--hidden'))showMain();
  ensureAgent();
});
app.on('window-all-closed',()=>{});
app.on('will-quit',()=>{globalShortcut.unregisterAll();try{agent&&agent.kill()}catch{}});
ipcMain.on('ov',(e,s)=>{s?ov.showInactive():ov.hide()});ipcMain.on('talk',talk);
ipcMain.handle('cfg',()=>cfg());
ipcMain.handle('setCfg',(e,c)=>{fs.writeFileSync(cfgPath,JSON.stringify({...cfg(),...c}));const n=cfg();[mainWin,ov].forEach(w=>w.webContents.send('cfg',n));return n});
ipcMain.handle('envRead',()=>{try{return fs.readFileSync(path.join(cfg().agentDir,'env.txt'),'utf8')}catch{try{return fs.readFileSync(path.join(cfg().agentDir,'env.example.txt'),'utf8')}catch{return ''}}});
ipcMain.handle('envWrite',async(e,t)=>{fs.writeFileSync(path.join(cfg().agentDir,'env.txt'),t,'utf8');await killAgent();setTimeout(ensureAgent,800);return true});
ipcMain.handle('restart',async()=>{await killAgent();setTimeout(ensureAgent,800);return true});
ipcMain.handle('api',async(e,{p,method,body,type})=>{
  try{const r=await fetch(base()+p,{method:method||'GET',headers:{'x-key':cfg().key,'Content-Type':type||'application/json'},
    body:body==null?undefined:(typeof body==='string'?body:Buffer.from(body)),signal:AbortSignal.timeout(40000)});return await r.json()}
  catch{return{error:'unreachable'}}});
ipcMain.handle('act',async(e,{target})=>{
  if(!/^[\w .:\/\\-]{1,120}$/.test(target))return 'blocked';
  const r=await dialog.showMessageBox({type:'question',buttons:['Allow','Cancel'],defaultId:1,title:'Paru',message:'Paru wants to open: '+target});
  if(r.response!==0)return 'denied';
  if(/^https?:\/\//.test(target)||/^[\w-]+\.[a-z]{2,}/i.test(target)){shell.openExternal(/^https?/.test(target)?target:'https://'+target);return 'ok'}
  cp.exec('start "" "'+target+'"',{shell:'cmd.exe'});return 'ok'});
