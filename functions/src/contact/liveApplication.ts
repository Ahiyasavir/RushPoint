/**
 * RushPoint Live team applications (change: rushpoint-live-signup).
 *
 * The flagship event takes TEN teams. The marketing site therefore needs a way for
 * a group of friends — who have no account, and who are applying rather than signing
 * up for anything — to put themselves forward. That makes `submitLiveApplication`
 * the platform's third unauthenticated write endpoint, and it is built on exactly
 * the reasoning that governs `submitContactMessage` in this same directory:
 *
 *   • validation, a size bound and TWO rate budgets stand in for authentication;
 *   • the rate key is derived from the CONNECTION, never from the payload, because a
 *     key the caller supplies is a key the caller can vary;
 *   • the wide ATTEMPT budget is charged for every call, the tight STORE budget only
 *     once a payload has passed validation — so a group that mistypes its own phone
 *     number is not locked out of the only channel it has;
 *   • the collection is closed to clients in BOTH directions. These records carry a
 *     phone number, a home town, an age range and a photograph of identifiable
 *     people, several of whom are likely minors. An open read would be far worse
 *     than an open read of the contact form.
 *
 * ── Why the photo lives in Firestore and not the upload route ────────────────
 *
 * functions/uploadRoute.js requires a Firebase ID token and checks that the path
 * belongs to the caller. An applicant has neither. The alternatives were to open an
 * anonymous binary endpoint on the VPS (a new abuse surface, on disk, for one form)
 * or to carry the image inside the callable that is already rate limited and already
 * validated. The second is a much smaller thing to get wrong, so the browser
 * downscales the picture and sends it as base64 — see the bound and its reasoning in
 * liveApplicationValidate.ts.
 *
 * It is stored in its OWN document beneath the application rather than on it, for
 * two reasons: the admin list reads ten to a hundred applications at a time and must
 * not drag half a megabyte of image per row through that query, and Firestore's 1 MiB
 * document ceiling is then spent on the photo alone instead of being shared with a
 * pitch somebody wrote at length.
 */
import * as functions from 'firebase-functions/v1';

import { db } from '../firebase';
import { assertAdmin } from '../auth';
import { loggedCallable } from '../obs/log';
import { writeAuditLog } from '../obs/audit';
import { enforceRateLimit } from '../rateLimitStore';
import { ApplicationRejected, validateLiveApplication } from './liveApplicationValidate';
import { rateKeyFor } from './index';
import { sendLiveApplicationNotification } from './notify';

/** The collection. Server-write-only and client-unreadable; see firestore.rules. */
export const LIVE_APPLICATIONS = 'liveApplications';

/**
 * The photo's document, beneath its application. A fixed id rather than a generated
 * one so "the group photo for this application" is an address, not a query.
 */
export const PHOTO_SUBCOLLECTION = 'photo';
export const PHOTO_DOC_ID = 'original';

/**
 * How many applications one origin may STORE. Tight: a team applies once, and twice
 * if it thinks the first attempt failed. Charged only after validation passes.
 */
export const LIVE_APPLICATION_RATE_BUCKET = 'submitLiveApplication';

/**
 * How many times one origin may CALL, refusals included. Much wider, for the reason
 * spelled out beside the contact form's pair of budgets: the failure mode of a tight
 * limit here is a real team locked out of the application form over a typo.
 */
export const LIVE_APPLICATION_ATTEMPT_BUCKET = 'submitLiveApplicationAttempt';

