// "We are building your game": from the last answer until the first mission (change:
// creator-stays-to-the-end). It rises before the network does anything, because the screen behind it
// is an empty dashboard that says "start your first game", right after someone answered everything.
// Real names from the real bank. Under the feed a press skips it; before the game exists there is
// nothing to skip to.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from './LanguageContext';
import { Icon } from './Icon';
import { rollNames } from '../lib/missionNames';

export default function BuildingMoment({ onSkip }: { onSkip?: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  useEffect(() => {
    let names = rollNames(10);
    let i = 0;
    setName(names[0] ?? '');
    const tick = window.setInterval(() => {
      if (names.length === 0) names = rollNames(10); // The bank may land a moment after we rise.
      i += 1;
      setName(names[i % Math.max(1, names.length)] ?? '');
    }, 170);
    return () => window.clearInterval(tick);
  }, []);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t.missionFeed.building} className="fixed inset-0 z-[75] rp-setup-bg">
      <button
        type="button" onClick={onSkip} disabled={!onSkip}
        className="w-full h-full flex flex-col items-center justify-center gap-4 px-6 text-center text-[--ink-1]"
      >
        <Icon name="dice" className="w-12 h-12 text-ink-fire animate-spin motion-reduce:animate-none" />
        <span className="font-brand text-[26px] font-extrabold">{t.missionFeed.building}</span>
        <span className="min-h-[28px] text-[18px] font-semibold text-ink-fire" dir="auto">{name}</span>
      </button>
    </div>,
    document.body,
  );
}
