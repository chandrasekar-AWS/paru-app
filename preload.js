const { contextBridge: c, ipcRenderer: r } = require('electron');
c.exposeInMainWorld('P', {
  platform: process.platform, isElectron: true,
  api: (p, method, body, type, raw) => r.invoke('api', { p, method, body, type, raw }), cfg: () => r.invoke('cfg'), setCfg: x => r.invoke('setCfg', x),
  act: (type, target) => r.invoke('act', { type, target }), ov: s => r.send('ov', s), talk: () => r.send('talk'), win: a => r.send('win', a),
  envRead: () => r.invoke('envRead'), envWrite: t => r.invoke('envWrite', t), restart: () => r.invoke('restart'),
  enroll: () => r.send('enroll'), enrollDone: x => r.send('enrollDone', x), openMain: s => r.send('openMain', s),
  authState: () => r.invoke('auth:state'), authGoogle: () => r.invoke('auth:google'), authSignIn: (email, password) => r.invoke('auth:signIn', { email, password }),
  authSignUp: (email, password) => r.invoke('auth:signUp', { email, password }), authSignOut: () => r.invoke('auth:signOut'), authSetConfig: (url, anonKey) => r.invoke('auth:setConfig', { url, anonKey }),
  providerSave: p => r.invoke('provider:save', p), providerStatus: () => r.invoke('provider:status'), profileSave: p => r.invoke('profile:save', p),
  setupDone: () => r.send('setup:done'), openSetup: step => r.send('setup:open', step), setupBack: () => r.send('setup:back'), permReply: (id, choice) => r.send('permReply', { id, choice }),
  onAskPerm: f => r.on('askPerm', (e, v) => f(v)), onAuthChanged: f => r.on('authChanged', (e, v) => f(v)),
  engineStatus: s => r.send('engineStatus', s), agentStatus: () => r.invoke('agentStatus'), lanInfo: () => r.invoke('lanInfo'),
  onCfg: f => r.on('cfg', (e, v) => f(v)), onTalk: f => r.on('talk', () => f()), onEnroll: f => r.on('enroll', () => f()),
  onEnrollDone: f => r.on('enrollDone', (e, v) => f(v)), onGoto: f => r.on('goto', (e, v) => f(v)), onFs: f => r.on('fs', (e, v) => f(v)),
  onEngineStatus: f => r.on('engineStatus', (e, v) => f(v)), onAgentStatus: f => r.on('agentStatus', (e, v) => f(v))
});
