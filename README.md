# Sam Run 3D

The endless runner nobody asked for. Sam sprints through UCSC dodging banana slugs, wild turkeys, fallen redwoods, 8AM midterms and the Campus Loop bus.

Plain static site: three.js from a CDN, no build step. Hosted on Vercel at sam.joeprojects.com.

## Controls
- Swipe left/right (or arrow keys / A-D): switch lanes
- Swipe up (or up / W / space): jump
- Swipe down (or down / S): slide tackle (fast-drop in the air)

## Pickups
- 💪 Dumbbells: gains (+10)
- 🥤 Protein shake: shield, or heals an injury
- 🍺 Solo cup: drunk mode, 2x points, reversed controls
- 🚀 Boost orb: supersonic, smash through everything
- 📱 Phone: got her number (+250)

A hit leaves Sam injured for a few seconds. A second hit while injured, or running into the front of a bus, ends the run.

## Run locally
```
python3 -m http.server 5173
```
Then open http://localhost:5173.

## Assets
`assets/sam.fbx` is the Mixamo-rigged model with its embedded textures pulled out into `sam_color.jpg` / `sam_normal.jpg`, which cuts about 5MB off the download. Animations in `assets/anims/` are skinless Mixamo clips.
