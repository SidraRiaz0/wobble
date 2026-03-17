import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';

interface MathGameProps {
  characterName: string;
  characterColors: string;
  difficulty: number;
  characterImageUrl: string | null;
  onGameOver: (score: number) => void;
}

export const MathGame: React.FC<MathGameProps> = ({
  characterName,
  characterColors,
  difficulty,
  characterImageUrl,
  onGameOver,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [equation, setEquation] = useState({ text: '', answer: 0, options: [0, 0] });
  const [gameState, setGameState] = useState<'playing' | 'celebrating' | 'bouncing'>('playing');

  const generateEquation = () => {
    const max = difficulty * 5;
    const a = Math.floor(Math.random() * max) + 1;
    const b = Math.floor(Math.random() * max) + 1;
    const isAdd = Math.random() > 0.5;
    const text = isAdd ? `${a} + ${b}` : `${Math.max(a, b)} - ${Math.min(a, b)}`;
    const answer = isAdd ? a + b : Math.max(a, b) - Math.min(a, b);
    
    let wrong = answer + (Math.random() > 0.5 ? 1 : -1) * (Math.floor(Math.random() * 3) + 1);
    if (wrong < 0) wrong = answer + 2;
    
    const options = [answer, wrong].sort(() => Math.random() - 0.5);
    setEquation({ text, answer, options });
  };

  useEffect(() => {
    generateEquation();
  }, [difficulty]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrame: number;
    let charX = canvas.width / 2;
    let charY = canvas.height - 100;
    let bounceOffset = 0;
    let frameCount = 0;

    const charImg = new Image();
    if (characterImageUrl) {
      charImg.src = characterImageUrl;
      charImg.referrerPolicy = "no-referrer";
    }

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Background
      ctx.fillStyle = '#f0f9ff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Platforms
      const platformY = canvas.height - 150;
      const platformWidth = 150;
      
      // Left Platform
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(50, platformY, platformWidth, 20);
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(equation.options[0].toString(), 50 + platformWidth / 2, platformY + 50);

      // Right Platform
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(canvas.width - 50 - platformWidth, platformY, platformWidth, 20);
      ctx.fillStyle = '#1e293b';
      ctx.fillText(equation.options[1].toString(), canvas.width - 50 - platformWidth / 2, platformY + 50);

      // Equation
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText(equation.text, canvas.width / 2, 100);

      // Character
      frameCount++;
      if (gameState === 'playing') {
        bounceOffset = Math.sin(frameCount * 0.1) * 5;
      } else if (gameState === 'celebrating') {
        bounceOffset = Math.sin(frameCount * 0.3) * 20;
      } else if (gameState === 'bouncing') {
        bounceOffset = Math.abs(Math.sin(frameCount * 0.2)) * -30;
      }

      const drawY = charY + bounceOffset;
      if (characterImageUrl && charImg.complete) {
        ctx.drawImage(charImg, charX - 40, drawY - 80, 80, 80);
      } else {
        ctx.fillStyle = characterColors || '#fbbf24';
        ctx.beginPath();
        ctx.arc(charX, drawY - 40, 40, 0, Math.PI * 2);
        ctx.fill();
      }

      // Name tag
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.font = '12px sans-serif';
      ctx.fillText(characterName, charX, drawY + 10);

      animationFrame = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationFrame);
  }, [equation, gameState, characterImageUrl, characterName, characterColors]);

  const handleChoice = (index: number) => {
    if (gameState !== 'playing') return;

    if (equation.options[index] === equation.answer) {
      setGameState('celebrating');
      setScore(s => s + 1);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
      setTimeout(() => {
        setGameState('playing');
        generateEquation();
      }, 1500);
    } else {
      setGameState('bouncing');
      setTimeout(() => {
        setGameState('playing');
      }, 1000);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6 p-8 bg-white rounded-3xl shadow-xl border border-black/5">
      <div className="flex justify-between w-full items-center">
        <h2 className="text-2xl font-bold text-slate-800">Wobble Math: {characterName}</h2>
        <div className="text-xl font-mono bg-emerald-100 text-emerald-800 px-4 py-1 rounded-full">
          Score: {score}
        </div>
      </div>
      
      <canvas 
        ref={canvasRef} 
        width={600} 
        height={400} 
        className="rounded-2xl border-4 border-slate-200 shadow-inner cursor-pointer"
      />

      <div className="flex gap-8">
        <button 
          onClick={() => handleChoice(0)}
          className="px-12 py-4 bg-slate-800 text-white rounded-2xl font-bold hover:bg-slate-700 transition-all active:scale-95"
        >
          {equation.options[0]}
        </button>
        <button 
          onClick={() => handleChoice(1)}
          className="px-12 py-4 bg-slate-800 text-white rounded-2xl font-bold hover:bg-slate-700 transition-all active:scale-95"
        >
          {equation.options[1]}
        </button>
      </div>

      <button 
        onClick={() => onGameOver(score)}
        className="mt-4 text-slate-400 hover:text-slate-600 underline text-sm"
      >
        Finish Game
      </button>
    </div>
  );
};
