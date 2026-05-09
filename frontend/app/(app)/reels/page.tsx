'use client'

import React, { useState, useRef } from 'react'
import {
  Film, Sparkles, AlertCircle, Loader2,
  ChevronRight, Wand2, ImagePlus, X, Info,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  buildStoryboard, refreshClips, generateSceneImages, editClip, generateHooks,
  type PublicClip, type ReferenceImageInput,
  type ReelsAspectRatio, type ReelsResolution, type ReelsClipDuration, type ReelsVoType, type ReelsVisualStyle,
  type ReelsProjectType, type ReelsOutputLanguage,
} from '@/lib/api'
import { pushStoredSession } from '@/lib/reels-sessions'
import { StoryboardClipCard } from '@/components/reels/StoryboardClipCard'

// Max reference images — matches backend MAX_REFERENCE_IMAGES constant (GeminiGen supports up to 6)
const MAX_REF_IMAGES = 6

// ─── constants ───────────────────────────────────────────────────────────────

const CLIP_DURATION_OPTIONS: { value: ReelsClipDuration; label: string }[] = [
  { value: 6,  label: '6s (Snappy)' },
  { value: 10, label: '10s (Standard)' },
  { value: 15, label: '15s (Extended)' },
]

function getDurationOptions(clipDur: number) {
  // Show multiples of clipDuration up to 120s
  const vals: number[] = []
  for (let v = clipDur; v <= 120; v += clipDur) vals.push(v)
  return vals.map(v => ({
    value: v,
    label: `${v}s (${v / clipDur} clip${v / clipDur > 1 ? 's' : ''})`,
  }))
}

const ASPECT_RATIO_OPTIONS: { value: ReelsAspectRatio; label: string; icon: string }[] = [
  { value: 'portrait',   label: 'Portrait 9:16',    icon: '▌' },
  { value: 'landscape',  label: 'Landscape 16:9',   icon: '▬' },
  { value: 'square',     label: 'Square 1:1',       icon: '■' },
  { value: 'vertical',   label: 'Vertical 2:3',     icon: '▍' },
  { value: 'horizontal', label: 'Horizontal 3:2',   icon: '▬' },
]

const RESOLUTION_OPTIONS: { value: ReelsResolution; label: string }[] = [
  { value: '480p', label: '480p (Fast)' },
  { value: '720p', label: '720p (HD)' },
]

const MODE_OPTIONS = [
  { value: 'normal', label: 'Normal', desc: 'Cinematic, clean, premium' },
  { value: 'extremely-crazy', label: 'Extremely Crazy', desc: 'Wild camera moves, surreal elements' },
  { value: 'extremely-spicy-or-crazy', label: 'Extremely Spicy or Crazy', desc: 'Maximum chaos, bold creativity' },
  { value: 'custom', label: 'Custom', desc: 'Balanced creative freedom' },
]

const VO_TYPE_OPTIONS: { value: ReelsVoType; label: string; desc: string; icon: string; gradient: string }[] = [
  { value: 'narration', label: 'CTA Narration',      desc: '5 benefit sentences → Call to Action',       icon: '📢', gradient: 'from-blue-500 to-indigo-600' },
  { value: 'dialogue',  label: 'Character Dialogue', desc: 'Character speaks with accent & personality', icon: '🎭', gradient: 'from-rose-500 to-pink-600' },
  { value: 'asmr',      label: 'ASMR / Sound-Only',  desc: 'No voice — pure textural sound design',      icon: '🎧', gradient: 'from-teal-500 to-emerald-600' },
  { value: 'demo',      label: 'Tutorial / Demo',    desc: 'Step-by-step instructional narration',       icon: '📚', gradient: 'from-amber-500 to-orange-600' },
  { value: 'story',     label: 'Emotional Story',    desc: 'Narrative arc — connect, then convert',      icon: '✨', gradient: 'from-violet-500 to-purple-600' },
]

