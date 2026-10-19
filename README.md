# Navality

A 3D multiplayer naval game built with [three.js](https://threejs.org/). Right now it's a walkable harbour island: a custom ocean shader (rolling waves, foam, sun glints, shallow turquoise shallows), a textured island with grass, dirt and sand, a dock, a moored boat, a lighthouse and trees.

## Controls

**On foot**

| Key | Action |
| --- | --- |
| W A S D / arrows | Move |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump |
| E | Board the boat or seaplane (when standing near it) |

**Sailing**

| Key | Action |
| --- | --- |
| W / S | Raise / lower the sail |
| A / D | Steer left / right |
| Mouse | Orbit the camera |
| Scroll | Zoom |
| E | Go ashore (when near the dock or beach) |

**Flying the seaplane**

| Key | Action |
| --- | --- |
| R / F (or Shift) | Throttle up / down |
| S / W | Nose up / down |
| A / D | Bank left / right (steer while on the water) |
| Mouse | Orbit the camera |
| Scroll | Zoom |
| E | Get out (only on the water, slowed down, near land) |

Esc releases the mouse.

## Sailing

The wind slowly shifts direction and strength. The arrow in the bottom-right shows which way it's blowing relative to your bow, and the red flag on the mast shows it in the world.

- You can't sail straight into the wind: within about 35° of it the boat stalls ("in irons").
- You're fastest with the wind coming from the side (a beam reach).
- The boom swings out automatically and the boat leans away from the wind.
- You bounce off the beach, the dock and rocks.

## Flying

The seaplane is moored on the left side of the dock.

1. Board it, then press **R** to open the throttle and taxi out to open water.
2. Once you're going fast enough (around 45 knots), hold **S** to lift the nose and take off.
3. Bank with **A/D** to turn. The plane levels itself when you let go.
4. Fly too slowly and you'll stall: the nose drops until you build speed back up.
5. Land on the sea with a gentle, level descent. Diving in steeply, landing banked, or hitting the island, trees, lighthouse, dock or boat is a crash, and the plane is towed back to the dock.

Planes turn back automatically at the edge of the map.

## Running locally

The game uses ES modules, so browsers won't run it straight from a double-clicked file. Start a small local server in the project folder instead:

```bash
npx serve .
# or
python -m http.server 8000
```

Then open the address it prints (e.g. http://localhost:8000).

## Hosting on GitHub Pages

1. Push the repo to GitHub.
2. Go to **Settings → Pages**.
3. Under "Build and deployment", choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
4. Your game will be live at `https://<username>.github.io/<repo-name>/` after a minute or so.

## Project structure

```
index.html   page, overlay and three.js import map
style.css    UI styling
main.js      scene, island terrain, props, walking, boarding and the chase camera
boat.js      sailboat model and sailing physics
plane.js     seaplane model and arcade flight physics
water.js     ocean shader and wave maths (shared with floating objects)
textures/    grass, dirt, sand and leaves textures
```

## Roadmap

- [x] Walkable 3D world
- [x] Basic sailing
- [x] Flyable seaplane
- [ ] Multiplayer (e.g. Node.js + WebSockets server)
- [ ] Naval combat
