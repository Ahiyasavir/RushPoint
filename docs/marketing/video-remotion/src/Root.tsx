import React from 'react';
import { Composition } from 'remotion';
import { HeroCut, HERO_DURATION } from './HeroCut';
import { SocialCut, SOCIAL_DURATION } from './SocialCut';
import { FPS } from './lib/theme';
import { waitForFonts } from './lib/fonts';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HeroCut"
        component={HeroCut}
        durationInFrames={HERO_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
        calculateMetadata={async () => {
          await waitForFonts();
          return {};
        }}
      />
      <Composition
        id="SocialCut"
        component={SocialCut}
        durationInFrames={SOCIAL_DURATION}
        fps={FPS}
        width={1080}
        height={1920}
        calculateMetadata={async () => {
          await waitForFonts();
          return {};
        }}
      />
    </>
  );
};