// Per-style visual preview rendered as layered SVG/CSS art inside the card thumbnail
const STYLE_PREVIEW: Record<string, React.ReactNode> = {
  premium_3d: (
    <div className="w-full h-full relative overflow-hidden" style={{background:'linear-gradient(135deg,#7c3aed 0%,#db2777 50%,#f97316 100%)'}}>
      <div className="absolute inset-0" style={{background:'radial-gradient(ellipse at 35% 40%, rgba(255,255,255,0.35) 0%, transparent 60%)'}} />
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 80" preserveAspectRatio="xMidYMid slice">
        <ellipse cx="100" cy="38" rx="38" ry="22" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"/>
        <ellipse cx="100" cy="38" rx="24" ry="14" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.5)" strokeWidth="1"/>
        <line x1="62" y1="38" x2="138" y2="38" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8"/>
        <ellipse cx="100" cy="20" rx="28" ry="6" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8"/>
        <circle cx="100" cy="38" r="6" fill="rgba(255,255,255,0.6)"/>
        <circle cx="86" cy="32" r="3" fill="rgba(255,255,255,0.8)"/>
      </svg>
      <div className="absolute bottom-1.5 right-1.5 text-[9px] font-bold text-white/80 tracking-widest uppercase">3D</div>
    </div>
  ),
  realistic: (
    <div className="w-full h-full relative overflow-hidden" style={{background:'linear-gradient(160deg,#1c1c1c 0%,#3a3a3a 40%,#5a5a5a 100%)'}}>
      <div className="absolute inset-0" style={{background:'radial-gradient(ellipse at 70% 30%, rgba(255,200,100,0.18) 0%, transparent 55%)'}} />
      <svg className="absolute inset-0 w-full h-full opacity-30" viewBox="0 0 200 80">
        <line x1="0" y1="12" x2="200" y2="12" stroke="white" strokeWidth="0.5"/>
        <line x1="0" y1="68" x2="200" y2="68" stroke="white" strokeWidth="0.5"/>
        <rect x="60" y="22" width="80" height="36" fill="none" stroke="rgba(255,200,100,0.6)" strokeWidth="0.8"/>
        <line x1="100" y1="22" x2="100" y2="58" stroke="rgba(255,200,100,0.3)" strokeWidth="0.5"/>
        <line x1="60" y1="40" x2="140" y2="40" stroke="rgba(255,200,100,0.3)" strokeWidth="0.5"/>
      </svg>
      <div className="absolute bottom-1.5 right-1.5 text-[8px] font-bold text-amber-300/80 tracking-widest uppercase">RED</div>
    </div>
  ),
  anime: (
    <div className="w-full h-full relative overflow-hidden" style={{background:'linear-gradient(135deg,#f97316 0%,#ef4444 55%,#ec4899 100%)'}}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 80" preserveAspectRatio="xMidYMid slice">
        {/* Sky */}
        <rect x="0" y="0" width="200" height="45" fill="rgba(255,160,80,0.4)"/>
        {/* Ground */}
        <rect x="0" y="55" width="200" height="25" fill="rgba(200,50,50,0.5)"/>
        {/* Torii silhouette */}
        <rect x="82" y="18" width="36" height="3" fill="rgba(30,10,10,0.85)" rx="1"/>
        <rect x="88" y="21" width="24" height="2.5" fill="rgba(30,10,10,0.7)" rx="1"/>
        <rect x="88" y="20" width="3" height="35" fill="rgba(30,10,10,0.85)"/>
        <rect x="109" y="20" width="3" height="35" fill="rgba(30,10,10,0.85)"/>
        {/* Sun */}
        <circle cx="100" cy="42" r="10" fill="rgba(255,230,100,0.9)"/>
        {/* Speed lines */}
        <line x1="0" y1="5" x2="75" y2="38" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8"/>
        <line x1="200" y1="5" x2="125" y2="38" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8"/>
      </svg>
      <div className="absolute top-1 right-1.5 text-[8px] font-black text-white/90 tracking-widest">JP</div>
    </div>
  ),
  cinematic: (
    <div className="w-full h-full relative overflow-hidden" style={{background:'linear-gradient(170deg,#92400e 0%,#b45309 40%,#d97706 100%)'}}>
      {/* Letterbox bars */}
      <div className="absolute top-0 left-0 right-0 h-[14%] bg-black/70 z-10"/>
      <div className="absolute bottom-0 left-0 right-0 h-[14%] bg-black/70 z-10"/>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 80" preserveAspectRatio="xMidYMid slice">
        <rect x="0" y="0" width="200" height="80" fill="rgba(180,100,20,0.3)"/>
        {/* Anamorphic lens flare */}
        <line x1="0" y1="40" x2="200" y2="40" stroke="rgba(255,220,100,0.4)" strokeWidth="1.5"/>
        <ellipse cx="130" cy="40" rx="18" ry="4" fill="rgba(255,240,180,0.25)"/>
        <circle cx="130" cy="40" r="3" fill="rgba(255,255,200,0.7)"/>
        {/* Horizon silhouette */}
        <path d="M0 55 Q50 48 100 52 Q150 56 200 50 L200 80 L0 80Z" fill="rgba(0,0,0,0.5)"/>
      </svg>
      <div className="absolute bottom-[16%] right-1.5 z-20 text-[8px] font-bold text-amber-200/70 tracking-widest uppercase">4K</div>
    </div>
  ),
  cartoon: (
    <div className="w-full h-full relative overflow-hidden" style={{background:'linear-gradient(135deg,#38bdf8 0%,#3b82f6 50%,#6366f1 100%)'}}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 80" preserveAspectRatio="xMidYMid slice">
        {/* Clouds */}
        <ellipse cx="40" cy="22" rx="22" ry="12" fill="rgba(255,255,255,0.9)"/>
        <ellipse cx="55" cy="18" rx="16" ry="10" fill="rgba(255,255,255,0.9)"/>
        <ellipse cx="28" cy="24" rx="14" ry="9" fill="rgba(255,255,255,0.9)"/>
        <ellipse cx="155" cy="25" rx="18" ry="10" fill="rgba(255,255,255,0.85)"/>
        <ellipse cx="168" cy="22" rx="14" ry="9" fill="rgba(255,255,255,0.85)"/>
        {/* Ground */}
        <rect x="0" y="58" width="200" height="22" fill="rgba(74,222,128,0.8)" rx="0"/>
        {/* Pixar star character hint */}
        <circle cx="100" cy="50" r="14" fill="rgba(255,220,80,0.95)" stroke="rgba(30,30,30,0.6)" strokeWidth="1.5"/>
        <circle cx="95" cy="47" r="2.5" fill="rgba(30,30,30,0.8)"/>
        <circle cx="105" cy="47" r="2.5" fill="rgba(30,30,30,0.8)"/>
        <path d="M93 54 Q100 59 107 54" fill="none" stroke="rgba(30,30,30,0.8)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </div>
  ),
  ghibli: (
    <div className="w-full h-full relative overflow-hidden" style={{background:'linear-gradient(160deg,#86efac 0%,#34d399 45%,#059669 100%)'}}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 80" preserveAspectRatio="xMidYMid slice">
        {/* Sky */}
        <rect x="0" y="0" width="200" height="45" fill="rgba(186,230,253,0.6)"/>
        {/* Rolling hills */}
        <path d="M0 60 Q30 40 60 55 Q90 68 120 50 Q150 35 180 52 Q195 58 200 55 L200 80 L0 80Z" fill="rgba(52,211,153,0.8)"/>
        <path d="M0 65 Q50 55 100 62 Q150 68 200 60 L200 80 L0 80Z" fill="rgba(4,120,87,0.7)"/>
        {/* Totoro-like tree */}
        <rect x="96" y="30" width="8" height="30" fill="rgba(92,64,30,0.7)" rx="2"/>
        <circle cx="100" cy="28" r="18" fill="rgba(21,128,61,0.7)"/>
        <circle cx="88" cy="35" r="12" fill="rgba(22,163,74,0.65)"/>
        <circle cx="112" cy="33" r="13" fill="rgba(20,150,60,0.65)"/>
        {/* Fluffy cloud */}
        <ellipse cx="40" cy="20" rx="20" ry="11" fill="rgba(255,255,255,0.75)"/>
        <ellipse cx="52" cy="16" rx="14" ry="9" fill="rgba(255,255,255,0.75)"/>
        <ellipse cx="30" cy="22" rx="12" ry="8" fill="rgba(255,255,255,0.75)"/>
      </svg>
    </div>
  ),
  makoto_shinkai: (
    <div className="w-full h-full relative overflow-hidden" style={{background:'linear-gradient(180deg,#1e1b4b 0%,#312e81 40%,#1d4ed8 75%,#0e7490 100%)'}}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 80" preserveAspectRatio="xMidYMid slice">
        {/* Stars */}
        {[[20,8],[45,5],[70,12],[95,4],[130,9],[160,6],[185,11],[35,18],[155,15]].map(([x,y],i) => (
          <circle key={i} cx={x} cy={y} r="0.8" fill="white" opacity="0.8"/>
        ))}
        {/* City skyline */}
        <rect x="10"  y="42" width="12" height="38" fill="rgba(20,20,60,0.9)"/>
        <rect x="28"  y="35" width="16" height="45" fill="rgba(15,15,50,0.9)"/>
        <rect x="50"  y="48" width="10" height="32" fill="rgba(20,20,60,0.9)"/>
        <rect x="66"  y="30" width="20" height="50" fill="rgba(10,10,40,0.95)"/>
        <rect x="92"  y="38" width="14" height="42" fill="rgba(18,18,55,0.9)"/>
        <rect x="112" y="25" width="22" height="55" fill="rgba(10,10,40,0.95)"/>
        <rect x="140" y="40" width="12" height="40" fill="rgba(20,20,60,0.9)"/>
        <rect x="158" y="32" width="18" height="48" fill="rgba(15,15,50,0.9)"/>
        <rect x="182" y="44" width="18" height="36" fill="rgba(20,20,60,0.9)"/>
        {/* Building windows */}
        {[[70,33],[78,33],[70,40],[78,40],[114,28],[122,28],[114,35],[122,35],[114,42],[122,42]].map(([x,y],i) => (
          <rect key={i} x={x} y={y} width="4" height="3" fill="rgba(255,220,120,0.7)" rx="0.5"/>
        ))}
        {/* Lens flare */}
        <line x1="0" y1="28" x2="200" y2="28" stroke="rgba(100,180,255,0.15)" strokeWidth="2"/>
        <circle cx="160" cy="28" r="5" fill="rgba(150,200,255,0.2)"/>
        {/* Reflection in water */}
        <rect x="0" y="68" width="200" height="12" fill="rgba(30,60,120,0.5)"/>
        <line x1="0" y1="68" x2="200" y2="68" stroke="rgba(100,180,255,0.3)" strokeWidth="0.8"/>
      </svg>
    </div>
  ),
  chibi: (
    <div className="w-full h-full relative overflow-hidden" style={{background:'linear-gradient(135deg,#fbcfe8 0%,#f9a8d4 50%,#e879f9 100%)'}}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 80" preserveAspectRatio="xMidYMid slice">
        {/* Pastel hearts & stars scattered */}
        <circle cx="25"  cy="15" r="8"  fill="rgba(255,255,255,0.5)"/>
        <circle cx="175" cy="20" r="6"  fill="rgba(255,255,255,0.45)"/>
        <circle cx="150" cy="60" r="10" fill="rgba(255,255,255,0.4)"/>
        <circle cx="40"  cy="62" r="7"  fill="rgba(255,255,255,0.4)"/>
        {/* Chibi face */}
        <circle cx="100" cy="38" r="22" fill="rgba(255,220,210,0.95)" stroke="rgba(240,100,150,0.4)" strokeWidth="1"/>
        {/* Eyes — big chibi style */}
        <ellipse cx="91" cy="36" rx="5"  ry="6.5" fill="rgba(80,40,120,0.9)"/>
        <ellipse cx="109" cy="36" rx="5" ry="6.5" fill="rgba(80,40,120,0.9)"/>
        <circle cx="93" cy="34" r="2" fill="white"/>
        <circle cx="111" cy="34" r="2" fill="white"/>
        {/* Blush */}
        <ellipse cx="83"  cy="44" rx="6" ry="3" fill="rgba(255,100,130,0.35)"/>
        <ellipse cx="117" cy="44" rx="6" ry="3" fill="rgba(255,100,130,0.35)"/>
        {/* Smile */}
        <path d="M93 47 Q100 53 107 47" fill="none" stroke="rgba(200,80,120,0.8)" strokeWidth="1.5" strokeLinecap="round"/>
        {/* Hair */}
        <path d="M78 30 Q82 12 100 16 Q118 12 122 30" fill="rgba(255,180,80,0.9)" stroke="none"/>
        {/* Star sparkles */}
        <text x="28"  y="45" fontSize="8" fill="rgba(255,180,220,0.9)">✦</text>
        <text x="163" y="42" fontSize="8" fill="rgba(255,180,220,0.9)">✦</text>
        <text x="55"  y="20" fontSize="6" fill="rgba(255,200,230,0.8)">♡</text>
        <text x="140" y="18" fontSize="6" fill="rgba(255,200,230,0.8)">♡</text>
      </svg>
    </div>
  ),
  pixel_art: (
    <div className="w-full h-full relative overflow-hidden" style={{background:'#0f0a2e'}}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 80" preserveAspectRatio="xMidYMid slice" shapeRendering="crispEdges">
        {/* Pixel grid sky */}
        <rect x="0"   y="0"  width="200" height="45" fill="#1a0a3e"/>
        {/* Pixel moon */}
        {[[90,6],[96,6],[102,6],[108,6],[84,12],[114,12],[84,18],[114,18],[84,24],[114,24],[90,30],[96,30],[102,30],[108,30]].map(([x,y],i) => (
          <rect key={i} x={x} y={y} width="6" height="6" fill="#ffffaa"/>
        ))}
        {/* Stars pixel */}
        {[[20,8],[50,4],[140,10],[170,5],[30,22],[160,20]].map(([x,y],i) => (
          <rect key={i} x={x} y={y} width="3" height="3" fill="white" opacity="0.9"/>
        ))}
        {/* Ground */}
        <rect x="0"   y="45" width="200" height="6"  fill="#2d5a1b"/>
        <rect x="0"   y="51" width="200" height="29" fill="#1a3a0a"/>
        {/* Pixel trees */}
        <rect x="16"  y="31" width="6"  height="14" fill="#5a3010"/>
        <rect x="10"  y="21" width="18" height="10" fill="#2d6e1b"/>
        <rect x="7"   y="15" width="24" height="6"  fill="#38891c"/>
        <rect x="168" y="28" width="6"  height="17" fill="#5a3010"/>
        <rect x="162" y="18" width="18" height="10" fill="#2d6e1b"/>
        <rect x="159" y="12" width="24" height="6"  fill="#38891c"/>
        {/* Pixel character */}
        <rect x="95"  y="33" width="10" height="10" fill="#f4c06e"/>
        <rect x="93"  y="43" width="14" height="2"  fill="#1a88d4"/>
        <rect x="93"  y="45" width="14" height="8"  fill="#1a88d4"/>
        <rect x="91"  y="47" width="2"  height="6"  fill="#1a88d4"/>
        <rect x="107" y="47" width="2"  height="6"  fill="#1a88d4"/>
        <rect x="93"  y="53" width="4"  height="4"  fill="#5a3010"/>
        <rect x="103" y="53" width="4"  height="4"  fill="#5a3010"/>
      </svg>
    </div>
  ),
  chinese_cg: (
    <div className="w-full h-full relative overflow-hidden" style={{background:'linear-gradient(160deg,#7f1d1d 0%,#b91c1c 40%,#ea580c 100%)'}}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 80" preserveAspectRatio="xMidYMid slice">
        {/* Gold trim lines */}
        <rect x="0" y="0" width="200" height="2" fill="rgba(255,215,0,0.6)"/>
        <rect x="0" y="78" width="200" height="2" fill="rgba(255,215,0,0.6)"/>
        {/* Mountain silhouettes wuxia */}
        <path d="M0 80 L0 55 L20 35 L40 50 L60 25 L80 42 L100 15 L120 42 L140 25 L160 50 L180 35 L200 45 L200 80Z" fill="rgba(80,0,0,0.6)"/>
        <path d="M0 80 L0 62 L30 48 L50 58 L70 42 L90 55 L110 35 L130 55 L150 42 L170 58 L190 50 L200 56 L200 80Z" fill="rgba(50,0,0,0.7)"/>
        {/* Dragon silhouette simplified */}
        <path d="M30 38 Q50 28 70 32 Q90 36 85 26 Q95 20 105 26 Q115 32 110 22 Q125 18 130 28 Q120 36 108 32 Q100 38 92 32 Q85 42 75 36 Q60 42 45 38Z"
              fill="rgba(255,215,0,0.7)"/>
        {/* Lanterns */}
        <ellipse cx="160" cy="22" rx="7" ry="10" fill="rgba(255,180,0,0.85)" stroke="rgba(255,215,0,0.6)" strokeWidth="0.8"/>
        <rect x="159" y="12" width="2" height="4" fill="rgba(255,215,0,0.7)"/>
        <rect x="156" y="30" width="8" height="3" fill="rgba(255,200,0,0.7)" rx="1"/>
        <ellipse cx="170" cy="35" rx="5" ry="7" fill="rgba(255,150,0,0.8)" stroke="rgba(255,215,0,0.5)" strokeWidth="0.7"/>
        <rect x="169" y="28" width="2" height="3" fill="rgba(255,215,0,0.7)"/>
        {/* Gold sparkles */}
        <circle cx="140" cy="12" r="1.5" fill="rgba(255,215,0,0.9)"/>
        <circle cx="50"  cy="20" r="1.5" fill="rgba(255,215,0,0.9)"/>
        <circle cx="15"  cy="30" r="1"   fill="rgba(255,215,0,0.7)"/>
      </svg>
      <div className="absolute bottom-1.5 left-1.5 text-[9px] font-bold text-yellow-300/80 tracking-widest">武侠</div>
    </div>
  ),
}

