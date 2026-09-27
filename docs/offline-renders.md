# Offline renders

There is no browser and no GPU in the build sandbox, so geometry cannot be checked by
looking at it in the game. `scripts/raster.ts` is a small CPU rasteriser that fixes that:
it walks a three.js object tree, projects the triangles orthographically, z-buffers them
and writes a PNG. No GPU, no headless Chrome, no dependencies beyond `node:zlib`.

```bash
node --import ./tests/helpers/register-json.js scripts/render-gun.ts all
node --import ./tests/helpers/register-json.js scripts/render-gun.ts aug_a3 /tmp/out
```

Output lands in `docs/renders/weapons/<id>-<view>.png`.

## Why it is set up the way it is

- **Orthographic, not perspective.** Perspective hides the thing you are hunting for. A
  magazine that stops 3 mm short of its well looks seated from any angle with a vanishing
  point in it.
- **Side elevation is the useful view.** Top and iso are included, but nearly every
  modelling error this has caught was visible in the elevation and invisible elsewhere.
- **Clay by default.** The weapon finishes are near-black OD green and gunmetal. Rendered
  in their own colours the models are dark blobs; a uniform neutral clay turns a 2 mm
  step into a visible shading break. Pass `clay: false` to check the actual finish.
- **Flat shading, no specular.** A highlight will happily paper over a crack.
- **Backfaces are kept.** A missing backface is itself a bug worth seeing.
- **A 5 cm grid** is drawn behind the model so gaps can be estimated by eye.
- **The support arm is hidden** in weapon renders — it covers the joints being inspected.

## Limits

This is a verification tool, not a preview. It has no textures, no shadows, no
transparency and no anti-aliasing. It tells you where the geometry is, which is the only
question it was built to answer.
