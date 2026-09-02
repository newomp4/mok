"use client";
import { useUI } from "@/store/ui";

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, at: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const ac = audio();
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, ac.currentTime + at);
  g.gain.linearRampToValueAtTime(gain, ac.currentTime + at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + dur);
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + at);
  o.stop(ac.currentTime + at + dur + 0.05);
}

/** Two-note chime when an export finishes. */
export function chime() {
  if (!useUI.getState().sounds) return;
  tone(880, 0, 0.18, 0.08);
  tone(1318.5, 0.11, 0.32, 0.07);
}

/** Short blip when an action cannot run. */
export function blip() {
  if (!useUI.getState().sounds) return;
  tone(220, 0, 0.09, 0.06, "triangle");
}
