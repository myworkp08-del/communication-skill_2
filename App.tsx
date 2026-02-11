
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Chat, GenerateContentResponse } from '@google/genai';
import { UserLevel, PracticeGoal, Message, Session } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audio-utils';
import { 
  Mic, MicOff, MessageSquare, BookOpen, 
  Settings, User, ChevronRight, Play, 
  CheckCircle, RefreshCw, BarChart3, AlertCircle,
  Send, Loader2, Calendar, History as HistoryIcon,
  Trash2, Plus, Languages, Search, Lightbulb, X, Volume2,
  Sparkles, Layers, Target, Headphones, Menu
} from 'lucide-react';

const formatMessageText = (text: string, onPlayAudio?: (text: string) => void) => {
  if (!text) return '';
  const parts = text.split(/(Corrected:.*?\n|Meaning:.*?\n|Practice:.*?\n)/g);
  
  return parts.map((part, i) => {
    if (!part.trim()) return null;

    if (part.startsWith('Corrected:')) {
      const content = part.replace('Corrected:', '').trim();
      const subParts = content.split(/(\*\*.*?\*\*)/g);
      const cleanText = content.replace(/\*\*/g, '');
      
      return (
        <div key={i} className="mb-3 bg-emerald-50/40 p-3 md:p-4 rounded-xl border border-emerald-100 shadow-sm relative group transition-all">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                <CheckCircle className="w-2.5 h-2.5 text-white" />
              </div>
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Natural Suggestion</span>
            </div>
            {onPlayAudio && (
              <button 
                onClick={() => onPlayAudio(cleanText)}
                className="p-1.5 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors active:scale-95"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="text-slate-800 font-semibold text-sm md:text-base leading-relaxed">
            {subParts.map((sp, j) => sp.startsWith('**') ? (
              <span key={j} className="text-indigo-600 bg-indigo-50/50 px-1 rounded mx-0.5">{sp.slice(2, -2)}</span>
            ) : sp)}
          </div>
        </div>
      );
    }
    
    if (part.startsWith('Meaning:')) {
      const content = part.replace('Meaning:', '').trim();
      return (
        <div key={i} className="mb-3 px-1 flex items-start gap-2 text-slate-500 italic">
          <Languages className="w-3.5 h-3.5 mt-1 shrink-0 opacity-40" />
          <span className="text-[12px] md:text-[13px] font-medium leading-relaxed">
            {content}
          </span>
        </div>
      );
    }

    if (part.startsWith('Practice:')) {
      const content = part.replace('Practice:', '').trim();
      return (
        <div key={i} className="mb-2 bg-orange-50/50 border border-orange-100 p-3 rounded-lg flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-100 rounded-md flex items-center justify-center text-orange-600 shrink-0">
            <Mic className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase text-orange-400 tracking-wider">Your Turn</p>
            <p className="text-[13px] md:text-sm font-bold text-slate-700">{content}</p>
          </div>
        </div>
      );
    }

    return <div key={i} className="text-slate-600 text-sm font-medium leading-relaxed mb-4 px-1">{part}</div>;
  });
};

const SUPPORTED_LANGUAGES = ["Arabic", "Bengali", "Chinese", "English", "French", "German", "Hindi", "Indonesian", "Italian", "Japanese", "Korean", "Malayalam", "Marathi", "Portuguese", "Punjabi", "Russian", "Spanish", "Tamil", "Telugu", "Turkish", "Urdu", "Vietnamese"].sort();

const App: React.FC = () => {
  const [history, setHistory] = useState<Session[]>(() => {
    const saved = localStorage.getItem('speakflow_history');
    return saved ? JSON.parse(saved) : [];
  });

  const [level, setLevel] = useState<UserLevel>(UserLevel.INTERMEDIATE);
  const [goal, setGoal] = useState<PracticeGoal>(PracticeGoal.DAILY);
  const [nativeLanguage, setNativeLanguage] = useState<string>("Tamil");
  const [isPlayingTTS, setIsPlayingTTS] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const outputContextRef = useRef<AudioContext | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chatRef = useRef<Chat | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentSessionId && messages.length > 0) {
      setHistory(prev => {
        const existingIdx = prev.findIndex(s => s.id === currentSessionId);
        const updated = [...prev];
        if (existingIdx !== -1) {
          updated[existingIdx] = { ...updated[existingIdx], messages, level, goal, nativeLanguage };
        } else {
          updated.unshift({ id: currentSessionId, date: Date.now(), level, goal, nativeLanguage, messages });
        }
        return updated.slice(0, 50);
      });
    }
  }, [messages, currentSessionId, level, goal, nativeLanguage]);

  useEffect(() => {
    localStorage.setItem('speakflow_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = useCallback((text: string, role: 'user' | 'model', type: 'text' | 'audio' = 'text') => {
    setMessages(prev => [...prev, {
      id: Math.random().toString(36).substring(7),
      role, text, type, timestamp: Date.now()
    }]);
  }, []);

  const playTTS = async (text: string) => {
    if (isPlayingTTS) return;
    setIsPlayingTTS(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Speak naturally and clearly: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
        },
      });
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        if (!outputContextRef.current) outputContextRef.current = new AudioContext({ sampleRate: 24000 });
        const ctx = outputContextRef.current;
        const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => setIsPlayingTTS(false);
        source.start();
      } else { setIsPlayingTTS(false); }
    } catch (err) { setIsPlayingTTS(false); }
  };

  const systemInstruction = useMemo(() => `
    You are Pesu Buddy, a world-class Communication Coach.
    Current User Level: ${level}.
    Primary Practice Goal: ${goal}.
    Native Language: ${nativeLanguage}.
    
    GUIDELINES:
    1. Chat naturally, like a real supportive friend.
    2. Correct grammar gently. If the user makes a mistake, provide a better version.
    3. Always ask one interesting question to keep the conversation flowing.
    4. Adapt your vocabulary to the user's level.
    
    RESPONSE FORMAT (Strictly follow this order for feedback):
    Corrected: [A natural, better version. Use **bold** for improved words]
    Meaning: [A short translation/explanation in ${nativeLanguage}]
    Practice: [One simple sentence for the user to repeat out loud]
    
    [Your natural chat response and follow-up question here]
  `, [level, goal, nativeLanguage]);

  const toggleLiveSession = async () => {
    if (isLive) { stopSession(); return; }
    setIsConnecting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      outputContextRef.current = new AudioContext({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            setIsLive(true); setIsConnecting(false); setShowConfig(false);
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(inputData) }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              addMessage(message.serverContent.inputTranscription.text, 'user', 'audio');
            }
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputContextRef.current) {
              const ctx = outputContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
              source.onended = () => sourcesRef.current.delete(source);
              const textPart = message.serverContent?.modelTurn?.parts?.find(p => p.text)?.text;
              if (textPart) addMessage(textPart, 'model', 'audio');
            }
          },
          onerror: stopSession,
          onclose: stopSession
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) { setIsConnecting(false); }
  };

  const stopSession = () => {
    setIsLive(false); setIsConnecting(false);
    if (sessionRef.current) try { sessionRef.current.close(); } catch {}
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioContextRef.current) audioContextRef.current.close();
    if (outputContextRef.current) outputContextRef.current.close();
    sourcesRef.current.forEach(s => s.stop());
    sourcesRef.current.clear();
  };

  const handleSendText = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || isTyping) return;
    if (!currentSessionId) startNewPractice();
    
    const userText = inputText.trim();
    setInputText('');
    addMessage(userText, 'user', 'text');
    setIsTyping(true);
    setShowConfig(false);
    
    try {
      if (!chatRef.current) {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        chatRef.current = ai.chats.create({ model: 'gemini-3-flash-preview', config: { systemInstruction } });
      }
      const result = await chatRef.current.sendMessageStream({ message: userText });
      const messageId = Math.random().toString(36).substring(7);
      setMessages(prev => [...prev, { id: messageId, role: 'model', text: '', type: 'text', timestamp: Date.now() }]);
      let fullResponse = '';
      for await (const chunk of result) {
        const textChunk = (chunk as GenerateContentResponse).text;
        if (textChunk) {
          fullResponse += textChunk;
          setMessages(prev => prev.map(m => m.id === messageId ? { ...m, text: fullResponse } : m));
        }
      }
      const correctedMatch = fullResponse.match(/Corrected:\s*(.*?)(?:\n|$)/);
      if (correctedMatch) playTTS(correctedMatch[1].replace(/\*\*/g, ''));
    } catch (err) { addMessage("Oops, let's try that again!", 'model', 'text'); } finally { setIsTyping(false); }
  };

  const startNewPractice = () => {
    const id = Math.random().toString(36).substring(7);
    setCurrentSessionId(id);
    setMessages([]);
    chatRef.current = null;
    setShowConfig(false);
    setIsSidebarOpen(false);
    setTimeout(() => {
      addMessage(`Hello! I'm Pesu Buddy, your coach. I'm excited to help you with ${goal}. How has your day been so far?`, 'model');
    }, 200);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col lg:flex-row h-screen overflow-hidden text-slate-800">
      
      {/* Responsive Sidebar */}
      <aside className={`
        fixed inset-0 z-50 transition-transform duration-300 transform lg:relative lg:translate-x-0 lg:z-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        w-72 md:w-80 bg-slate-50 border-r border-slate-200 flex flex-col shadow-2xl lg:shadow-none
      `}>
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
              <Sparkles className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg tracking-tight">Pesu Buddy</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-8 scrollbar-hide">
          <div className="space-y-4">
            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest px-1">Coaching Setup</p>
            <div className="bg-white rounded-2xl p-4 border border-slate-200/60 shadow-sm space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase ml-1 mb-1.5 block">Learning Level</label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                  {Object.values(UserLevel).map(l => (
                    <button 
                      key={l} 
                      onClick={() => setLevel(l)} 
                      className={`py-1.5 rounded-md text-[10px] font-bold transition-all ${level === l ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {l.charAt(0).toUpperCase() + l.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase ml-1 mb-1.5 block">Your Goal</label>
                <select value={goal} onChange={(e) => setGoal(e.target.value as PracticeGoal)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-indigo-100 transition-all appearance-none">
                  {Object.values(PracticeGoal).map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase ml-1 mb-1.5 block">Native Language</label>
                <select value={nativeLanguage} onChange={(e) => setNativeLanguage(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-[13px] font-semibold outline-none appearance-none">
                  {SUPPORTED_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest px-1">Recent Sessions</p>
            <div className="space-y-1.5">
              {history.length === 0 ? (
                <div className="text-center py-8 opacity-40">
                  <HistoryIcon className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-[11px] font-medium">No history yet</p>
                </div>
              ) : history.map(s => (
                <button 
                  key={s.id} 
                  onClick={() => { setCurrentSessionId(s.id); setMessages(s.messages); setGoal(s.goal); setLevel(s.level); setNativeLanguage(s.nativeLanguage); setShowConfig(false); setIsSidebarOpen(false); }} 
                  className={`w-full text-left p-3.5 rounded-xl border transition-all ${currentSessionId === s.id ? 'bg-indigo-50 border-indigo-100' : 'bg-transparent border-transparent hover:bg-slate-200/50'}`}
                >
                  <p className={`text-[13px] font-bold truncate ${currentSessionId === s.id ? 'text-indigo-600' : 'text-slate-700'}`}>{s.goal}</p>
                  <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1.5">
                    <Calendar className="w-3 h-3" />
                    {new Date(s.date).toLocaleDateString()} • {s.messages.length} msgs
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200">
          <button onClick={startNewPractice} className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-[13px] font-bold uppercase flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-[0.98]">
            <Plus className="w-4 h-4" /> New Session
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <main className="flex-1 flex flex-col bg-white overflow-hidden relative">
        
        {/* Header */}
        <header className="px-4 md:px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white/90 backdrop-blur-md z-20">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 text-slate-500 hover:bg-slate-50 rounded-lg">
              <Menu className="w-6 h-6" />
            </button>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-md transition-all ${isLive ? 'bg-rose-500 animate-pulse' : 'bg-indigo-600'}`}>
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-sm md:text-base leading-tight">Practice Session</h2>
              <p className="text-[10px] md:text-[11px] font-bold text-slate-400 uppercase tracking-widest">{goal} • {level}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {isLive && (
              <div className="hidden md:flex items-center gap-2 bg-rose-50 px-3 py-1.5 rounded-full border border-rose-100">
                <div className="w-2 h-2 bg-rose-500 rounded-full animate-ping" />
                <span className="text-[10px] font-bold text-rose-600 uppercase">Live Coaching</span>
              </div>
            )}
            <button onClick={startNewPractice} className="p-2 text-slate-400 hover:text-indigo-600 transition-all">
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto relative bg-[#fcfdfe] pt-2">
          {showConfig && !messages.length ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-8 animate-in fade-in zoom-in duration-500">
              <div className="space-y-4 max-w-sm">
                <div className="w-20 h-20 bg-indigo-50 rounded-[2.5rem] flex items-center justify-center text-indigo-600 mx-auto shadow-sm">
                  <Sparkles className="w-10 h-10" />
                </div>
                <div>
                  <h1 className="text-2xl font-extrabold tracking-tight mb-2">Ready to Shine?</h1>
                  <p className="text-slate-400 text-[13px] font-medium px-4">Improve your English naturally through real conversations. What should we work on?</p>
                </div>
              </div>

              <div className="w-full max-w-sm grid grid-cols-2 gap-3 px-4">
                {Object.values(PracticeGoal).slice(0, 6).map(g => (
                  <button 
                    key={g} 
                    onClick={() => { setGoal(g); startNewPractice(); }} 
                    className="p-4 rounded-2xl text-[12px] font-bold bg-white border border-slate-200 text-slate-600 hover:border-indigo-400 hover:text-indigo-600 hover:shadow-md transition-all"
                  >
                    {g}
                  </button>
                ))}
              </div>
              <p className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em]">Select a topic to begin</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto p-4 md:p-10 space-y-6 md:space-y-10">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-4 duration-300`}>
                  <div className={`max-w-[90%] md:max-w-[85%] rounded-[1.5rem] md:rounded-[2rem] overflow-hidden ${msg.role === 'user' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-white border border-slate-200 shadow-sm'}`}>
                    <div className={`px-5 py-4 md:px-7 md:py-6 ${msg.role === 'user' ? '' : 'text-slate-800'}`}>
                      {msg.role === 'model' ? formatMessageText(msg.text, playTTS) : (
                        <p className="text-[14px] md:text-[16px] font-semibold tracking-tight leading-relaxed">{msg.text}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} className="h-4" />
            </div>
          )}
        </div>

        {/* Floating Live Indicator for Mobile */}
        {isLive && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 md:hidden z-30">
            <div className="bg-rose-500 text-white px-4 py-2 rounded-full flex items-center gap-3 shadow-xl border border-rose-400 animate-bounce">
              <Mic className="w-4 h-4" />
              <span className="text-[10px] font-extrabold uppercase tracking-widest">Listening...</span>
            </div>
          </div>
        )}

        {/* Unified Input Section */}
        <div className="p-4 md:p-8 bg-white border-t border-slate-100 z-10">
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <form onSubmit={handleSendText} className="relative">
                  <textarea
                    rows={1}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendText();
                      }
                    }}
                    placeholder={`Say something...`}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-full pl-5 pr-14 py-4 text-[14px] md:text-[15px] font-bold text-slate-800 outline-none transition-all placeholder:text-slate-300 resize-none max-h-32 min-h-[56px] leading-relaxed overflow-hidden"
                    disabled={isTyping}
                  />
                  <button 
                    type="submit" 
                    disabled={!inputText.trim() || isTyping} 
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 text-white rounded-full transition-all disabled:opacity-0 active:scale-90"
                  >
                    {isTyping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </form>
              </div>
              
              <button
                type="button"
                onClick={toggleLiveSession}
                disabled={isConnecting}
                className={`h-14 w-14 rounded-full shadow-lg transition-all active:scale-90 flex items-center justify-center shrink-0 ${
                  isLive ? 'bg-rose-500 text-white shadow-rose-200' : 'bg-slate-950 text-white shadow-slate-100'
                } ${isConnecting ? 'opacity-50' : ''}`}
              >
                {isLive ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>
            </div>
            
            <div className="flex justify-center gap-6">
              <div className="flex items-center gap-1.5 opacity-40">
                <BookOpen className="w-3 h-3" />
                <span className="text-[9px] font-bold uppercase tracking-widest">Feedback Enabled</span>
              </div>
              <div className="flex items-center gap-1.5 opacity-40">
                <Target className="w-3 h-3" />
                <span className="text-[9px] font-bold uppercase tracking-widest">Pro Voice Engine</span>
              </div>
            </div>
          </div>
        </div>

      </main>

      {/* Mobile Drawer Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden animate-in fade-in duration-300" 
          onClick={() => setIsSidebarOpen(false)} 
        />
      )}

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        textarea::placeholder { font-weight: 500; }
        @keyframes subtle-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
};

export default App;
