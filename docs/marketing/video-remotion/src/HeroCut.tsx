import React from 'react';
import { AbsoluteFill } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import {
  S1Hook, S2Imagine, S3Missions, S4Fun, S5Reveal,
  S6Build, S7Join, S8PlayAuto, S9Audience, S10CTA,
} from './scenes/AllScenes';

// Scene durations tuned to the Hebrew VO lines (see vo-script.json + mix.mjs).
// Final-timeline boundaries (frames @30fps), with 9f fade overlaps:
// 0 hook | 135 imagine | 354 missions | 630 fun | 876 reveal | 1080 build
// | 1278 join | 1422 play+auto | 1752 audience | 1932 cta | end 2205 (73.5s)
const SCENES: { c: React.FC; dur: number }[] = [
  { c: S1Hook, dur: 144 },
  { c: S2Imagine, dur: 228 },
  { c: S3Missions, dur: 285 },
  { c: S4Fun, dur: 255 },
  { c: S5Reveal, dur: 213 },
  { c: S6Build, dur: 207 },
  { c: S7Join, dur: 153 },
  { c: S8PlayAuto, dur: 339 },
  { c: S9Audience, dur: 285 },
  { c: S10CTA, dur: 273 },
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
