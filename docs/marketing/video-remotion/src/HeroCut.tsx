import React from 'react';
import { AbsoluteFill } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { S1Hook, S2Problem, S3Reveal, S4Build, S5Launch, S6Play, S7Proof, S8Audience, S9CTA } from './scenes/AllScenes';

const SCENES: { c: React.FC; dur: number }[] = [
  { c: S1Hook, dur: 90 },
  { c: S2Problem, dur: 150 },
  { c: S3Reveal, dur: 180 },
  { c: S4Build, dur: 360 },
  { c: S5Launch, dur: 180 },
  { c: S6Play, dur: 420 },
  { c: S7Proof, dur: 300 },
  { c: S8Audience, dur: 210 },
  { c: S9CTA, dur: 360 },
];

const T = 9; // transition overlap frames
export const HERO_DURATION = SCENES.reduce((a, s) => a + s.dur, 0) - T * (SCENES.length - 1);

export const HeroCut: React.FC = () => {
  const children: React.ReactNode[] = [];
  SCENES.forEach((s, i) => {
    if (i > 0) {
      children.push(
        <TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={linearTiming({ durationInFrames: T })} />
      );
    }
    const Comp = s.c;
    children.push(
      <TransitionSeries.Sequence key={`s${i}`} durationInFrames={s.dur}>
        <Comp />
      </TransitionSeries.Sequence>
    );
  });
  return (
    <AbsoluteFill style={{ backgroundColor: '#07080F' }}>
      <TransitionSeries>{children}</TransitionSeries>
    </AbsoluteFill>
  );
};
