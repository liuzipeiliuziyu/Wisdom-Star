
import React, { useState, useEffect, useRef } from 'react';
import { 
  Trophy, ChevronRight, ArrowLeft, Flame, Star, Loader2, Award, AlertCircle,
  Edit2, XCircle, CheckCircle, PlayCircle, Calculator, Languages, 
  BookOpen, Camera, Check, ArrowRight, Volume2, Lock, Hash, Play, RefreshCw,
  VolumeX, AudioLines, Music
} from 'lucide-react';
import { GeminiService } from './services/geminiService';
import { Grade, Subject, Question, UserProfile } from './types';

const STORAGE_KEY = 'smartkids_v12_stable';
const QUESTIONS_PER_SET = 10;
const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1546410531-bb4caa6b424d?auto=format&fit=crop&q=80&w=800";

const DEFAULT_AVATARS = [
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Nala&backgroundColor=b6e3f4",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Simba&backgroundColor=ffd5dc",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Pabu&backgroundColor=c0aede",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Momo&backgroundColor=d1d4f9",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Zuzu&backgroundColor=ffdfbf",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Toto&backgroundColor=b6e3f4"
];

const INITIAL_PROFILE: UserProfile = {
  name: "新同学",
  grade: 1,
  streak: 1,
  coins: 0,
  points: 0,
  trophies: 0,
  avatarUrl: DEFAULT_AVATARS[0],
  setsCompleted: { Math: 0, Chinese: 0, English: 0 }
};

