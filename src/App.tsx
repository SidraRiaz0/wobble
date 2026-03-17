/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { auth, db } from './firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User } from 'firebase/auth';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { MathGame } from './components/MathGame';
import { Camera, Mic, MicOff, Play, LogIn, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- Constants ---
const MODEL_LIVE = "gemini-2.5-flash-native-audio-preview-09-2025";
const MODEL_IMAGE = "gemini-2.5-flash-image";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [characterData, setCharacterData] = useState<{ name: string; colors: string; difficulty: number } | null>(null);
  const [characterImageUrl, setCharacterImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [showGame, setShowGame] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const nextAudioTimeRef = useRef<number>(0);

  // --- Auth ---
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      setError("Login failed. Please try again.");
    }
  };

  // --- Audio Processing ---
  const setupAudio = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
    }
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  };

  const playAudioChunk = (base64Data: string) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Int16Array(len / 2);
    for (let i = 0; i < len; i += 2) {
      bytes[i / 2] = (binaryString.charCodeAt(i + 1) << 8) | binaryString.charCodeAt(i);
    }

    const float32Data = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      float32Data[i] = bytes[i] / 32768.0;
    }

    const buffer = ctx.createBuffer(1, float32Data.length, 16000);
    buffer.getChannelData(0).set(float32Data);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startTime = Math.max(ctx.currentTime, nextAudioTimeRef.current);
    source.start(startTime);
    nextAudioTimeRef.current = startTime + buffer.duration;
  };

  // --- Image Generation ---
  const generateCharacterImage = async (name: string, colors: string) => {
    setIsGeneratingImage(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: MODEL_IMAGE,
        contents: {
          parts: [{ text: `A cute, friendly cartoon character named ${name}. Colors: ${colors}. Simple white background, high quality 3D render style, kid-friendly.` }]
        }
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          setCharacterImageUrl(`data:image/png;base64,${part.inlineData.data}`);
          break;
        }
      }
    } catch (err) {
      console.error("Image gen failed:", err);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // --- Live API ---
  const startLive = async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } });
      if (videoRef.current) videoRef.current.srcObject = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const sessionPromise = ai.live.connect({
        model: MODEL_LIVE,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: "You are Wobble, a magical children's storyteller. When you see a toy, give it a fun name and a personality. Narrate exactly a 3-sentence backstory for it. Then, immediately call the launch_game tool with the character's name, their exact colors from the toy, and a difficulty level from 1 to 5 based on the child's age mentioned. Speak warmly and excitedly!",
          tools: [{
            functionDeclarations: [{
              name: "launch_game",
              description: "Launches a math game starring the toy character.",
              parameters: {
                type: "OBJECT" as any,
                properties: {
                  character_name: { type: "STRING" as any, description: "Name of the character" },
                  character_colors: { type: "STRING" as any, description: "Main colors of the toy" },
                  difficulty: { type: "INTEGER" as any, description: "Difficulty level 1-5" }
                },
                required: ["character_name", "character_colors", "difficulty"]
              }
            }]
          }]
        },
        callbacks: {
          onopen: () => {
            setIsLive(true);
            setIsConnecting(false);
            setupAudio();
            
            // Start video streaming
            const interval = setInterval(() => {
              if (!videoRef.current) return;
              const canvas = canvasRef.current || document.createElement('canvas');
              canvas.width = 320;
              canvas.height = 240;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
                const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                sessionPromise.then(s => s.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } }));
              }
            }, 1000);
            sessionPromise.then(s => (s as any)._videoInterval = interval);

            // Start audio streaming
            navigator.mediaDevices.getUserMedia({ audio: true }).then(audioStream => {
              const ctx = new AudioContext({ sampleRate: 16000 });
              const source = ctx.createMediaStreamSource(audioStream);
              const processor = ctx.createScriptProcessor(2048, 1, 1);
              source.connect(processor);
              processor.connect(ctx.destination);
              processor.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0);
                const pcm = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) {
                  pcm[i] = Math.max(-1, Math.min(1, input[i])) * 32767;
                }
                const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
                sessionPromise.then(s => s.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } }));
              };
              sessionPromise.then(s => {
                (s as any)._audioCtx = ctx;
                (s as any)._audioStream = audioStream;
              });
            });
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.modelTurn?.parts) {
              for (const part of msg.serverContent.modelTurn.parts) {
                if (part.inlineData) playAudioChunk(part.inlineData.data);
              }
            }
            if (msg.toolCall) {
              const call = msg.toolCall.functionCalls[0];
              if (call.name === 'launch_game') {
                const args = call.args as any;
                
                // Send response back to model
                sessionPromise.then(s => s.sendToolResponse({
                  functionResponses: [{
                    name: call.name,
                    id: call.id,
                    response: { success: true }
                  }]
                }));

                setCharacterData({
                  name: args.character_name,
                  colors: args.character_colors,
                  difficulty: args.difficulty
                });
                generateCharacterImage(args.character_name, args.character_colors);
                
                // Log to Firestore
                if (user) {
                  addDoc(collection(db, 'sessions'), {
                    userId: user.uid,
                    characterName: args.character_name,
                    difficulty: args.difficulty,
                    timestamp: new Date().toISOString(),
                    toyDescription: `Colors: ${args.character_colors}`
                  });
                }

                // Wait for backstory to finish (approximate)
                setTimeout(() => setShowGame(true), 7000);
              }
            }
          },
          onclose: () => stopLive(),
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection lost. Please refresh.");
            stopLive();
          }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setError("Could not access camera/mic.");
      setIsConnecting(false);
    }
  };

  const stopLive = () => {
    if (sessionRef.current) {
      clearInterval(sessionRef.current._videoInterval);
      if (sessionRef.current._audioCtx) sessionRef.current._audioCtx.close().catch(() => {});
      if (sessionRef.current._audioStream) sessionRef.current._audioStream.getTracks().forEach((t: any) => t.stop());
      sessionRef.current.close();
    }
    sessionRef.current = null;
    setIsLive(false);
    setIsConnecting(false);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    // Reset character and game state
    setCharacterData(null);
    setCharacterImageUrl(null);
    setShowGame(false);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-50 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
            <Sparkles size={24} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Wobble</h1>
        </div>
        
        {user ? (
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-500 hidden sm:inline">{user.displayName}</span>
            <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-slate-200" alt="User" />
          </div>
        ) : (
          <button onClick={login} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-full text-sm font-semibold hover:bg-slate-800 transition-all">
            <LogIn size={16} /> Sign In
          </button>
        )}
      </header>

      <main className="pt-24 pb-12 px-6 max-w-6xl mx-auto">
        {!user ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <h2 className="text-5xl font-extrabold text-slate-900 tracking-tight">Turn toys into <span className="text-emerald-500">Magic</span>.</h2>
              <p className="text-xl text-slate-500 max-w-lg mx-auto">Sign in to start your adventure with Wobble and the Gemini Live API.</p>
              <button onClick={login} className="px-8 py-4 bg-emerald-500 text-white rounded-2xl font-bold text-lg shadow-xl shadow-emerald-200 hover:bg-emerald-600 transition-all active:scale-95">
                Get Started
              </button>
            </motion.div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            {/* Left: Camera & Controls */}
            <div className="space-y-8">
              <div className="relative aspect-video bg-slate-200 rounded-3xl overflow-hidden shadow-2xl border-4 border-white">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                {!isLive && !isConnecting && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
                    <button onClick={startLive} className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-emerald-500 shadow-2xl hover:scale-110 transition-all">
                      <Play size={32} fill="currentColor" />
                    </button>
                  </div>
                )}
                {isConnecting && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-md text-white gap-4">
                    <Loader2 className="animate-spin" size={48} />
                    <p className="font-medium">Connecting to Gemini...</p>
                  </div>
                )}
                <div className="absolute bottom-4 left-4 flex gap-2">
                  <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${isLive ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
                    <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-white animate-pulse' : 'bg-slate-500'}`} />
                    {isLive ? 'Wobble is listening...' : 'Offline'}
                  </div>
                </div>
              </div>

              <div className="flex justify-center gap-4">
                {isLive ? (
                  <button onClick={stopLive} className="px-8 py-4 bg-rose-500 text-white rounded-2xl font-bold shadow-lg hover:bg-rose-600 transition-all">
                    Stop Session
                  </button>
                ) : (
                  <button onClick={startLive} disabled={isConnecting} className="px-8 py-4 bg-emerald-500 text-white rounded-2xl font-bold shadow-lg hover:bg-emerald-600 transition-all disabled:opacity-50">
                    Start Adventure
                  </button>
                )}
              </div>

              {error && (
                <div className="p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl text-sm font-medium text-center">
                  {error}
                </div>
              )}
            </div>

            {/* Right: Character & Game */}
            <div className="space-y-8">
              <AnimatePresence mode="wait">
                {showGame && characterData ? (
                  <motion.div key="game" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                    <MathGame 
                      characterName={characterData.name}
                      characterColors={characterData.colors}
                      difficulty={characterData.difficulty}
                      characterImageUrl={characterImageUrl}
                      onGameOver={() => setShowGame(false)}
                    />
                  </motion.div>
                ) : (
                  <motion.div key="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 min-h-[400px] flex flex-col items-center justify-center text-center space-y-6">
                    {isGeneratingImage ? (
                      <>
                        <div className="w-32 h-32 bg-slate-100 rounded-full flex items-center justify-center">
                          <Loader2 className="animate-spin text-emerald-500" size={48} />
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-2xl font-bold">Creating your friend...</h3>
                          <p className="text-slate-500">Gemini is drawing {characterData?.name}!</p>
                        </div>
                      </>
                    ) : characterImageUrl ? (
                      <>
                        <img src={characterImageUrl} className="w-64 h-64 rounded-3xl shadow-2xl border-4 border-white" alt="Character" referrerPolicy="no-referrer" />
                        <div className="space-y-2">
                          <h3 className="text-3xl font-bold text-emerald-600">{characterData?.name}</h3>
                          <p className="text-slate-500 italic">"Get ready to play!"</p>
                        </div>
                      </>
                    ) : characterData ? (
                      <>
                        <div className="w-32 h-32 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500">
                          <Loader2 className="animate-spin" size={48} />
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-2xl font-bold">Get Ready!</h3>
                          <p className="text-slate-500">The game is starting in a few seconds...</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500">
                          <Sparkles size={48} />
                        </div>
                        <div className="space-y-4 max-w-xs">
                          <h3 className="text-2xl font-bold">Magic Adventure</h3>
                          <div className="text-slate-500 space-y-2 text-sm text-left">
                            <p className="flex items-center gap-2"><span className="w-5 h-5 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center font-bold text-[10px]">1</span> Start the adventure</p>
                            <p className="flex items-center gap-2"><span className="w-5 h-5 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center font-bold text-[10px]">2</span> Show Wobble a toy</p>
                            <p className="flex items-center gap-2"><span className="w-5 h-5 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center font-bold text-[10px]">3</span> Tell Wobble your age</p>
                            <p className="flex items-center gap-2"><span className="w-5 h-5 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center font-bold text-[10px]">4</span> Play a math game!</p>
                          </div>
                        </div>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      {/* Hidden Canvas for Video Processing */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
