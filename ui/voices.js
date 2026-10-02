/* Paru voice catalog: 70 human neural voices (Microsoft Edge voices through the agent's /voice/tts). [id, name, gender] */
const PARU_VOICES=(()=>{
 const L={
  en:["English",[["en-IN-NeerjaNeural","Neerja (India)","F"],["en-IN-PrabhatNeural","Prabhat (India)","M"],["en-US-AriaNeural","Aria (US)","F"],["en-US-JennyNeural","Jenny (US)","F"],["en-US-EmmaNeural","Emma (US)","F"],["en-US-GuyNeural","Guy (US)","M"],["en-US-AndrewNeural","Andrew (US)","M"],["en-GB-SoniaNeural","Sonia (UK)","F"],["en-GB-RyanNeural","Ryan (UK)","M"],["en-AU-NatashaNeural","Natasha (Australia)","F"],["en-AU-WilliamNeural","William (Australia)","M"]]],
  ta:["தமிழ் Tamil",[["ta-IN-PallaviNeural","Pallavi","F"],["ta-IN-ValluvarNeural","Valluvar","M"]]],
  hi:["हिन्दी Hindi",[["hi-IN-SwaraNeural","Swara","F"],["hi-IN-MadhurNeural","Madhur","M"]]],
  te:["తెలుగు Telugu",[["te-IN-ShrutiNeural","Shruti","F"],["te-IN-MohanNeural","Mohan","M"]]],
  ml:["മലയാളം Malayalam",[["ml-IN-SobhanaNeural","Sobhana","F"],["ml-IN-MidhunNeural","Midhun","M"]]],
  kn:["ಕನ್ನಡ Kannada",[["kn-IN-SapnaNeural","Sapna","F"],["kn-IN-GaganNeural","Gagan","M"]]],
  bn:["বাংলা Bengali",[["bn-IN-TanishaaNeural","Tanishaa","F"],["bn-IN-BashkarNeural","Bashkar","M"]]],
  mr:["मराठी Marathi",[["mr-IN-AarohiNeural","Aarohi","F"],["mr-IN-ManoharNeural","Manohar","M"]]],
  gu:["ગુજરાતી Gujarati",[["gu-IN-DhwaniNeural","Dhwani","F"],["gu-IN-NiranjanNeural","Niranjan","M"]]],
  ur:["اردو Urdu",[["ur-IN-GulNeural","Gul","F"],["ur-PK-AsadNeural","Asad","M"]]],
  es:["Español",[["es-ES-ElviraNeural","Elvira","F"],["es-ES-AlvaroNeural","Alvaro","M"],["es-MX-DaliaNeural","Dalia (Mexico)","F"]]],
  fr:["Français",[["fr-FR-DeniseNeural","Denise","F"],["fr-FR-HenriNeural","Henri","M"]]],
  de:["Deutsch",[["de-DE-KatjaNeural","Katja","F"],["de-DE-ConradNeural","Conrad","M"]]],
  it:["Italiano",[["it-IT-ElsaNeural","Elsa","F"],["it-IT-DiegoNeural","Diego","M"]]],
  pt:["Português",[["pt-BR-FranciscaNeural","Francisca","F"],["pt-BR-AntonioNeural","Antonio","M"]]],
  ru:["Русский",[["ru-RU-SvetlanaNeural","Svetlana","F"],["ru-RU-DmitryNeural","Dmitry","M"]]],
  ja:["日本語",[["ja-JP-NanamiNeural","Nanami","F"],["ja-JP-KeitaNeural","Keita","M"]]],
  ko:["한국어",[["ko-KR-SunHiNeural","SunHi","F"],["ko-KR-InJoonNeural","InJoon","M"]]],
  zh:["中文",[["zh-CN-XiaoxiaoNeural","Xiaoxiao","F"],["zh-CN-YunxiNeural","Yunxi","M"]]],
  ar:["العربية",[["ar-SA-ZariyahNeural","Zariyah","F"],["ar-SA-HamedNeural","Hamed","M"]]],
  tr:["Türkçe",[["tr-TR-EmelNeural","Emel","F"],["tr-TR-AhmetNeural","Ahmet","M"]]],
  nl:["Nederlands",[["nl-NL-ColetteNeural","Colette","F"],["nl-NL-MaartenNeural","Maarten","M"]]],
  pl:["Polski",[["pl-PL-ZofiaNeural","Zofia","F"],["pl-PL-MarekNeural","Marek","M"]]],
  id:["Indonesia",[["id-ID-GadisNeural","Gadis","F"],["id-ID-ArdiNeural","Ardi","M"]]],
  vi:["Tiếng Việt",[["vi-VN-HoaiMyNeural","HoaiMy","F"],["vi-VN-NamMinhNeural","NamMinh","M"]]],
  th:["ไทย",[["th-TH-PremwadeeNeural","Premwadee","F"],["th-TH-NiwatNeural","Niwat","M"]]],
  sv:["Svenska",[["sv-SE-SofieNeural","Sofie","F"],["sv-SE-MattiasNeural","Mattias","M"]]],
  el:["Ελληνικά",[["el-GR-AthinaNeural","Athina","F"],["el-GR-NestorasNeural","Nestoras","M"]]],
  he:["עברית",[["he-IL-HilaNeural","Hila","F"],["he-IL-AvriNeural","Avri","M"]]],
  fa:["فارسی",[["fa-IR-DilaraNeural","Dilara","F"],["fa-IR-FaridNeural","Farid","M"]]],
  ne:["नेपाली",[["ne-NP-HemkalaNeural","Hemkala","F"],["ne-NP-SagarNeural","Sagar","M"]]],
  si:["සිංහල",[["si-LK-ThiliniNeural","Thilini","F"],["si-LK-SameeraNeural","Sameera","M"]]]
 };
 const all=[];for(const k in L)for(const [id,name,g] of L[k][1])all.push({id,name,g,lang:k,group:L[k][0]});
 const byId=id=>all.find(v=>v.id===id);
 // the voice to use when Paru answers in `lang`: your choice if it fits, else same gender in that language, else first one
 const pick=(lang,pref)=>{lang=(lang||'en').slice(0,2).toLowerCase();const p=byId(pref);if(p&&p.lang===lang)return p;
  const pool=all.filter(v=>v.lang===lang);if(!pool.length)return p||byId('en-IN-NeerjaNeural');
  return pool.find(v=>p&&v.g===p.g)||pool[0]};
 return{all,byId,pick,langs:L};
})();
const STOP_WORDS=["shut up","shutup","stop","quiet","be quiet","silence","enough","go away","that's all","that is all","dismiss","cancel","go to sleep","bye paru",
 "நிறுத்து","பேசாதே","அமைதி","போதும்","சும்மா இரு","வாயை மூடு","சரி போ","चुप","बंद करो","रुको","बस करो","शांत","ఆపు","ఊరుకో","నిశ్శబ్దం","നിർത്തൂ","മിണ്ടാതിരിക്കൂ","മതി","ನಿಲ್ಲಿಸು","ಸುಮ್ಮನಿರು","ಸಾಕು",
 "cállate","callate","silencio","basta","para ya","tais-toi","tais toi","arrête","silence","halt die klappe","ruhe","aufhören","stopp","cala a boca","silêncio","pare","zitto","smettila",
 "замолчи","тихо","хватит","стоп","اسكت","توقف","كفى","闭嘴","安静","停下","够了","黙って","静かに","止めて","조용히","그만","닥쳐","sus","dur","yeter","diam","berhenti","চুপ","থামো"];
const isStop=h=>{h=(h||"").toLowerCase().replace(/[.!?,।]/g," ").replace(/\s+/g," ").trim();return!!h&&h.split(" ").length<=6&&STOP_WORDS.some(w=>h.includes(w))};