const VISUAL_STYLE_OPTIONS: { value: ReelsVisualStyle; label: string; desc: string; icon: string; hot?: boolean; gradient: string }[] = [
  { value: 'premium_3d',     label: '3D Premium',    desc: 'Glossy 3D semi-cartoon, volumetric light', icon: '💎', gradient: 'from-purple-600 via-pink-500 to-orange-400' },
  { value: 'realistic',      label: 'Realistic',     desc: 'Live-action cinematic, RED camera look',   icon: '🎬', gradient: 'from-slate-700 via-gray-600 to-zinc-500' },
  { value: 'anime',          label: 'Anime JP/KR',   desc: 'Japanese anime, vibrant saturated colors', icon: '⛩️', gradient: 'from-orange-400 via-red-500 to-pink-500', hot: true },
  { value: 'cinematic',      label: 'Cinematic',     desc: 'Anamorphic lens, golden hour grade',       icon: '🎞️', gradient: 'from-amber-700 via-yellow-600 to-orange-500' },
  { value: 'cartoon',        label: 'Pixar 3D',      desc: 'Pixar-style 3D, bright rounded shapes',   icon: '🎨', gradient: 'from-sky-400 via-blue-500 to-indigo-500' },
  { value: 'ghibli',         label: 'Ghibli',        desc: 'Watercolor backgrounds, Ghibli magic',    icon: '🌿', gradient: 'from-emerald-400 via-teal-500 to-green-600' },
  { value: 'makoto_shinkai', label: 'Shinkai Film',  desc: 'Hyperdetailed cityscape, lens flare',      icon: '🌆', gradient: 'from-blue-900 via-indigo-700 to-cyan-500' },
  { value: 'chibi',          label: 'Chibi Cute',    desc: 'Super-deformed kawaii, pastel colors',     icon: '🌸', gradient: 'from-pink-300 via-rose-400 to-fuchsia-400' },
  { value: 'pixel_art',      label: 'Pixel Art',     desc: 'Retro 16-bit aesthetic, chunky sprites',   icon: '👾', gradient: 'from-violet-900 via-purple-700 to-indigo-600' },
  { value: 'chinese_cg',     label: 'Donghua 3D',    desc: 'Chinese 3D animation, wuxia aesthetic',   icon: '🐉', gradient: 'from-red-600 via-orange-500 to-yellow-500' },
]

