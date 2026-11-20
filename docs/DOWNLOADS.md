# Downloads that are not in the repository

GitHub rejects any file over 100 MB, so the large renders are attached to a **GitHub Release** (a release asset can be up to **2 GB per file**). Everything the site needs to run, every source file, the avatar, the After Effects project and the 1080p web film are in the repository itself (see "Repository contents vs assignment" in the README).

| File | Size | Why it is not in git | Where it is |
|---|---|---|---|
| `aftereffects/promo-4k.mp4` | 244 MB (255,907,533 bytes) | Over GitHub's 100 MB limit (listed in `.gitignore`) | Your computer: `D:\PROJECTS\web3d-portfolio\aftereffects\promo-4k.mp4` |
| `public/media/promo-1080.mp4` | 19 MB | In the repository (the film the site plays) | Committed |
| The final report PDF | n/a | Not written yet; it is committed to `docs/report/` (see `docs/report/README.md`), it is small | Your computer |
| Optional: `aftereffects/audio/*.wav` (4 stems) | 50 MB | Regenerable (`node scripts/promo/render-audio.mjs`) | Your computer, ignored by git |
| Optional: `aftereffects/footage/F1 … F10` (PNG frames) | 6.4 GB in total, 0.26 to 1.0 GB per shot | Regenerable from the site (`scripts/capture/capture.mjs`, shot list in `docs/promo/shots.json`) | Your computer, ignored by git |

## Attach the 4K film (and the 1080p film and the report) to a GitHub Release

Do this in the browser (no command line needed):

1. Open the repository: `https://github.com/muhammadumerfarooqq/web3d-portfolio`.
2. On the right, under **Releases**, click **Create a new release** (or open `…/releases/new`).
3. **Choose a tag:** type `v1.0-submission` and pick **Create new tag: v1.0-submission on publish**. Target: `main`.
4. **Release title:** `Web 3D Programming: final submission`.
5. **Description:** one short paragraph, for example: "Final submission. promo-4k.mp4 is the 4K master of the promo film (too large for git); promo-1080.mp4 is the web version the site plays; the report is the final PDF."
6. Drag these files into **Attach binaries by dropping them here**:
   - `D:\PROJECTS\web3d-portfolio\aftereffects\promo-4k.mp4` (244 MB: wait until the upload bar finishes)
   - `D:\PROJECTS\web3d-portfolio\public\media\promo-1080.mp4`
   - the final report PDF (for example `Web3D_Report_Umer_Farooq.pdf`)
   - optional: a ZIP of `aftereffects\audio\*.wav` (50 MB). The footage frames are 6.4 GB: zip each shot folder on its own (every file must stay under 2 GB) only if the teacher asks for them; they can be re-captured.
7. Leave **Set as the latest release** ticked and click **Publish release**.
8. Open the published release page and copy its address. Put that address in the report and in the submission form; the README links to it from "Repository contents vs assignment".

Check afterwards: the release page lists every file with its size, and the download of `promo-4k.mp4` plays.

## Verify what is (and is not) in git

```powershell
git ls-files aftereffects                      # the .aep, promo.jsx, the web renders: no promo-4k.mp4
git check-ignore -v aftereffects/promo-4k.mp4  # shows the .gitignore line that excludes it
```
