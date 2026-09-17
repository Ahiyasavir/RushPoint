// Admin-only list of RushPoint Live team applications (change: rushpoint-live-signup).
//
// Not in the primary nav (the same treatment as `/admin/contact` and `/admin/users`):
// reachable only by direct URL. It gates its own content on the signed-in user's `admin`
// custom claim so a non-admin never even calls the callable, but the REAL boundary is
// server-side — listLiveApplications re-checks `context.auth.token.admin` and writes an
// auditLogs record for every read.
//
// TEXT, NEVER MARKUP. Every field here was typed by an anonymous stranger into a form on
// a public website, which puts it in the same class as the contact page: rendered
// exclusively through React children, never through dangerouslySetInnerHTML.
//
// THE PHOTO IS NOT LOADED WITH THE LIST, and that is a decision rather than an
// optimisation. It is the most sensitive thing in the record — a picture of identifiable
// people, many of whom will be minors — so fetching one is a deliberate press by a named
// operator that leaves an audit row behind, not a side effect of opening a page. It also
// keeps a hundred rows from dragging tens of megabytes through the browser.
//
// PHONE FIRST, like the other admin pages: whoever reads this is usually triaging from a
// phone, so a card per application is the primary layout and there is no table at all.
// The pitch is free text of up to two thousand characters; it was never going to fit a cell.
import { useEffect, useState } from 'react';
import { auth } from '../services/firebase';
import { getLiveApplicationPhoto, listLiveApplications, type LiveApplication } from '../services/calls';
import { isAdminClaim } from '../lib/adminGate';
import { EmptyState, Badge, Button } from '../components/ui';
import { LoadingState } from '../components/LoadingState';
import { useT } from '../components/LanguageContext';
import { TAP_TARGET } from '../lib/interaction';

type GateState = 'checking' | 'denied' | 'allowed';

/** What the photo panel of ONE application is doing right now. */
type PhotoState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; src: string };

/**
 * Where a tap on the phone number goes.
 *
 * `tel:` and `wa.me` both take the normalized digits rather than what the applicant
 * typed: a dash inside a `tel:` is tolerated by most dialers and by no means all, and
 * wa.me refuses anything but digits outright. The number as WRITTEN is still what is
 * displayed, because that is the form a person recognises as their own.
 */
function telHref(app: LiveApplication): string {
  return `tel:+${encodeURIComponent(app.phoneNormalized)}`;
}

function whatsappHref(app: LiveApplication): string {
  return `https://wa.me/${encodeURIComponent(app.phoneNormalized)}`;
}

