# Paper Toss

Delete files the satisfying way. The bin stands at the far end of the room (top
middle of the screen). Pick one or more files, watch each one crumple into a
paper ball in your hand (bottom middle), then pull it back toward you and let
go to throw it into the bin. An item goes to the Recycle Bin **only if its
throw lands**. Each item gets two throws. If both miss, it survives.

## Run

```bash
npm install
npm start          # the desktop app (Electron)
npm run demo       # browser demo at http://localhost:5173 (fake files, nothing is touched)
npm test           # filesystem safety tests
npm run smoke      # boots the real app hidden + recycles one temp file
```

## How to play

1. Press **Pick file(s)** (multi-select) or **Pick a folder**, or drop files onto
   the window.
2. Check the list and press **Crumple** in the bottom sheet. Folders need an extra tick.
3. **Grab** the ball, **pull it down/back toward you** and **let go**. How far you
   pull sets the distance. Pulling left aims right and vice versa, like a
   slingshot. The dots preview the start of the arc. A quick upward flick as
   you release adds power, and a flick on its own also throws.
4. Miss? Click the ball where it landed to pick it up for your last throw.
5. **Keep it** (or **Esc**) skips the current item. **Stop all** keeps it and
   everything still waiting. Nothing is touched.
6. A summary lists what went in the bin, what survived and anything the OS
   refused, with an option to try the survivors again.

## Layout

```
src/
  main/
    main.js           Electron window + IPC handlers
    fileOps.js        Filesystem safety layer (select → token → verified trash)
  preload/
    preload.js        Narrow contextBridge API (pick / release / trash-by-token)
  renderer/
    index.html, styles.css
    js/
      main.js               Entry point
      app/app.js            State machine tying it all together
      fs/fileService.js     Electron bridge, or demo fallback in a browser
      physics/world.js      3D ball physics (metres): gravity, drag, room, contact resolver
      input/throwController.js  Grab / pull back / release + flick velocity
      anim/crumple.js       3D paper mesh: folds, crumple, textured triangles
      anim/paperTexture.js  Draws the file onto the sheet of paper
      anim/easing.js        Easing, PRNG, tween runner
      scene/camera.js       Perspective camera (world ↔ screen)
      scene/scene.js        Layout + per-frame composition, depth-ordered
      scene/trashCan.js     3D can: walls, rim torus, hinged lid disc, lid spring, drawing
      scene/room.js         Static perspective room (walls, floor, window, rug, plant)
      scene/effects.js      Dust, rings, confetti
      audio/sound.js        Synthesised Web Audio effects
      ui/ui.js, ui/format.js  Pick dock, bottom sheet, HUD, toasts (text-only DOM)
test/fileOps.test.js
scripts/serve-demo.js, scripts/smoke.js
```

## Safety model

- **Nothing changes until the ball is in the bin.** The only call that touches
  the filesystem is in `App._performTrash`, which runs only after the ball has
  dropped through the opening and the lid has slammed shut.
- **Tokens, not paths.** When you pick items, the main process inspects each one
  and returns an opaque, single-use token per item (max 25 per pick). The UI can
  only ask to trash *a token*. A new pick invalidates every earlier token.
  Duplicates are merged, and items inside a picked folder are skipped since
  they go with the folder.
- **Identity re-check.** Right before trashing, the item's device + file ID and
  type are compared with what you picked. A missing, replaced, or retyped item
  is left alone.
- **Recycle Bin only.** Items go through `shell.trashItem`. There is no
  permanent-delete code path. If the OS can't recycle the item (too large,
  locked, no permission), it stays where it is and you see why.
- **Protected locations.** Drive roots, your home folder and its parents,
  Windows / Program Files / ProgramData and the app's own folder are refused.
- **Post-check.** After the OS reports success, the app checks that the item
  really left its original location.
- **Safe display.** File names and paths are inserted as text, never HTML, and
  no shell commands are used anywhere.
- The renderer runs with `sandbox`, `contextIsolation` and a strict CSP. It
  can't navigate or open windows.
