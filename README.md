# Sam Run 3D

The endless runner for Sam

Plain static site: three.js from a CDN, no build step. Hosted on Vercel at sam.joeprojects.com.

## Controls
- Swipe left/right (or arrow keys / A-D): switch lanes
- Swipe up (or up / W / space): jump
- Swipe down (or down / S): slide (fast-drop in the air)

## Pickups
- Dumbbells: gains (+10)
- Protein shake: shield, or heals an injury
- Solo cup: drunk mode, 2x points
- Boost orb: supersonic, smash through everything
- Phone: got her number (+250)
- Blue shades: Sexy Mode, dumbbells from every lane can't resist him and fly in

A hit leaves Sam injured for a few seconds. A second hit while injured, or running into the front of a bus, ends the run.

Parked buses often have a ramp: run up it and along the roofs (bus trains are 2-3 buses long). Step off the side or the back and you drop back down.

## Accounts, dumbbells, skins
- Anyone can play as a guest. Guests keep their personal best and mission progress on the device, but dumbbells only bank and scores only hit the leaderboard with an account. The game-over screen offers to create one and saves that run right away.
- Accounts are a name + password (no email, so no reset; reset one in Supabase if needed). They live in `samrun_accounts`, separate from Supabase Auth, which other apps in the project use.
- Scores from before accounts existed are claimed by signing up with that exact name; the claimer also gets that row's lifetime dumbbells as a welcome stash.
- Dumbbells buy skins (the shop only sells cosmetics; gameplay is identical for everyone). Missions come in sets of 3 (one easy, one medium, one hard), and finishing a set pays a dumbbell bonus. The first run each day pays a streak bonus.
- Scoring is unchanged, and the server runs the same sanity checks on every run. See `supabase/samrun_accounts.sql`.

## Adding a skin
Skins must be rigged in Mixamo (same `mixamorig` skeleton), so all the animations just work.
1. Pull the embedded textures out of the FBX into `<id>_color.jpg` / `<id>_normal.jpg` next to `assets/skins/<id>.fbx` (this halves the file size).
2. Add a 256x320 transparent `assets/skins/<id>_thumb.webp` for the shop.
3. Add it to `SKINS` in `src/progress.js` and add its price to `samrun_buy` in Supabase.
Skins only download when someone equips or previews one.

## Run locally
```
python3 -m http.server 5173
```
Then open http://localhost:5173.

## Assets
`assets/sam.fbx` is the Mixamo-rigged model with its embedded textures pulled out into `sam_color.jpg` / `sam_normal.jpg`, which cuts about 5MB off the download. Animations in `assets/anims/` are skinless Mixamo clips.