const PROJECT_TYPE_OPTIONS: { value: ReelsProjectType; label: string; desc: string; icon: string; gradient: string }[] = [
  { value: 'product_promo', label: 'Product Promo',    desc: 'Commercial ad — product always center stage, ends with CTA', icon: '📦', gradient: 'from-blue-500 to-cyan-500' },
  { value: 'story',         label: 'Story Video',      desc: 'Narrative film — emotional arc, product appears naturally',   icon: '🎭', gradient: 'from-violet-500 to-purple-600' },
  { value: 'digital_human', label: 'Digital Human',    desc: 'AI presenter talks to camera, showcases product',             icon: '🤖', gradient: 'from-emerald-500 to-teal-600' },
  { value: 'default',       label: 'General',          desc: 'Balanced creative — good for any brief',                     icon: '✨', gradient: 'from-orange-400 to-pink-500' },
]

const OUTPUT_LANGUAGE_OPTIONS: { value: ReelsOutputLanguage; label: string; flag: string }[] = [
  { value: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
  { value: 'en', label: 'English',          flag: '🇬🇧' },
  { value: 'th', label: 'Thai',             flag: '🇹🇭' },
  { value: 'vi', label: 'Vietnamese',       flag: '🇻🇳' },
  { value: 'zh', label: 'Mandarin',         flag: '🇨🇳' },
  { value: 'ko', label: 'Korean',           flag: '🇰🇷' },
  { value: 'ja', label: 'Japanese',         flag: '🇯🇵' },
  { value: 'hi', label: 'Hindi',            flag: '🇮🇳' },
  { value: 'es', label: 'Spanish',          flag: '🇪🇸' },
  { value: 'pt', label: 'Portuguese',       flag: '🇵🇹' },
  { value: 'ar', label: 'Arabic',           flag: '🇸🇦' },
]

// ─── types ───────────────────────────────────────────────────────────────────

type Step = 'input' | 'storyboard'

type RefImage = {
  id: string
  label: string
  dataUrl: string
  preview: string   // same as dataUrl for img src
  sizeKB: number
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ─── root component ───────────────────────────────────────────────────────────

export default function ReelsPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('input')

  // input
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(30)
  const [mode, setMode] = useState('normal')
  const [aspectRatio, setAspectRatio] = useState<ReelsAspectRatio>('portrait')
  const [resolution, setResolution] = useState<ReelsResolution>('720p')
  const [clipDuration, setClipDuration] = useState<ReelsClipDuration>(10)
  const [voType, setVoType] = useState<ReelsVoType>('narration')
  const [visualStyle, setVisualStyle] = useState<ReelsVisualStyle>('premium_3d')
  const [projectType, setProjectType] = useState<ReelsProjectType>('product_promo')
  const [outputLanguage, setOutputLanguage] = useState<ReelsOutputLanguage>('id')
  // Script mode: paste existing ad script instead of free-form brief
  const [scriptMode, setScriptMode] = useState(false)
  const [scriptText, setScriptText] = useState('')
  const [building, setBuilding] = useState(false)
  // Hook generator
  const [hookPanelOpen, setHookPanelOpen] = useState(false)
  const [hooksLoading, setHooksLoading] = useState(false)
  const [generatedHooks, setGeneratedHooks] = useState<Array<{ type: string; label: string; voScript: string; opening: string; angle: string }>>([])
  const [selectedHookIdx, setSelectedHookIdx] = useState<number | null>(null)

  // reference images
  const [refImages, setRefImages] = useState<RefImage[]>([])
  const [refImageError, setRefImageError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // storyboard
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [storyboard, setStoryboard] = useState<PublicClip[]>([])
  const [sessionRefLabels, setSessionRefLabels] = useState<{ tag: string; label: string }[]>([])
  const [generatingScenes, setGeneratingScenes] = useState(false)
  const [refreshingFrom, setRefreshingFrom] = useState<number | null>(null)
  const [hints, setHints] = useState<Record<number, string>>({})

  // error
  const [error, setError] = useState<string | null>(null)

  // ── Reference image upload ────────────────────────────────────────────────

  async function handleRefImageFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setRefImageError(null)

    const remaining = MAX_REF_IMAGES - refImages.length
    if (remaining <= 0) {
      setRefImageError(`Maximum ${MAX_REF_IMAGES} reference images allowed`)
      return
    }

    const toProcess = Array.from(files).slice(0, remaining)
    const results: RefImage[] = []

    for (const file of toProcess) {
      // Validate type
      if (!file.type.startsWith('image/')) {
        setRefImageError(`"${file.name}" is not an image file`)
        return
      }
      // Validate size (5 MB)
      if (file.size > 5 * 1024 * 1024) {
        setRefImageError(`"${file.name}" exceeds 5 MB limit`)
        return
      }
      const dataUrl = await readFileAsDataUrl(file)
      results.push({
        id: `${Date.now()}-${Math.random()}`,
        label: file.name.replace(/\.[^.]+$/, '').slice(0, 30),
        dataUrl,
        preview: dataUrl,
        sizeKB: Math.round(file.size / 1024),
      })
    }

    setRefImages(prev => [...prev, ...results].slice(0, MAX_REF_IMAGES))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeRefImage(id: string) {
    setRefImages(prev => prev.filter(r => r.id !== id))
    setRefImageError(null)
  }

  // ── Step 1: build storyboard ───────────────────────────────────────────────

  async function handleBuildStoryboard() {
    if (!prompt.trim()) return
    setBuilding(true)
    setError(null)
    try {
      const referenceImages: ReferenceImageInput[] = refImages.map(r => ({
        label: r.label,
        dataUrl: r.dataUrl,
      }))
      const data = await buildStoryboard({ prompt: prompt.trim(), mode, duration, aspectRatio, resolution, clipDuration, voType, visualStyle, projectType, outputLanguage, scriptText: scriptMode && scriptText.trim() ? scriptText.trim() : null, referenceImages })
      setSessionId(data.sessionId)
      setStoryboard(data.storyboard)
      setSessionRefLabels(data.referenceImageUrls || [])
      setHints({})
      setStep('storyboard')

      // Auto-generate scene preview images right after storyboard text is ready
      handleGenerateSceneImages(data.sessionId, data.storyboard)
    } catch (err: any) {
      setError(err.message || 'Failed to build storyboard')
    } finally {
      setBuilding(false)
    }
  }

  // ── Scene image generation ─────────────────────────────────────────────────

  async function handleGenerateSceneImages(sid: string, currentStoryboard: PublicClip[], fromIndex?: number) {
    setGeneratingScenes(true)
    try {
      // Mark all clips from fromIndex as loading (sceneImageUrl = undefined-in-progress)
      const startIdx = fromIndex ?? 0
      setStoryboard(prev => prev.map((c, i) =>
        i >= startIdx ? { ...c, sceneImageUrl: null } : c
      ))

      const data = await generateSceneImages({ sessionId: sid, fromIndex })

      // Merge scene images into storyboard
      setStoryboard(prev => {
        const next = [...prev]
        data.sceneImages.forEach(({ clipNumber, sceneImageUrl }) => {
          const idx = next.findIndex(c => c.clipNumber === clipNumber)
          if (idx !== -1) next[idx] = { ...next[idx], sceneImageUrl: sceneImageUrl ?? null }
        })
        return next
      })
    } catch (err: any) {
      // Non-blocking — don't show error, just leave images as null
      console.warn('Scene image generation failed:', err.message)
    } finally {
      setGeneratingScenes(false)
    }
  }

  // ── Hook generator ────────────────────────────────────────────────────────

  async function handleGenerateHooks() {
    if (!sessionId && !prompt.trim()) return
    setHooksLoading(true)
    setGeneratedHooks([])
    setSelectedHookIdx(null)
    try {
      const data = await generateHooks({ sessionId: sessionId || undefined, brief: prompt.trim() || undefined })
      setGeneratedHooks(data.hooks)
      setHookPanelOpen(true)
    } catch (err: any) {
      setError(err.message || 'Failed to generate hooks')
    } finally {
      setHooksLoading(false)
    }
  }

  function applyHookToClip1(hookIdx: number) {
    const hook = generatedHooks[hookIdx]
    if (!hook || !storyboard.length) return
    setSelectedHookIdx(hookIdx)
    // Apply hook's voScript to clip 1
    if (sessionId) {
      handleEditClip(0, storyboard[0].visualSummary, hook.voScript)
    }
  }

  // ── Step 2: refresh clips ──────────────────────────────────────────────────

  async function handleRefresh(fromIndex: number) {
    if (!sessionId) return
    setRefreshingFrom(fromIndex)
    setError(null)
    try {
      const data = await refreshClips({
        sessionId,
        fromIndex,
        hint: hints[fromIndex] || undefined,
      })
      setStoryboard(data.storyboard)
      setHints(prev => {
        const next = { ...prev }
        data.storyboard.forEach((_, i) => { if (i >= fromIndex) delete next[i] })
        return next
      })
      setRefreshingFrom(null)

      // Regenerate scene images for refreshed clips
      handleGenerateSceneImages(sessionId, data.storyboard, fromIndex)
    } catch (err: any) {
      setError(err.message || 'Refresh failed')
      setRefreshingFrom(null)
    }
  }

  // ── Step 2b: inline edit clip ─────────────────────────────────────────────

  async function handleEditClip(idx: number, visualSummary: string, voScript: string) {
    if (!sessionId) return
    const updated = await editClip({ sessionId, clipIndex: idx, visualSummary, voScript })
    setStoryboard(prev => prev.map((c, i) =>
      i === idx ? { ...c, visualSummary: updated.visualSummary, voScript: updated.voScript } : c
    ))
  }

  // ── Step 2 → redirect to Results Reels ────────────────────────────────────

  function handleGenerate() {
    if (!sessionId) return
    // Save session metadata so Results Reels page can show it
    pushStoredSession({
      sessionId,
      prompt,
      mode,
      duration,
      totalClips: storyboard.length,
    })
    router.push('/results-reels')
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Film className="h-6 w-6 text-primary" />
          Create AI Reels
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Simple prompt → AI storyboard → Grok video generation → merged final reel
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator step={step} />

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">{error}</p>
          <button onClick={() => setError(null)} className="shrink-0 text-destructive/60 hover:text-destructive">✕</button>
        </div>
      )}

      {/* ── STEP 1: Input ─────────────────────────────────────────────────── */}
      {step === 'input' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Video Brief</CardTitle>
            <CardDescription>
              Describe your ad in plain language — AI will build the full storyboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Project Type selector — shown prominently at top */}
            <div className="space-y-1.5">
              <Label>Project Type</Label>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {PROJECT_TYPE_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    disabled={building}
                    onClick={() => setProjectType(o.value)}
                    className={`overflow-hidden flex flex-col items-start rounded-lg border text-left transition-all disabled:opacity-50 ${
                      projectType === o.value
                        ? 'border-primary ring-2 ring-primary/30'
                        : 'border-border/60 bg-background hover:border-primary/40'
                    }`}
                  >
                    {/* Gradient preview strip */}
                    <div className={`w-full h-12 bg-gradient-to-br ${o.gradient} flex items-center justify-between px-3`}>
                      <span className="text-2xl drop-shadow-sm">{o.icon}</span>
                      {projectType === o.value && (
                        <span className="rounded-full bg-white/90 w-5 h-5 flex items-center justify-center text-[10px] font-bold text-primary">✓</span>
                      )}
                    </div>
                    <div className="px-2.5 py-2">
                      <span className="text-xs font-semibold leading-tight block">{o.label}</span>
                      <span className="text-[10px] text-muted-foreground leading-tight mt-0.5 block">{o.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prompt">What's this reel about?</Label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Luxury skincare serum for women 25-35. Golden hour aesthetic. Show texture, application, glowing result. Premium brand feel."
                rows={4}
                disabled={building}
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>

            {/* Row 1: Mode + Clip Duration */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Generation Mode</Label>
                <Select value={mode} onValueChange={setMode} disabled={building}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODE_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>
                        <div>
                          <div className="font-medium">{o.label}</div>
                          <div className="text-xs text-muted-foreground">{o.desc}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Clip Length</Label>
                <Select
                  value={String(clipDuration)}
                  onValueChange={v => {
                    const cd = Number(v) as ReelsClipDuration
                    setClipDuration(cd)
                    // Reset duration to first valid multiple
                    setDuration(cd)
                  }}
                  disabled={building}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CLIP_DURATION_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 1b: VO / Audio Type */}
            <div className="space-y-1.5">
              <Label>Audio Style</Label>
              <p className="text-xs text-muted-foreground">What kind of audio experience does this video need?</p>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {VO_TYPE_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    disabled={building}
                    onClick={() => setVoType(o.value)}
                    className={`overflow-hidden flex flex-col items-start rounded-lg border text-left transition-all disabled:opacity-50 ${
                      voType === o.value
                        ? 'border-primary ring-2 ring-primary/30'
                        : 'border-border/60 bg-background hover:border-primary/40'
                    }`}
                  >
                    {/* Gradient preview strip */}
                    <div className={`w-full h-9 bg-gradient-to-r ${o.gradient} flex items-center justify-center`}>
                      <span className="text-lg drop-shadow-sm">{o.icon}</span>
                    </div>
                    <div className="px-2.5 py-2">
                      <span className="text-xs font-semibold leading-tight block">{o.label}</span>
                      <span className="text-[10px] text-muted-foreground leading-tight mt-0.5 block">{o.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Row 1c: Visual Style Presets */}
            <div className="space-y-1.5">
              <Label>Visual Style</Label>
              <p className="text-xs text-muted-foreground">Render style applied consistently across all clips.</p>
              <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-5">
                {VISUAL_STYLE_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    disabled={building}
                    onClick={() => setVisualStyle(o.value)}
                    className={`relative overflow-hidden flex flex-col items-start rounded-lg border text-left transition-all disabled:opacity-50 ${
                      visualStyle === o.value
                        ? 'border-primary ring-2 ring-primary/30'
                        : 'border-border/60 bg-background hover:border-primary/40'
                    }`}
                  >
                    {/* Style preview — CSS/SVG art per style */}
                    <div className="w-full h-16 relative overflow-hidden rounded-t-lg">
                      {STYLE_PREVIEW[o.value] ?? (
                        <div className={`w-full h-full bg-gradient-to-br ${o.gradient}`} />
                      )}
                      {/* Overlay badges */}
                      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 z-10">
                        <span className="text-base drop-shadow-lg leading-none">{o.icon}</span>
                      </div>
                      <div className="absolute top-1.5 right-1.5 flex items-center gap-1 z-10">
                        {o.hot && (
                          <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[8px] font-bold text-white leading-none shadow">HOT</span>
                        )}
                        {visualStyle === o.value && (
                          <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[8px] font-bold text-primary leading-none shadow">✓</span>
                        )}
                      </div>
                    </div>
                    <div className="px-2.5 py-2">
                      <span className="text-xs font-semibold leading-tight block">{o.label}</span>
                      <span className="text-[10px] text-muted-foreground leading-tight mt-0.5 block">{o.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Output Language */}
            <div className="space-y-1.5">
              <Label>Output Language</Label>
              <p className="text-xs text-muted-foreground">Language for all voiceover scripts and on-screen text.</p>
              <Select value={outputLanguage} onValueChange={v => setOutputLanguage(v as ReelsOutputLanguage)} disabled={building}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTPUT_LANGUAGE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="mr-2">{o.flag}</span>{o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Script Mode toggle */}
            <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Use Existing Script</p>
                  <p className="text-xs text-muted-foreground">Paste your ad script — AI breaks it into clips instead of writing from scratch.</p>
                </div>
                <button
                  type="button"
                  disabled={building}
                  onClick={() => setScriptMode(p => !p)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none disabled:opacity-50 ${
                    scriptMode ? 'bg-primary' : 'bg-input'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${scriptMode ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
              {scriptMode && (
                <textarea
                  value={scriptText}
                  onChange={e => setScriptText(e.target.value)}
                  placeholder="Paste your full ad script here — dialogue, narration, or bullet points. AI will distribute it across clips and build matching visuals."
                  rows={5}
                  disabled={building}
                  className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              )}
            </div>

            {/* Row 2: Aspect Ratio + Resolution + Total Duration */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Aspect Ratio</Label>
                <Select value={aspectRatio} onValueChange={v => setAspectRatio(v as ReelsAspectRatio)} disabled={building}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIO_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>
                        <span className="font-mono mr-1.5">{o.icon}</span>{o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Resolution</Label>
                <Select value={resolution} onValueChange={v => setResolution(v as ReelsResolution)} disabled={building}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RESOLUTION_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Total Duration</Label>
                <Select value={String(duration)} onValueChange={v => setDuration(Number(v))} disabled={building}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {getDurationOptions(clipDuration).map(o => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ── Reference Images ─────────────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Reference Images</Label>
                <span className="text-xs text-muted-foreground">
                  optional · max {MAX_REF_IMAGES} · 5 MB each
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Upload character designs, product photos, or style references.
                AI uses <span className="font-mono text-foreground/70">@image1</span>…<span className="font-mono text-foreground/70">@image{MAX_REF_IMAGES}</span> tags in each clip's prompt to maintain visual consistency across all scenes.
              </p>

              {/* Uploaded images grid */}
              {refImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {refImages.map((img, i) => (
                    <div key={img.id} className="relative group w-24">
                      <div className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/30">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.preview} alt={img.label} className="h-20 w-24 object-cover" />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5">
                          <p className="text-[9px] text-white font-mono font-semibold">@image{i + 1}</p>
                        </div>
                        <button
                          onClick={() => removeRefImage(img.id)}
                          className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <input
                        value={img.label}
                        onChange={e => setRefImages(prev =>
                          prev.map(r => r.id === img.id ? { ...r, label: e.target.value } : r)
                        )}
                        className="mt-1 w-full rounded border bg-background px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder={`Label @image${i + 1}`}
                        maxLength={30}
                      />
                      <p className="text-[10px] text-muted-foreground text-right">{img.sizeKB}KB</p>
                    </div>
                  ))}
                </div>
              )}

              {refImages.length < MAX_REF_IMAGES && (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => handleRefImageFiles(e.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={building}
                    className="flex items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-2 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    <ImagePlus className="h-4 w-4" />
                    Add reference image ({refImages.length}/{MAX_REF_IMAGES})
                  </button>
                </div>
              )}

              {refImageError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />{refImageError}
                </p>
              )}
            </div>

            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {PROJECT_TYPE_OPTIONS.find(p => p.value === projectType)?.icon}{' '}
              {PROJECT_TYPE_OPTIONS.find(p => p.value === projectType)?.label}
              {' · '}{Math.ceil(duration / clipDuration)} clip{Math.ceil(duration / clipDuration) > 1 ? 's' : ''} × {clipDuration}s
              {' · '}{resolution} {ASPECT_RATIO_OPTIONS.find(a => a.value === aspectRatio)?.label || aspectRatio}
              {' · '}{VO_TYPE_OPTIONS.find(v => v.value === voType)?.icon} {VO_TYPE_OPTIONS.find(v => v.value === voType)?.label}
              {' · '}{VISUAL_STYLE_OPTIONS.find(s => s.value === visualStyle)?.icon} {VISUAL_STYLE_OPTIONS.find(s => s.value === visualStyle)?.label}
              {' · '}{OUTPUT_LANGUAGE_OPTIONS.find(l => l.value === outputLanguage)?.flag} {OUTPUT_LANGUAGE_OPTIONS.find(l => l.value === outputLanguage)?.label}
              {' · '}Mode: {mode}
              {scriptMode && scriptText.trim() && ' · 📝 From script'}
              {refImages.length > 0 && ` · ${refImages.length} ref img${refImages.length > 1 ? 's' : ''}`}
            </div>

            <Button
              onClick={handleBuildStoryboard}
              disabled={building || !prompt.trim()}
              className="w-full"
              size="lg"
            >
              {building ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Building storyboard…</>
              ) : (
                <><Wand2 className="mr-2 h-4 w-4" />Build Storyboard</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2: Storyboard Review ──────────────────────────────────────── */}
      {step === 'storyboard' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Storyboard Review</h2>
              <p className="text-sm text-muted-foreground">
                Review each clip. Refresh from any clip to regenerate it and everything below.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setStep('input'); setError(null); setSessionRefLabels([]) }}>
              ← Edit Brief
            </Button>
          </div>

          {/* Prompt summary */}
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Brief:</span> {prompt.slice(0, 100)}{prompt.length > 100 ? '…' : ''}
            {' · '}<span className="font-medium text-foreground">{PROJECT_TYPE_OPTIONS.find(p => p.value === projectType)?.icon} {PROJECT_TYPE_OPTIONS.find(p => p.value === projectType)?.label}</span>
            {' · '}<span className="font-medium text-foreground">{VISUAL_STYLE_OPTIONS.find(s => s.value === visualStyle)?.icon} {VISUAL_STYLE_OPTIONS.find(s => s.value === visualStyle)?.label}</span>
            {' · '}<span className="font-medium text-foreground">{OUTPUT_LANGUAGE_OPTIONS.find(l => l.value === outputLanguage)?.flag} {OUTPUT_LANGUAGE_OPTIONS.find(l => l.value === outputLanguage)?.label}</span>
            {' · '}<span className="font-medium text-foreground">{storyboard.length} clips × {clipDuration}s</span>
          </div>

          {/* Reference image legend — only shown if session has refs */}
          {sessionRefLabels.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 border border-border/40 px-3 py-2">
              <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Reference images:</span>
              {sessionRefLabels.map(r => (
                <span key={r.tag} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] text-primary/80 font-mono">
                  {r.tag} <span className="font-sans font-normal text-foreground/60">= {r.label}</span>
                </span>
              ))}
            </div>
          )}

          {/* 🎯 A/B Hook Generator */}
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-orange-600 dark:text-orange-400">🎯 A/B Hook Generator</p>
                <p className="text-xs text-muted-foreground">Generate 5 different opening hooks for Clip 1 — pick the one most likely to convert.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateHooks}
                disabled={hooksLoading}
                className="shrink-0 border-orange-500/40 text-orange-600 hover:bg-orange-500/10 dark:text-orange-400"
              >
                {hooksLoading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Generating…</> : '⚡ Generate Hooks'}
              </Button>
            </div>

            {/* Hook variants panel */}
            {hookPanelOpen && generatedHooks.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Select a hook to apply to Clip 1:</p>
                {generatedHooks.map((hook, i) => (
                  <button
                    key={hook.type}
                    type="button"
                    onClick={() => applyHookToClip1(i)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      selectedHookIdx === i
                        ? 'border-orange-500/60 bg-orange-500/10 ring-1 ring-orange-500/30'
                        : 'border-border/50 bg-background hover:border-orange-500/30 hover:bg-orange-500/5'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{hook.label}</span>
                      {selectedHookIdx === i && <span className="text-[10px] text-orange-600 font-semibold dark:text-orange-400">✓ Applied</span>}
                    </div>
                    <p className="text-xs font-medium text-foreground">"{hook.opening}…"</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{hook.angle}</p>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setHookPanelOpen(false)}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  ↑ Collapse
                </button>
              </div>
            )}
          </div>

          {/* Clip cards */}
          <div className="space-y-3">
            {storyboard.map((clip, idx) => (
              <StoryboardClipCard
                key={clip.clipNumber}
                clip={clip}
                idx={idx}
                totalClips={storyboard.length}
                clipDuration={clipDuration}
                hint={hints[idx] || ''}
                onHintChange={v => setHints(prev => ({ ...prev, [idx]: v }))}
                onRefresh={() => handleRefresh(idx)}
                onEdit={sessionId ? handleEditClip : undefined}
                isRefreshing={refreshingFrom === idx}
                isStale={refreshingFrom !== null && idx > refreshingFrom}
                refLabels={sessionRefLabels}
              />
            ))}
          </div>

          <Button
            onClick={handleGenerate}
            disabled={storyboard.length === 0 || refreshingFrom !== null}
            className="w-full"
            size="lg"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Generate Reel ({storyboard.length} clips · {storyboard.length * clipDuration}s) →
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── StepIndicator ────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: string; label: string }[] = [
    { key: 'input', label: 'Brief' },
    { key: 'storyboard', label: 'Storyboard' },
    { key: 'result', label: 'Generate & Download' },
  ]
  const activeIdx = steps.findIndex(s => s.key === step)

  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center">
          <div className={`flex items-center gap-1.5 text-sm ${i <= activeIdx ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
              i < activeIdx ? 'bg-primary text-primary-foreground' :
              i === activeIdx ? 'border-2 border-primary text-primary' :
              'border border-muted-foreground/40 text-muted-foreground'
            }`}>
              {i < activeIdx ? '✓' : i + 1}
            </div>
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <ChevronRight className={`mx-2 h-4 w-4 ${i < activeIdx ? 'text-primary' : 'text-muted-foreground/40'}`} />
          )}
        </div>
      ))}
    </div>
  )
}



