import { useEffect, useState } from 'react';

// Thin top banner shown when the device is offline. Reads/live-state keep
// working from the Firestore cache, but actions (verify, submit, SOS) need a
// connection — so participants get a clear, non-blocking heads-up.
export default function ConnectionBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (online) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-black text-center text-xs font-medium py-1.5 shadow">
      ⚠ You're offline. Progress saved. Actions will resume when signal returns.
    </div>
  );
}
