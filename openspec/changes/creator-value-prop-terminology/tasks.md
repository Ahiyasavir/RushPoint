## 1. Product sign-off (blocking)

- [ ] 1.1 Confirm with product/marketing: gloss-addition approach (keep brand term, add plain-
      language clause) vs. full brand-term rename — per design.md Open Questions, do not proceed
      to implementation on an assumed answer.
- [ ] 1.2 Finalize literal HE/EN copy for each gloss (hero, dashboard subtitle, gallery subtitle).

## 2. RED — i18n gate first

- [ ] 2.1 Add the new gloss keys to both dictionaries in `i18n.ts` with placeholder/final copy
      from 1.2; run `npm run i18n:check:strict` and confirm it's clean for the new keys
      specifically (a missing HE or EN pair should fail PART A).

## 3. GREEN — wire it up

- [ ] 3.1 Render the gloss in `AuthGate.tsx` next to `landing.badge` / the hero headline.
- [ ] 3.2 Render the gloss in the dashboard subtitle (`DashboardPage.tsx`) and gallery subtitle
      (`GalleryPage.tsx`).

## 4. Verify

- [ ] 4.1 `npm run i18n:check:strict`
- [ ] 4.2 `npm run creator:build`
- [ ] 4.3 Manual preview: logged-out landing page in HE and EN (toggle via Settings or locale
      param), confirm no overflow on mobile (`resize_window` mobile preset) and mid-size desktop.
