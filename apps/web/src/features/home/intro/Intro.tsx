import { useEffect, useId, useState } from 'react';

import { useT } from '../../../shared/i18n';
import { RING_ARCS } from '../../../shared/ui/Logo';
import { INTRO_MS, introTimeline } from './timeline';
import './intro.css';

type Phase = 'typing' | 'waiting' | 'reveal' | 'leaving';

/** Runs the timeline once; a key, a click or a tap jumps to the fade at any moment. */
function useIntroPhase(length: number, onDone: () => void): { typed: number; phase: Phase } {
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing');
  useEffect(() => {
    const beats = introTimeline(length);
    const timers: number[] = [];
    const at = (ms: number, run: () => void) => {
      timers.push(window.setTimeout(run, ms));
    };
    let leaving = false;
    const leave = () => {
      if (leaving) return;
      leaving = true;
      setPhase('leaving');
      at(INTRO_MS.leave, onDone);
    };
    for (let letters = 1; letters <= length; letters += 1) {
      at(INTRO_MS.typeStart + beats.step * letters, () => {
        setTyped(letters);
      });
    }
    at(beats.typed, () => {
      setPhase('waiting');
    });
    at(beats.reveal, () => {
      setPhase('reveal');
    });
    at(beats.leave, leave);
    window.addEventListener('keydown', leave);
    window.addEventListener('pointerdown', leave);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener('keydown', leave);
      window.removeEventListener('pointerdown', leave);
    };
  }, [length, onDone]);
  return { typed, phase };
}

/**
 * The opening moment, once per visit: on black the ring draws itself and MOVIQ appears, "Move
 * smarter." is typed with a square cursor that blinks three times and goes out, and New York
 * rises slowly out of the dark. Then it fades and the header arrives. It is decoration only, so
 * assistive technology reads the page underneath from the first moment.
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const tagline = useT().brand.tagline;
  const gradient = `intro${useId().replace(/:/g, '')}`;
  const { typed, phase } = useIntroPhase(tagline.length, onDone);
  const caret = typed > 0 && (phase === 'typing' || phase === 'waiting');
  return (
    <div className={`intro intro-${phase}`} aria-hidden="true">
      <div className="intro-dark" />
      <div className="intro-content">
        <svg className="intro-mark" viewBox="0 0 100 100" focusable="false">
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#365314" stopOpacity=".35" />
              <stop offset=".5" stopColor="#84cc16" />
              <stop offset="1" stopColor="#d9f99d" />
            </linearGradient>
          </defs>
          {[RING_ARCS.top, RING_ARCS.bottom].map((d, index) => (
            <path
              key={d}
              className={index === 0 ? 'intro-arc' : 'intro-arc intro-arc-late'}
              pathLength={1}
              d={d}
              stroke={`url(#${gradient})`}
              strokeWidth="1.8"
              fill="none"
              strokeLinecap="round"
            />
          ))}
          <text className="intro-word" x="50" y="53.6" textAnchor="middle">
            MOV<tspan className="intro-iq">IQ</tspan>
          </text>
        </svg>
        <p className="intro-tagline" lang="en">
          <span>{tagline.slice(0, typed)}</span>
          {caret && <span className="intro-caret" />}
          {/* The rest of the line keeps its room, so the typed letters never shift. */}
          <span className="intro-ghost">{tagline.slice(typed)}</span>
        </p>
      </div>
    </div>
  );
}