export default function AdminLiveApplicationsPage() {
  const t = useT();
  const tl = t.adminLive;

  const [gate, setGate] = useState<GateState>('checking');
  const [applications, setApplications] = useState<LiveApplication[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [photos, setPhotos] = useState<Record<string, PhotoState>>({});

  async function load() {
    setFailed(false);
    try {
      const res = await listLiveApplications({ limit: 200 });
      setApplications(res.applications);
    } catch (e) {
      console.error('[adminLive] listLiveApplications failed:', e);
      // Keep whatever was already on screen. Replacing a readable list with an error
      // because a refresh failed loses information the reader already had.
      setApplications((prev) => prev ?? []);
      setFailed(true);
    }
  }

  async function loadPhoto(id: string) {
    setPhotos((prev) => ({ ...prev, [id]: { kind: 'loading' } }));
    try {
      const res = await getLiveApplicationPhoto({ applicationId: id });
      // Rebuilt as a data URL here rather than stored as one, so the content type
      // shown to the browser is the one the SERVER vouched for.
      setPhotos((prev) => ({
        ...prev,
        [id]: { kind: 'ready', src: `data:${res.contentType};base64,${res.base64}` },
      }));
    } catch (e) {
      console.error('[adminLive] getLiveApplicationPhoto failed:', e);
      setPhotos((prev) => ({ ...prev, [id]: { kind: 'failed' } }));
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const user = auth.currentUser;
      if (!user) { if (!cancelled) setGate('denied'); return; }
      try {
        const token = await user.getIdTokenResult();
        if (cancelled) return;
        if (!isAdminClaim(token.claims as Record<string, unknown>)) { setGate('denied'); return; }
        setGate('allowed');
        await load();
      } catch {
        if (!cancelled) setGate('denied');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (gate === 'checking') return <LoadingState messages={tl.loading} />;

  if (gate === 'denied') {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <EmptyState title={tl.deniedTitle} body={tl.deniedBody} />
      </div>
    );
  }

  if (applications === null) return <LoadingState messages={tl.loading} />;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{tl.title}</h1>
          <p className="text-sm opacity-80 mt-1">{tl.subtitle}</p>
        </div>
        <Button variant="subtle" onClick={() => void load()}>{tl.refreshBtn}</Button>
      </header>

      {failed && <p className="text-sm text-red-500">{tl.loadFailed}</p>}

      {applications.length === 0 ? (
        <EmptyState title={tl.empty} body={tl.emptyHint} />
      ) : (
        <>
          <p className="text-sm opacity-70">{tl.countLabel(applications.length)}</p>
          <ul className="space-y-3">
            {applications.map((app) => {
              const photo = photos[app.id];
              return (
                <li
                  key={app.id}
                  className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {/* dir="auto" because a team name may be Hebrew or Latin. */}
                    <span className="font-semibold text-lg" dir="auto">{app.teamName}</span>
                    <Badge color="cyan">{tl.membersLabel(app.teamSize)}</Badge>
                    {app.sectors.map((sector) => (
                      <Badge key={sector} color="zinc">{tl.sectorLabel(sector)}</Badge>
                    ))}
                    {app.uid && <Badge color="cyan">{tl.signedInTag}</Badge>}
                  </div>

                  <p className="text-xs opacity-60">
                    {tl.colReceived}: {new Date(app.receivedAt).toLocaleString()}
                  </p>

                  {/* The short answers, as a definition list: two of these are one word
                      long and giving each its own paragraph would bury the pitch. */}
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="opacity-60">{tl.colLocation}</dt>
                      <dd dir="auto" className="break-words">{app.location}</dd>
                    </div>
                    <div>
                      <dt className="opacity-60">{tl.colAges}</dt>
                      <dd dir="auto" className="break-words">{app.ageRange}</dd>
                    </div>
                    <div>
                      <dt className="opacity-60">{tl.colCamera}</dt>
                      <dd>{tl.cameraLabel(app.cameraComfort)}</dd>
                    </div>
                  </dl>

                  {/* whitespace-pre-wrap keeps the applicant's own line breaks without
                      interpreting anything they wrote. */}
                  <div className="space-y-1">
                    <p className="text-xs opacity-60">{tl.colMet}</p>
                    <p className="text-sm whitespace-pre-wrap break-words" dir="auto">{app.howTheyMet}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs opacity-60">{tl.colMotivation}</p>
                    <p className="text-sm whitespace-pre-wrap break-words" dir="auto">{app.motivation}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {/* dir="ltr" because a phone number reads left to right inside an
                        RTL page, and text-start so it still sits against the same edge. */}
                    <span className="text-sm opacity-70 break-all" dir="ltr">{app.phone}</span>
                    <a className={`${TAP_TARGET} text-sm underline`} href={telHref(app)}>
                      {tl.callBtn}
                    </a>
                    <a
                      className={`${TAP_TARGET} text-sm underline`}
                      href={whatsappHref(app)}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      {tl.whatsappBtn}
                    </a>
                  </div>

                  {/* The photo, behind a deliberate press. The notice is above the
                      button rather than after the fact: an operator should know it is
                      recorded BEFORE they decide, not learn it afterwards. */}
                  <div className="space-y-2 border-t border-black/10 dark:border-white/10 pt-3">
                    {!photo && (
                      <>
                        <p className="text-xs opacity-60">{tl.photoNotice}</p>
                        <Button variant="subtle" onClick={() => void loadPhoto(app.id)}>
                          {tl.showPhotoBtn}
                        </Button>
                      </>
                    )}
                    {photo?.kind === 'loading' && <p className="text-sm opacity-70">{tl.photoLoading}</p>}
                    {photo?.kind === 'failed' && <p className="text-sm text-red-500">{tl.photoFailed}</p>}
                    {photo?.kind === 'ready' && (
                      <img
                        className="max-h-96 w-full rounded-lg object-contain"
                        src={photo.src}
                        alt={tl.photoAlt}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