// Audio Utilities
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [view, setView] = useState<'splash' | 'landing' | 'nameEntry' | 'gradeSelect' | 'dashboard' | 'topicSelect' | 'quiz' | 'result' | 'profile'>('splash');
  const [profile, setProfile] = useState<UserProfile>(INITIAL_PROFILE);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [userTopic, setUserTopic] = useState("");
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [questionBuffer, setQuestionBuffer] = useState<Question[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [sessionPoints, setSessionPoints] = useState(0);
  
  const [userInputValue, setUserInputValue] = useState("");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isLastCorrect, setIsLastCorrect] = useState(false);
  const [aiFeedback, setAiFeedback] = useState("");
  
  const [isLoadingQuestion, setIsLoadingQuestion] = useState(false);
  const [visualUrl, setVisualUrl] = useState<string | null>(null);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const gemini = useRef(new GeminiService());

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setProfile(JSON.parse(saved));
    setTimeout(() => setView('landing'), 1500);
    return () => {
      if (audioSourceRef.current) audioSourceRef.current.stop();
    };
  }, []);

  useEffect(() => {
    if (view !== 'splash' && view !== 'landing') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    }
  }, [profile, view]);

  const handleError = (e: any) => {
    console.error("API Error:", e);
    if (e.message === 'DAILY_QUOTA_EXCEEDED') {
      setErrorStatus("今日能量已用完，请明天再来探险吧！");
    } else if (e.message === 'RATE_LIMIT_EXCEEDED') {
      setErrorStatus("请求太快啦，请稍等10秒后重试。");
    } else {
      setErrorStatus("魔法信号不稳定，请点击重试。");
    }
  };

  const playQuestionSpeech = async () => {
    if (isSpeaking || !currentQuestion) return;
    
    setIsSpeaking(true);
    try {
      const base64Audio = await gemini.current.generateSpeech(currentQuestion.text);
      if (!base64Audio) {
        setIsSpeaking(false);
        return;
      }

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const ctx = audioContextRef.current;
      const audioData = decodeBase64(base64Audio);
      const audioBuffer = await decodeAudioData(audioData, ctx, 24000, 1);
      
      if (audioSourceRef.current) audioSourceRef.current.stop();
      
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => setIsSpeaking(false);
      source.start();
      audioSourceRef.current = source;
    } catch (e) {
      console.error("Speech play failed:", e);
      setIsSpeaking(false);
    }
  };

  const fillBuffer = async (subject: Subject, topic: string) => {
    try {
      const q = await gemini.current.generateQuestion(profile.grade, subject, topic);
      const url = await gemini.current.generateVisual(q.visualPrompt);
      setQuestionBuffer(prev => [...prev, { ...q, visualUrl: url || undefined }]);
    } catch (e) {}
  };

  const startSet = (subject: Subject) => {
    setSelectedSubject(subject);
    setUserTopic("");
    setView('topicSelect');
  };

  const confirmTopicAndStart = async () => {
    setErrorStatus(null);
    setView('quiz');
    setIsLoadingQuestion(true);
    setCurrentIndex(0);
    setSessionPoints(0);
    setQuestionBuffer([]);
    
    try {
      const firstQ = await gemini.current.generateQuestion(profile.grade, selectedSubject!, userTopic);
      const url = await gemini.current.generateVisual(firstQ.visualPrompt);
      setCurrentQuestion({ ...firstQ, visualUrl: url || undefined });
      setVisualUrl(url);
      setIsLoadingQuestion(false);
      fillBuffer(selectedSubject!, userTopic);
    } catch (e) {
      setIsLoadingQuestion(false);
      handleError(e);
    }
  };

  const handleChoiceSubmit = (idx: number) => {
    if (isAnswered) return;
    const correct = idx === currentQuestion?.correctIndex;
    setSelectedOption(idx);
    setIsAnswered(true);
    setIsLastCorrect(correct);
    if (correct) setSessionPoints(p => p + (currentQuestion?.points || 0));
  };

  const handleInputSubmit = async () => {
    if (isAnswered || !userInputValue.trim()) return;
    setIsVerifying(true);
    setErrorStatus(null);
    try {
      const res = await gemini.current.verifyAnswer(currentQuestion!.text, userInputValue, currentQuestion!.sampleAnswer || "");
      setIsLastCorrect(res.isCorrect);
      setAiFeedback(res.feedback);
      setIsAnswered(true);
      if (res.isCorrect) setSessionPoints(p => p + (currentQuestion?.points || 0));
    } catch (e) {
      handleError(e);
    } finally {
      setIsVerifying(false);
    }
  };

  const nextStep = async () => {
    if (audioSourceRef.current) audioSourceRef.current.stop();
    setIsSpeaking(false);
    
    if (currentIndex + 1 < QUESTIONS_PER_SET) {
      setCurrentIndex(prev => prev + 1);
      setIsAnswered(false);
      setSelectedOption(null);
      setUserInputValue("");
      setAiFeedback("");
      setErrorStatus(null);
      
      if (questionBuffer.length > 0) {
        const nextQ = questionBuffer[0];
        setQuestionBuffer(prev => prev.slice(1));
        setCurrentQuestion(nextQ);
        setVisualUrl(nextQ.visualUrl || null);
        fillBuffer(selectedSubject!, userTopic);
      } else {
        await loadQuestionAtCurrentIndex();
      }
    } else {
      finalizeSet();
    }
  };

  const loadQuestionAtCurrentIndex = async () => {
    setIsLoadingQuestion(true);
    setErrorStatus(null);
    try {
      const q = await gemini.current.generateQuestion(profile.grade, selectedSubject!, userTopic);
      const url = await gemini.current.generateVisual(q.visualPrompt);
      setCurrentQuestion({ ...q, visualUrl: url || undefined });
      setVisualUrl(url);
    } catch (e) {
      handleError(e);
    } finally {
      setIsLoadingQuestion(false);
    }
  };

  const finalizeSet = () => {
    setProfile(p => ({
      ...p,
      points: p.points + sessionPoints,
      coins: p.coins + Math.floor(sessionPoints / 2),
      trophies: sessionPoints >= 30 ? p.trophies + 1 : p.trophies,
      setsCompleted: {
        ...p.setsCompleted,
        [selectedSubject!]: p.setsCompleted[selectedSubject!] + 1
      }
    }));
    setView('result');
  };

  const updateProfileName = () => {
    if (tempName.trim()) {
      setProfile(p => ({ ...p, name: tempName.trim() }));
      setIsEditingName(false);
    }
  };

  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    e.currentTarget.src = FALLBACK_IMAGE;
  };

  // ---------------- UI Parts ----------------

  const Splash = () => (
    <div className="h-full w-full bg-white flex flex-col items-center justify-center p-10">
      <div className="w-56 h-56 bg-yellow-400 rounded-[4rem] shadow-2xl flex items-center justify-center mb-12 animate-bounce-soft">
        <Star size={100} className="text-white fill-current" />
      </div>
      <h1 className="text-5xl font-black text-slate-900 mb-2 tracking-tight">SmartKids</h1>
      <p className="text-slate-400 font-bold tracking-[0.3em] uppercase text-xs">AI 赋能 • 智能伴学</p>
    </div>
  );

  const NameEntry = () => {
    const [name, setName] = useState("");
    return (
      <div className="h-full bg-white flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-xs space-y-8">
          <div className="text-center space-y-4">
            <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-lg"><Edit2 size={48} /></div>
            <h2 className="text-3xl font-black text-slate-900">很高兴认识你！</h2>
            <p className="text-slate-500 font-medium">请告诉我你的名字</p>
          </div>
          <input 
            autoFocus type="text" value={name} onChange={(e) => setName(e.target.value)} 
            placeholder="输入你的名字..." 
            className="w-full p-6 rounded-[2rem] border-2 border-slate-200 focus:border-blue-400 font-bold text-xl text-center outline-none bg-slate-50" 
          />
          <button 
            onClick={() => { if(name.trim()) { setProfile(p => ({ ...p, name: name.trim() })); setView('gradeSelect'); } }}
            disabled={!name.trim()}
            className="w-full bg-slate-900 text-white py-6 rounded-[2.5rem] font-black text-xl shadow-xl flex items-center justify-center gap-2 disabled:opacity-50"
          >下一步 <ChevronRight /></button>
        </div>
      </div>
    );
  };

  const GradeSelect = () => (
    <div className="h-full bg-[#F8FAFC] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-4">
          <div className="w-24 h-24 bg-yellow-100 text-yellow-600 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-lg"><Hash size={48} /></div>
          <h2 className="text-3xl font-black text-slate-900">你在几年级？</h2>
          <p className="text-slate-500 font-medium">我们将为你适配难度</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5, 6].map((g) => (
            <button
              key={g} onClick={() => { setProfile(p => ({ ...p, grade: g as Grade })); setView('dashboard'); }}
              className={`p-6 rounded-[2.2rem] font-black text-2xl transition-all shadow-sm border-2 ${profile.grade === g ? 'bg-blue-600 text-white border-blue-600 scale-105' : 'bg-white text-slate-700 border-transparent active:scale-95'}`}
            >{g} 年级</button>
          ))}
        </div>
      </div>
    </div>
  );

  const LandingPage = () => (
    <div className="h-full bg-[#FFFDF2] flex flex-col items-center px-8 relative overflow-hidden">
      <div className="w-full mt-10 flex justify-between items-center z-10">
        <div className="bg-white rounded-full px-5 py-2 flex items-center gap-2 shadow-md">
          <div className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-white"><Award size={18} fill="currentColor" /></div>
          <span className="font-black text-slate-800">SmartKids</span>
        </div>
        <button className="w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-md text-slate-400"><Volume2 size={24} /></button>
      </div>
      <div className="mt-8 relative w-full aspect-square max-w-[320px] z-10">
        <div className="w-full h-full bg-[#3F9A9E] rounded-[3.5rem] overflow-hidden shadow-2xl relative border-8 border-white">
          <img src="https://img.freepik.com/premium-photo/3d-cartoon-style-character-little-boy-with-backpack-is-jumping-joy-white-numbers-math-symbols-floating-background_924294-8147.jpg?w=826" onError={handleImgError} className="w-full h-full object-cover" />
        </div>
      </div>
      <div className="mt-12 text-center space-y-3 z-10">
        <h1 className="text-4xl font-black text-slate-900 leading-tight">快乐学习<br /><span className="text-[#FFC700]">天天向上！</span></h1>
        <p className="text-slate-500 font-bold text-sm px-4 leading-relaxed">专为小学1-6年级设计，让语数英练习变得生动有趣。</p>
      </div>
      <button 
        onClick={() => setView(profile.name === "新同学" ? 'nameEntry' : 'dashboard')}
        className="mt-10 w-full max-w-[280px] h-20 bg-gradient-to-b from-[#FFEA31] to-[#FFD200] rounded-full shadow-[0_8px_0_#D4A200] active:translate-y-1 transition-all flex items-center justify-center gap-4 z-10"
      >
        <div className="w-11 h-11 bg-white/50 rounded-full flex items-center justify-center"><Play size={24} className="text-slate-900 ml-1" fill="currentColor" /></div>
        <span className="text-2xl font-black text-slate-900">开始探险</span>
      </button>
      <button className="mt-8 flex items-center gap-2 text-slate-400 font-black text-sm opacity-50"><Lock size={16} /><span>家长入口</span></button>
    </div>
  );

  const Dashboard = () => (
    <div className="h-full flex flex-col bg-white">
      <div className="p-6 flex justify-between items-center">
        <div className="flex items-center gap-3" onClick={() => setView('profile')}>
          <div className="w-14 h-14 rounded-full border-4 border-yellow-400 p-0.5 overflow-hidden shadow-md cursor-pointer"><img src={profile.avatarUrl} onError={handleImgError} className="w-full h-full rounded-full" /></div>
          <div className="cursor-pointer"><p className="text-[10px] font-bold text-slate-400">探险家</p><h2 className="text-xl font-black text-slate-900">{profile.name}</h2></div>
        </div>
        <div className="bg-yellow-400 text-white px-5 py-2.5 rounded-full shadow-lg flex items-center gap-2">
           <Trophy size={18} fill="currentColor" /><span className="font-black text-lg">{profile.points} 分</span>
        </div>
      </div>
      <div className="px-8 py-4"><h1 className="text-3xl font-black text-slate-900">今天想挑战<br /><span className="text-yellow-500">什么内容</span> ？</h1></div>
      <div className="flex-grow overflow-y-auto px-6 space-y-5 pb-10">
        {[
          { id: 'Math', name: '数学', sub: 'Numbers & Logic', img: "https://images.unsplash.com/photo-1596495573826-3946d022b4f2?auto=format&w=200", bg: 'bg-blue-50', btn: 'bg-blue-600' },
          { id: 'Chinese', name: '语文', sub: 'Reading & Poetry', img: "https://images.unsplash.com/photo-1544391496-1ca7c97452c2?auto=format&w=200", bg: 'bg-rose-50', btn: 'bg-rose-500' },
          { id: 'English', name: '英语', sub: 'ABC & Speaking', img: "https://images.unsplash.com/photo-1546410531-bb4caa6b424d?auto=format&w=200", bg: 'bg-emerald-50', btn: 'bg-emerald-500' },
        ].map((s) => (
          <div key={s.id} onClick={() => startSet(s.id as Subject)} className={`relative ${s.bg} rounded-[2.5rem] p-5 flex items-center gap-4 group cursor-pointer active:scale-95 transition-all`}>
            <div className="w-24 h-24 bg-white rounded-[1.8rem] border-4 border-white shadow-sm overflow-hidden shrink-0"><img src={s.img} onError={handleImgError} className="w-full h-full object-cover" /></div>
            <div className="flex-grow">
              <h3 className="text-2xl font-black text-slate-800">{s.name}</h3>
              <p className="text-[11px] font-bold text-slate-400 uppercase">{s.sub}</p>
              <div className="bg-white/60 px-3 py-1 rounded-full flex items-center gap-1.5 mt-2 shadow-sm">
                <CheckCircle size={12} className="text-emerald-500 fill-current" />
                <span className="text-[11px] font-black text-slate-600">已完成 {profile.setsCompleted[s.id as Subject]} 套</span>
              </div>
            </div>
            <div className={`${s.btn} w-10 h-10 rounded-full flex items-center justify-center text-white absolute right-6 bottom-8 shadow-lg`}><ArrowRight size={20} strokeWidth={3} /></div>
          </div>
        ))}
      </div>
    </div>
  );

  const QuizView = () => (
    <div className="h-full bg-[#F8FAFC] flex flex-col relative">
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-slate-100 z-30">
        <div className="h-full bg-blue-500 transition-all duration-700" style={{ width: `${((currentIndex + 1) / QUESTIONS_PER_SET) * 100}%` }}></div>
      </div>
      <header className="p-6 flex justify-between items-center mt-4">
        <button onClick={() => setShowExitModal(true)} className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-md"><ArrowLeft size={20} /></button>
        <div className="text-center"><div className="font-black text-slate-400 text-[10px] uppercase tracking-widest">本次探险积分</div><div className="text-3xl font-black text-blue-600">+{sessionPoints}</div></div>
        <div className="font-black text-slate-400 text-sm bg-white shadow-sm px-4 py-1 rounded-full">{currentIndex + 1}/{QUESTIONS_PER_SET}</div>
      </header>
      <div className="flex-grow px-6 overflow-y-auto space-y-6 pb-48">
        <div className="bg-white rounded-[3rem] p-6 shadow-sm border border-slate-100 space-y-6 relative overflow-hidden transition-all duration-500">
          <div className="aspect-video bg-slate-50 rounded-[2.2rem] overflow-hidden flex items-center justify-center relative shadow-inner">
            {visualUrl ? <img src={visualUrl} onError={handleImgError} className="w-full h-full object-cover" /> : <Loader2 className="animate-spin text-slate-200" size={48} />}
          </div>
          {isLoadingQuestion ? (
            <div className="py-12 flex flex-col items-center gap-4">
              <Loader2 className="animate-spin text-blue-500" />
              <p className="font-black text-slate-400">正在召唤魔法题目...</p>
            </div>
          ) : (
            <div className="space-y-6 relative">
              <h3 className="text-xl font-black text-slate-800 text-center leading-relaxed px-4 transition-all">{currentQuestion?.text}</h3>
              
              {/* 声波脉冲动画 */}
              <div className={`flex justify-center items-end gap-1.5 h-10 transition-all duration-500 ${isSpeaking ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} className={`wave-bar w-1.5 rounded-full ${i % 3 === 0 ? 'bg-blue-400' : i % 3 === 1 ? 'bg-rose-400' : 'bg-emerald-400'}`} style={{ height: '8px' }}></div>
                ))}
              </div>

              <div className="flex justify-center">
                <button 
                  onClick={playQuestionSpeech}
                  className={`flex items-center gap-2 px-8 py-4 rounded-full font-black transition-all duration-300 shadow-xl ${isSpeaking ? 'bg-blue-600 text-white scale-105 ring-4 ring-blue-100' : 'bg-slate-900 text-white hover:bg-slate-800 active:scale-95'}`}
                >
                  {isSpeaking ? <AudioLines size={22} className="animate-pulse" /> : <Volume2 size={22} />}
                  <span className="text-lg">{isSpeaking ? '正在朗读题目...' : '听老师读题'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {errorStatus && (
          <div className="bg-rose-50 p-6 rounded-[2.5rem] border-2 border-rose-100 space-y-4 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center gap-3 text-rose-600 font-black text-lg"><AlertCircle size={24} /><span>哎呀，出错了</span></div>
            <p className="text-rose-500 font-bold leading-tight">{errorStatus}</p>
            {!errorStatus.includes("能量已用完") && (
              <button 
                onClick={loadQuestionAtCurrentIndex}
                className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-rose-200"
              ><RefreshCw size={20} /> 点击重试</button>
            )}
          </div>
        )}

        {!isLoadingQuestion && currentQuestion && !errorStatus && (
          <div className="space-y-4">
            {currentQuestion.type === 'choice' ? (
              <div className="grid grid-cols-1 gap-3">
                {currentQuestion.options?.map((opt, idx) => {
                  const isCorrect = idx === currentQuestion.correctIndex;
                  const isSelected = idx === selectedOption;
                  let style = "bg-white text-slate-700";
                  if (isAnswered) {
                    if (isCorrect) style = "bg-emerald-500 text-white shadow-xl scale-[1.02]";
                    else if (isSelected) style = "bg-rose-500 text-white";
                    else style = "bg-white text-slate-300 opacity-50";
                  }
                  return (
                    <button key={idx} onClick={() => handleChoiceSubmit(idx)} disabled={isAnswered} className={`w-full p-5 rounded-[2.2rem] font-black text-lg transition-all flex items-center gap-4 border-2 border-transparent shadow-sm ${style}`}>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 shrink-0 ${isAnswered && isCorrect ? 'bg-white text-emerald-500' : 'border-current opacity-30'}`}>{String.fromCharCode(65 + idx)}</div>
                      <span className="flex-grow text-left">{opt}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-4">
                <textarea value={userInputValue} onChange={(e) => setUserInputValue(e.target.value)} disabled={isAnswered} placeholder="请输入你的答案..." className="w-full h-36 p-6 rounded-[2.5rem] border-2 border-slate-200 focus:border-blue-400 outline-none font-bold text-xl transition-all resize-none bg-white shadow-inner" />
                {!isAnswered && <button onClick={handleInputSubmit} disabled={isVerifying || !userInputValue.trim()} className="w-full py-5 bg-blue-500 text-white rounded-[2.2rem] font-black text-xl flex items-center justify-center gap-3 active:scale-95 shadow-lg">{isVerifying ? <Loader2 className="animate-spin" /> : "确认提交"}</button>}
              </div>
            )}
          </div>
        )}
      </div>
      {isAnswered && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-6 flex justify-center">
          <div className="w-full max-w-[460px] bg-white rounded-[3rem] shadow-2xl p-6 border border-slate-100 flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${isLastCorrect ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>{isLastCorrect ? <CheckCircle size={32} /> : <XCircle size={32} />}</div>
              <div><h4 className={`text-lg font-black ${isLastCorrect ? 'text-emerald-600' : 'text-rose-600'}`}>{isLastCorrect ? '太棒了！' : '加油哦'}</h4>{aiFeedback && <p className="text-[11px] text-slate-400 font-bold">{aiFeedback}</p>}</div>
              <div className="ml-auto font-black text-slate-300 text-xl">+{isLastCorrect ? currentQuestion?.points : 0}</div>
            </div>
            <div className="bg-slate-50 p-4 rounded-2xl max-h-[120px] overflow-y-auto text-slate-600 text-[13px] leading-relaxed"><span className="font-black text-slate-800">解析：</span>{currentQuestion?.explanation}</div>
            <button onClick={nextStep} className="w-full py-5 bg-slate-900 text-white rounded-[2.2rem] font-black text-xl flex items-center justify-center gap-2">下一题 <ChevronRight size={20} /></button>
          </div>
        </div>
      )}
      {showExitModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
           <div className="bg-white rounded-[3.5rem] p-10 w-full max-w-sm shadow-2xl space-y-8 text-center">
              <div className="w-24 h-24 bg-rose-50 text-rose-500 rounded-[2.8rem] flex items-center justify-center mx-auto shadow-inner"><AlertCircle size={56} /></div>
              <div><h3 className="text-3xl font-black text-slate-900">这就结束了吗？</h3><p className="text-slate-500 font-medium mt-3">中途退出将不会记录本套题的完整进度哦</p></div>
              <div className="grid grid-cols-1 gap-3">
                 <button onClick={() => setShowExitModal(false)} className="py-5 bg-slate-900 text-white rounded-[2.2rem] font-black text-xl shadow-xl">继续探险</button>
                 <button onClick={() => setView('dashboard')} className="py-4 text-rose-500 font-black">确认退出</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );

  const ProfileView = () => (
    <div className="h-full bg-slate-50 flex flex-col">
       <header className="p-6 flex justify-between items-center bg-white shadow-sm shrink-0">
          <button onClick={() => setView('dashboard')} className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-800"><ArrowLeft size={22} /></button>
          <span className="text-xl font-black text-slate-900">探险成就</span>
          <div className="w-12"></div>
       </header>
       <div className="p-6 space-y-8 overflow-y-auto flex-grow">
          <div className="flex flex-col items-center gap-6 py-12 bg-white rounded-[4rem] shadow-sm">
             <div className="relative">
                <div className="w-32 h-32 bg-yellow-100 rounded-[3.5rem] p-1 border-4 border-yellow-400 shadow-2xl overflow-hidden"><img src={profile.avatarUrl} onError={handleImgError} className="w-full h-full rounded-[3.2rem] object-cover" /></div>
                <button onClick={() => setShowAvatarPicker(true)} className="absolute bottom-0 right-0 w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center border-4 border-white shadow-xl"><Camera size={20} /></button>
             </div>
             <div className="flex flex-col items-center w-full px-10">
               {isEditingName ? (
                 <div className="flex items-center gap-2 border-b-4 border-blue-500 w-full">
                    <input autoFocus value={tempName} onChange={(e) => setTempName(e.target.value)} onBlur={updateProfileName} onKeyDown={(e) => e.key === 'Enter' && updateProfileName()} className="text-center text-3xl font-black text-slate-900 w-full outline-none bg-transparent py-2" />
                    <button onClick={updateProfileName} className="text-emerald-500"><Check size={24} /></button>
                 </div>
               ) : (
                 <div className="flex items-center gap-3 cursor-pointer group" onClick={() => { setTempName(profile.name); setIsEditingName(true); }}>
                   <h3 className="text-3xl font-black text-slate-900">{profile.name}</h3>
                   <Edit2 size={18} className="text-slate-300" />
                 </div>
               )}
               <button onClick={() => setView('gradeSelect')} className="flex items-center gap-2 bg-blue-600 px-6 py-2.5 rounded-full text-white font-black text-[12px] mt-6 tracking-widest uppercase shadow-lg">
                  <Hash size={14} />{profile.grade}年级 • 修改
               </button>
             </div>
             <div className="w-full px-8 space-y-3 pt-4">
               <p className="text-[10px] text-slate-400 font-black uppercase text-center tracking-widest">学习生涯统计</p>
               <div className="grid grid-cols-3 gap-3">
                  {(['Math', 'Chinese', 'English'] as Subject[]).map(s => (
                    <div key={s} className="bg-slate-50 rounded-3xl p-4 text-center border border-slate-100">
                      <div className="text-[10px] font-black text-slate-400 uppercase mb-1">{s === 'Math' ? '数学' : s === 'Chinese' ? '语文' : '英语'}</div>
                      <div className="text-2xl font-black text-slate-900">{profile.setsCompleted[s]} <span className="text-[11px] text-slate-400 font-bold">套</span></div>
                    </div>
                  ))}
               </div>
               <div className="bg-yellow-50 rounded-3xl p-6 border border-yellow-100 flex justify-between items-center mt-4">
                  <div className="flex items-center gap-3">
                     <div className="w-12 h-12 bg-yellow-400 rounded-2xl flex items-center justify-center text-white shadow-md"><Trophy size={24} fill="currentColor" /></div>
                     <div><p className="text-[10px] font-black text-yellow-600 uppercase">总积分</p><p className="text-2xl font-black text-slate-800">{profile.points}</p></div>
                  </div>
               </div>
             </div>
          </div>
       </div>
       {showAvatarPicker && (
         <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
            <div className="bg-white rounded-[4rem] w-full max-w-sm p-10 space-y-8">
               <div className="flex justify-between items-center"><h3 className="text-2xl font-black text-slate-900">更换形象</h3><button onClick={() => setShowAvatarPicker(false)} className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400"><XCircle /></button></div>
               <div className="grid grid-cols-3 gap-4">{DEFAULT_AVATARS.map(url => <button key={url} onClick={() => { setProfile(p => ({ ...p, avatarUrl: url })); setShowAvatarPicker(false); }} className={`aspect-square rounded-[2rem] overflow-hidden border-4 transition-all ${profile.avatarUrl === url ? 'border-blue-500 scale-105 shadow-xl' : 'border-transparent opacity-60'}`}><img src={url} alt="Option" className="w-full h-full object-cover" /></button>)}</div>
            </div>
         </div>
       )}
    </div>
  );

  return (
    <div className="app-container shadow-2xl border-x border-slate-100">
      {view === 'splash' && <Splash />}
      {view === 'landing' && <LandingPage />}
      {view === 'nameEntry' && <NameEntry />}
      {view === 'gradeSelect' && <GradeSelect />}
      {view === 'dashboard' && <Dashboard />}
      {view === 'topicSelect' && (
        <div className="h-full bg-[#FFFDF2] flex flex-col p-8 items-center justify-center">
          <div className="w-full max-w-xs space-y-6">
            <div className="text-center space-y-2">
               <div className={`w-24 h-24 mx-auto rounded-[2.5rem] flex items-center justify-center mb-6 shadow-2xl ${selectedSubject === 'Math' ? 'bg-blue-500' : selectedSubject === 'Chinese' ? 'bg-rose-500' : 'bg-emerald-500'} text-white`}>
                 {selectedSubject === 'Math' ? <Calculator size={48} /> : selectedSubject === 'Chinese' ? <Languages size={48} /> : <BookOpen size={48} />}
               </div>
               <h2 className="text-3xl font-black text-slate-900">探险方向 ✨</h2>
               <p className="text-slate-500 font-medium">指定今天想挑战的具体话题</p>
            </div>
            <input type="text" value={userTopic} onChange={(e) => setUserTopic(e.target.value)} placeholder="如：除法、成语、单词 (选填)" className="w-full p-6 rounded-[2rem] border-2 border-slate-200 focus:border-blue-400 font-bold text-lg text-center outline-none bg-white shadow-sm" />
            <button onClick={confirmTopicAndStart} className="w-full bg-slate-900 text-white py-6 rounded-[2.5rem] font-black text-xl shadow-xl flex items-center justify-center gap-2">开启挑战 <ChevronRight /></button>
            <button onClick={() => setView('dashboard')} className="w-full text-slate-400 font-bold text-sm text-center">取消</button>
          </div>
        </div>
      )}
      {view === 'quiz' && <QuizView />}
      {view === 'result' && (
        <div className="h-full bg-[#FFFDF2] flex flex-col items-center justify-center p-8 text-center">
          <div className="w-full max-w-sm bg-white rounded-[4rem] shadow-2xl p-12 space-y-8">
             <div className="w-36 h-36 mx-auto rounded-[3.5rem] flex items-center justify-center shadow-xl bg-yellow-400 text-white"><Trophy size={80} /></div>
             <div className="space-y-2"><h2 className="text-4xl font-black text-slate-900">大获全胜！</h2><p className="text-slate-400 font-bold text-lg">你在本次探险中获得了 {sessionPoints} 分积分</p></div>
             <div className="grid grid-cols-2 gap-4">
               <div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100"><div className="text-[10px] font-black text-slate-400 uppercase mb-1">本次积分</div><div className="text-4xl font-black text-slate-900">+{sessionPoints}</div></div>
               <div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100"><div className="text-[10px] font-black text-slate-400 uppercase mb-1">总积分</div><div className="text-4xl font-black text-emerald-500">{profile.points}</div></div>
             </div>
             <button onClick={() => setView('dashboard')} className="w-full bg-slate-900 text-white py-6 rounded-[2.5rem] font-black text-xl shadow-2xl">回到首页</button>
          </div>
        </div>
      )}
      {view === 'profile' && <ProfileView />}
    </div>
  );
};

export default App;
