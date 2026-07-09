# Design Import — Attempt Notes & Correct Procedure

> Context: implementing the design file at
> `https://api.anthropic.com/v1/design/h/MgdmHa0DOOdXbyJJ5rdOLw`
> ("RushPoint Design System — Topographic Expedition").

## What the design file actually is

The URL does **not** return HTML or JSON. It returns a **gzip-compressed TAR archive**
(`Content-Type: application/gzip`, ~165 KB). Inside:

```
rushpoint-design-system/
├── README.md                      # design philosophy + implementation notes
├── colors_and_type.css            # the canonical token palette (CSS custom props)
└── designs/
    ├── mobile-app/   (index.html, ios-frame.jsx, primitives.jsx, screens.jsx)
    └── admin-dashboard/ (index.html, atoms.jsx, pages.jsx)
```

The JSX files are **React + inline-style mockups** (illustrative layout/style, *not*
production code to copy). The README explicitly says: "map the visual language onto the
production stack (NativeWind on mobile, Tailwind on admin). Preserve all functionality;
this is a visual reskin only."

**Design philosophy: "Topographic Expedition"** — warm parchment backgrounds, forest
greens, trail-marker orange "blaze", elevation-shaded data-viz accents, soft paper-like
shadows. (This is a LIGHT theme — it replaces the old dark-neon theme.)

### Canonical palette (`colors_and_type.css`)
```
--rp-bg: #f5f0e6   --rp-bg-elevated: #ebe3d3   --rp-surface: #fffdf8
--rp-forest-900:#1a2e23 700:#2d4a3e 500:#3d6152 300:#6b8e5a
--rp-blaze:#e8743b  --rp-blaze-light:#f2935f  --rp-rust:#c73e3e  --rp-gold:#c9a227
--rp-elev-1..5: #e8e3d8 #c9d4b0 #9db87e #6b8e5a #3d6152
--rp-ink:#1a2620  --rp-ink-soft:#4a5b52  --rp-ink-faint:#6e7b72
--rp-success:#4a7c4e --rp-warning:#d89b3d --rp-danger:#c73e3e
```

## What went wrong (and why I got stuck)

1. **`WebFetch` can't read it.** It treats the response as a web page, sees binary, and
   bails. It *does* save the raw bytes to disk though — look for the line
   `Binary content (application/gzip, …) also saved to …/tool-results/webfetch-*.bin`.
   That `.bin` file is the actual archive.
2. **Windows `python`/`python3` is the broken Microsoft Store stub** — every invocation
   exits with code 49 and prints nothing. This poisoned several batches.
3. **Batched tool calls cancel-cascade.** When one call in a parallel batch errors, every
   sibling call is cancelled (`Cancelled: parallel tool call …`). Combined with (2), whole
   batches were lost. → Run fragile/probing commands **one per turn**, not batched.
4. **`tar -xzf "C:\..."` fails** with `Cannot connect to C: resolve failed` — GNU tar reads
   the colon in a Windows path as a remote `host:path`.

## ✅ Correct procedure for next time

```bash
# 1. Fetch the archive directly (skip WebFetch — use curl):
curl -s "https://api.anthropic.com/v1/design/h/MgdmHa0DOOdXbyJJ5rdOLw" -o design.tar.gz
#    (or reuse the .bin WebFetch already saved under .../tool-results/webfetch-*.bin)

# 2. Extract with --force-local so the C: path isn't read as a remote host:
mkdir -p design_ref
tar --force-local -xzf design.tar.gz -C design_ref
#    → design_ref/rushpoint-design-system/...

# 3. Read README.md + colors_and_type.css first; treat the .jsx as visual reference only.
```

Use **Node** (`node -e` / a `.cjs` script with `zlib.gunzipSync`) for any scripting —
**never** the `python` stub on this machine. Avoid large parallel Bash batches when any
command might fail.

## Implementation status (visual reskin)

- [x] Decoded archive, read README + palette.
- [x] `apps/mobile/src/components/tokens.ts` → reskinned to Topographic Expedition
      (semantic names preserved, so the kit re-themes from this one file).
- [x] `apps/admin/src/index.css` `--rp-*` custom properties → Topographic palette
      (color-scheme light, parchment bg, forest ink, blaze accent, elevation ramp).
- [ ] Admin `index.css` body/scrollbar/selection still reference old dark hexes
      (`#050508`, neon green) — update to parchment + blaze.
- [ ] Optional topo motifs (contour backdrop, elevation profile, coordinate readouts)
      from the mockups — nice-to-have, not started.

Reference files are extracted under `tmp_design/` (gitignored scratch — delete when done).
