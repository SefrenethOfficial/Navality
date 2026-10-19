# Naval Game (prototype)

A 3D multiplayer naval game built with [three.js](https://threejs.org/). Right now it's a walkable harbour island: an ocean with animated waves, a dock, a moored boat, a lighthouse and trees.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump |
| Esc | Release mouse |

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
main.js      scene, island, water, player movement and collisions
```

## Roadmap

- [x] Walkable 3D world
- [ ] Boardable, steerable ships
- [ ] Multiplayer (e.g. Node.js + WebSockets server)
- [ ] Naval combat