export const submitLiveApplication = loggedCallable('submitLiveApplication', async (data, context) => {
  // Reuses the contact form's connection-keyed function rather than restating it:
  // two copies of "where does the rate key come from" is two places to get it wrong,
  // and getting it wrong means deriving the key from something the caller controls.
  const key = rateKeyFor(context);

  // The wide bound first, charged whatever becomes of this call, so a flood of
  // garbage still ends. It costs one map lookup.
  await enforceRateLimit(key, LIVE_APPLICATION_ATTEMPT_BUCKET);

  let fields;
  let photo;
  try {
    ({ fields, photo } = validateLiveApplication((data ?? {}) as Record<string, unknown>));
  } catch (e) {
    // The validator names the field an applicant has to fix. Carrying that name
    // through is the entire difference between a form that can be completed and one
    // that says "something was wrong" nine answers in.
    if (e instanceof ApplicationRejected) {
      throw new functions.https.HttpsError('invalid-argument', `${e.field}: ${e.message}`);
    }
    throw e;
  }

  // The tight bound only now, once this is an application rather than an attempt.
  await enforceRateLimit(key, LIVE_APPLICATION_RATE_BUCKET);

  const ref = db.collection(LIVE_APPLICATIONS).doc();
  await ref.set({
    ...fields,
    // A copy of `sectors` as a plain array — `fields.sectors` is readonly for the
    // type system's benefit, which Firestore neither knows nor cares about.
    sectors: [...fields.sectors],
    // The photo is OPTIONAL (change: rushpoint-live-optional-photo). `hasPhoto` is
    // stored explicitly rather than left to be inferred from a missing subdocument:
    // the admin list reads THIS document only, and "no photo" and "a photo I have
    // not fetched yet" are different things that would otherwise look identical.
    hasPhoto: photo !== null,
    photoContentType: photo?.contentType ?? null,
    // Cheap to store, and it is what tells an operator whether a photo is worth
    // opening before they open it.
    photoBytes: photo ? Math.floor((photo.base64.length * 3) / 4) : 0,
    // Server assigned. Ordering and any later retention sweep must not depend on a
    // value the sender supplied, and a sender can supply anything.
    receivedAt: Date.now(),
    status: 'new',
    // Someone already using the product may well apply too, and knowing that saves
    // a reply asking who they are.
    uid: context.auth?.uid ?? null,
  });

  // Only when there is one. An empty subdocument would make `getLiveApplicationPhoto`
  // answer with a zero-length image instead of an honest not-found.
  if (photo) {
    await ref.collection(PHOTO_SUBCOLLECTION).doc(PHOTO_DOC_ID).set({
      contentType: photo.contentType,
      base64: photo.base64,
      receivedAt: Date.now(),
    });
  }

  // Best effort, and never allowed to fail the call: the application is already
  // stored, so telling the team it failed would invite a duplicate.
  await sendLiveApplicationNotification({
    teamName: fields.teamName,
    teamSize: fields.teamSize,
    sectors: [...fields.sectors],
    location: fields.location,
    howTheyMet: fields.howTheyMet,
    ageRange: fields.ageRange,
    motivation: fields.motivation,
    cameraComfort: fields.cameraComfort,
    phone: fields.phone,
    language: fields.language,
  });

  // Nothing but the outcome. A document id is an internal fact, and handing one to
  // an anonymous caller invites probing.
  return { ok: true };
});

export const listLiveApplications = loggedCallable('listLiveApplications', async (data, context) => {
  const uid = assertAdmin(context);

  const { limit } = (data ?? {}) as { limit?: number };
  const capped =
    typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 100;

  const snap = await db.collection(LIVE_APPLICATIONS).orderBy('receivedAt', 'desc').limit(capped).get();

  await writeAuditLog({ operatorId: uid, actionType: 'listLiveApplications', newValue: snap.size });

  return {
    // Copied out BY NAME rather than spread, so a field added to the stored document
    // later cannot reach a response by default — the same rule the share projection
    // follows. The photo is deliberately absent: it is a separate callable.
    applications: snap.docs.map((d) => {
      const a = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        teamName: String(a.teamName ?? ''),
        teamSize: Number(a.teamSize ?? 0),
        sectors: Array.isArray(a.sectors) ? a.sectors.map(String) : [],
        location: String(a.location ?? ''),
        howTheyMet: String(a.howTheyMet ?? ''),
        ageRange: String(a.ageRange ?? ''),
        motivation: String(a.motivation ?? ''),
        cameraComfort: Number(a.cameraComfort ?? 0),
        phone: String(a.phone ?? ''),
        phoneNormalized: String(a.phoneNormalized ?? ''),
        // `hasPhoto` is read with a FALLBACK for rows written before the photo became
        // optional: those all carry one, and no stored field says so.
        hasPhoto: typeof a.hasPhoto === 'boolean' ? a.hasPhoto : Boolean(a.photoContentType),
        photoContentType: String(a.photoContentType ?? ''),
        photoBytes: Number(a.photoBytes ?? 0),
        language: (a.language as string | null) ?? null,
        receivedAt: Number(a.receivedAt ?? 0),
        status: String(a.status ?? 'new'),
        uid: (a.uid as string | null) ?? null,
      };
    }),
  };
});

/**
 * One application's group photo.
 *
 * Separate from the list on purpose. Half a megabyte per row would make the list
 * unusable, and a photograph of identifiable people — quite possibly minors — is the
 * most sensitive thing in the record, so fetching one is a deliberate act by a named
 * operator that leaves an audit row behind, rather than a side effect of opening a page.
 */
export const getLiveApplicationPhoto = loggedCallable('getLiveApplicationPhoto', async (data, context) => {
  const uid = assertAdmin(context);

  const { applicationId } = (data ?? {}) as { applicationId?: string };
  if (typeof applicationId !== 'string' || applicationId.trim() === '') {
    throw new functions.https.HttpsError('invalid-argument', 'applicationId is required');
  }

  const snap = await db
    .collection(LIVE_APPLICATIONS)
    .doc(applicationId)
    .collection(PHOTO_SUBCOLLECTION)
    .doc(PHOTO_DOC_ID)
    .get();

  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'no photo for that application');

  await writeAuditLog({ operatorId: uid, actionType: 'getLiveApplicationPhoto', targetId: applicationId });

  const photo = snap.data() as Record<string, unknown>;
  return {
    contentType: String(photo.contentType ?? 'image/jpeg'),
    base64: String(photo.base64 ?? ''),
  };
});
