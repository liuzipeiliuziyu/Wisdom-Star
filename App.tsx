import React, { useState, useEffect, useRef } from 'react';
import { 
  Trophy, ChevronRight, ArrowLeft, Star, Loader2, Award, AlertCircle,
  Edit2, XCircle, CheckCircle, Calculator, Languages, 
  BookOpen, Camera, Check, ArrowRight, Volume2, Lock, Hash, Play, RefreshCw,
  AudioLines
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

// 默认用户名为 "kim"
const INITIAL_PROFILE: UserProfile = {
  name: "kim",
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
  const [view, setView] = useState<'splash' | 'dashboard' | 'topicSelect' | 'quiz' | 'result' | 'profile' | 'gradeSelect'>('splash');
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
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const gemini = useRef(new GeminiService());

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setProfile(JSON.parse(saved));
    }
    const timer = setTimeout(() => {
      setView('dashboard');
    }, 100);
    
    return () => {
      clearTimeout(timer);
      if (audioSourceRef.current) audioSourceRef.current.stop();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  }, [profile]);

  const handleError = (e: any) => {
    console.error("API Error:", e);
    if (e.message === 'MISSING_API_KEY') {
      setErrorStatus("请在 Vercel 中设置 API_KEY 环境变量并重新部署。");
    } else {
      setErrorStatus("魔法连接失败，请检查网络或配置。");
    }
  };

  const playQuestionSpeech = async () => {
    if (isSpeaking || !currentQuestion) return;
    setIsSpeaking(true);
    try {
      const base64Audio = await gemini.current.generateSpeech(currentQuestion.text);
      if (!base64Audio) { setIsSpeaking(false); return; }
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

  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    e.currentTarget.src = FALLBACK_IMAGE;
  };

  // ---------------- UI Parts ----------------

  const Splash = () => (
    <div className="h-full w-full bg-white flex flex-col items-center justify-center p-10">
      <div className="w-48 h-48 bg-yellow-400 rounded-[3.5rem] shadow-2xl flex items-center justify-center mb-10 animate-bounce-soft">
        <Star size={80} className="text-white fill-current" />
      </div>
      <h1 className="text-4xl font-black text-slate-900 mb-2">SmartKids</h1>
      <p className="text-slate-400 font-bold tracking-widest text-xs uppercase">AI Powered Learning</p>
    </div>
  );

  const Dashboard = () => (
    <div className="h-full flex flex-col bg-white">
      <div className="p-6 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full border-4 border-yellow-400 p-0.5 overflow-hidden shadow-md">
            <img src={profile.avatarUrl} onError={handleImgError} className="w-full h-full rounded-full" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400">探险家</p>
            <h2 className="text-xl font-black text-slate-900">{profile.name}</h2>
          </div>
        </div>
        <div className="bg-yellow-400 text-white px-5 py-2.5 rounded-full shadow-lg flex items-center gap-2">
           <Trophy size={18} fill="currentColor" />
           <span className="font-black text-lg">{profile.points} 分</span>
        </div>
      </div>
      <div className="px-8 py-4">
        <h1 className="text-3xl font-black text-slate-900 leading-tight">你好 {profile.name},<br />今天想挑战<span className="text-yellow-500">什么</span>？</h1>
      </div>
      <div className="flex-grow overflow-y-auto px-6 space-y-5 pb-10">
        {[
          { id: 'Math', name: '数学', sub: 'Numbers & Logic', img: "https://images.unsplash.com/photo-1596495573826-3946d022b4f2?auto=format&w=200", bg: 'bg-blue-50', btn: 'bg-blue-600' },
          { id: 'Chinese', name: '语文', sub: 'Reading & Poetry', img: "https://images.unsplash.com/photo-1544391496-1ca7c97452c2?auto=format&w=200", bg: 'bg-rose-50', btn: 'bg-rose-500' },
          { id: 'English', name: '英语', sub: 'ABC & Speaking', img: "https://images.unsplash.com/photo-1546410531-bb4caa6b424d?auto=format&w=200", bg: 'bg-emerald-50', btn: 'bg-emerald-500' },
        ].map((s) => (
          <div key={s.id} onClick={() => { setSelectedSubject(s.id as Subject); setUserTopic(""); setView('topicSelect'); }} className={`relative ${s.bg} rounded-[2.5rem] p-5 flex items-center gap-4 group cursor-pointer active:scale-95 transition-all shadow-sm`}>
            <div className="w-20 h-20 bg-white rounded-2xl border-4 border-white shadow-sm overflow-hidden shrink-0"><img src={s.img} onError={handleImgError} className="w-full h-full object-cover" /></div>
            <div className="flex-grow">
              <h3 className="text-xl font-black text-slate-800">{s.name}</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase">{s.sub}</p>
              <div className="bg-white/60 px-3 py-1 rounded-full inline-flex items-center gap-1.5 mt-2 shadow-sm">
                <CheckCircle size={10} className="text-emerald-500 fill-current" />
                <span className="text-[10px] font-black text-slate-600">已刷 {profile.setsCompleted[s.id as Subject]} 套</span>
              </div>
            </div>
            <div className={`${s.btn} w-10 h-10 rounded-full flex items-center justify-center text-white absolute right-6 shadow-lg`}><ArrowRight size={20} /></div>
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
        <button onClick={() => setView('dashboard')} className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-md"><ArrowLeft size={20} /></button>
        <div className="text-center">
          <div className="font-black text-slate-400 text-[10px] uppercase tracking-widest">探险积分</div>
          <div className="text-3xl font-black text-blue-600">+{sessionPoints}</div>
        </div>
        <div className="font-black text-slate-400 text-sm bg-white shadow-sm px-4 py-1 rounded-full">{currentIndex + 1}/{QUESTIONS_PER_SET}</div>
      </header>
      <div className="flex-grow px-6 overflow-y-auto space-y-6 pb-48">
        <div className="bg-white rounded-[3rem] p-6 shadow-sm border border-slate-100 space-y-6 relative overflow-hidden">
          <div className="aspect-video bg-slate-50 rounded-[2.2rem] overflow-hidden flex items-center justify-center relative shadow-inner">
            {isLoadingQuestion ? (
              <Loader2 className="animate-spin text-blue-500" size={48} />
            ) : visualUrl ? (
              <img src={visualUrl} onError={handleImgError} className="w-full h-full object-cover" />
            ) : (
              <img src={FALLBACK_IMAGE} className="w-full h-full object-cover opacity-50 grayscale" />
            )}
          </div>
          {isLoadingQuestion ? (
            <div className="py-12 flex flex-col items-center gap-4">
              <Loader2 className="animate-spin text-blue-500" />
              <p className="font-black text-slate-400">正在召唤题目...</p>
            </div>
          ) : (
            <div className="space-y-6">
              <h3 className="text-xl font-black text-slate-800 text-center leading-relaxed px-4">{currentQuestion?.text}</h3>
              <div className="flex justify-center">
                <button 
                  onClick={playQuestionSpeech}
                  className={`flex items-center gap-2 px-8 py-4 rounded-full font-black transition-all shadow-xl ${isSpeaking ? 'bg-blue-600 text-white scale-105 ring-4 ring-blue-100' : 'bg-slate-900 text-white active:scale-95'}`}
                >
                  {isSpeaking ? <AudioLines size={22} className="animate-pulse" /> : <Volume2 size={22} />}
                  <span className="text-lg">{isSpeaking ? '朗读中...' : '听老师读题'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {errorStatus && (
          <div className="bg-rose-50 p-6 rounded-[2.5rem] border-2 border-rose-100 space-y-4">
            <div className="flex items-center gap-3 text-rose-600 font-black text-lg"><AlertCircle size={24} /><span>哎呀，出错了</span></div>
            <p className="text-rose-500 font-bold leading-tight">{errorStatus}</p>
            <button onClick={loadQuestionAtCurrentIndex} className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black shadow-lg">点击重试</button>
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
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 shrink-0 ${isAnswered && isCorrect ? 'bg-white text-emerald-500 border-white' : 'border-current opacity-30'}`}>{String.fromCharCode(65 + idx)}</div>
                      <span className="flex-grow text-left">{opt}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-4">
                <textarea value={userInputValue} onChange={(e) => setUserInputValue(e.target.value)} disabled={isAnswered} placeholder="请输入你的答案..." className="w-full h-36 p-6 rounded-[2.5rem] border-2 border-slate-200 focus:border-blue-400 outline-none font-bold text-xl transition-all resize-none bg-white shadow-inner" />
                {!isAnswered && <button onClick={handleInputSubmit} disabled={isVerifying || !userInputValue.trim()} className="w-full py-5 bg-blue-500 text-white rounded-[2.2rem] font-black text-xl flex items-center justify-center gap-3 shadow-lg">{isVerifying ? <Loader2 className="animate-spin" /> : "确认提交"}</button>}
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
            <div className="bg-slate-50 p-4 rounded-2xl max-h-[100px] overflow-y-auto text-slate-600 text-[13px] leading-relaxed"><span className="font-black text-slate-800">解析：</span>{currentQuestion?.explanation}</div>
            <button onClick={nextStep} className="w-full py-5 bg-slate-900 text-white rounded-[2.2rem] font-black text-xl flex items-center justify-center gap-2">下一题 <ChevronRight size={20} /></button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="app-container shadow-2xl">
      {view === 'splash' && <Splash />}
      {view === 'dashboard' && <Dashboard />}
      {view === 'topicSelect' && (
        <div className="h-full bg-[#FFFDF2] flex flex-col p-8 items-center justify-center">
          <div className="w-full max-w-xs space-y-6">
            <div className="text-center space-y-2">
               <div className={`w-24 h-24 mx-auto rounded-[2.5rem] flex items-center justify-center mb-6 shadow-2xl ${selectedSubject === 'Math' ? 'bg-blue-500' : selectedSubject === 'Chinese' ? 'bg-rose-500' : 'bg-emerald-500'} text-white`}>
                 {selectedSubject === 'Math' ? <Calculator size={48} /> : selectedSubject === 'Chinese' ? <Languages size={48} /> : <BookOpen size={48} />}
               </div>
               <h2 className="text-3xl font-black text-slate-900">探险方向 ✨</h2>
               <p className="text-slate-500 font-medium">指定你想挑战的话题（选填）</p>
            </div>
            <input type="text" value={userTopic} onChange={(e) => setUserTopic(e.target.value)} placeholder="如：乘法、成语、单词" className="w-full p-6 rounded-[2rem] border-2 border-slate-200 focus:border-blue-400 font-bold text-lg text-center outline-none bg-white shadow-sm" />
            <button onClick={confirmTopicAndStart} className="w-full bg-slate-900 text-white py-6 rounded-[2.5rem] font-black text-xl shadow-xl flex items-center justify-center gap-2">开启挑战 <ChevronRight /></button>
            <button onClick={() => setView('dashboard')} className="w-full text-slate-400 font-bold text-sm text-center">返回</button>
          </div>
        </div>
      )}
      {view === 'quiz' && <QuizView />}
      {view === 'result' && (
        <div className="h-full bg-[#FFFDF2] flex flex-col items-center justify-center p-8 text-center">
          <div className="w-full max-w-sm bg-white rounded-[4rem] shadow-2xl p-12 space-y-8">
             <div className="w-36 h-36 mx-auto rounded-[3.5rem] flex items-center justify-center shadow-xl bg-yellow-400 text-white"><Trophy size={80} /></div>
             <div className="space-y-2"><h2 className="text-4xl font-black text-slate-900">太棒了！</h2><p className="text-slate-400 font-bold text-lg">你在本次探险中获得了 {sessionPoints} 积分</p></div>
             <button onClick={() => setView('dashboard')} className="w-full bg-slate-900 text-white py-6 rounded-[2.5rem] font-black text-xl shadow-2xl">回到首页</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;