# Tiny Swords v2 visual upgrade — pack study + implementation plan

User direction (Aug 11): smaller tiles / much bigger map with water+foam
margins; REAL elevation levels (different tilemap colors per height, stairs,
climbable); trees/rocks/bushes; bigger sheep; water rocks + rubber ducks;
moving cloud layer on top; new-pack Pawn as the character (recolored clothes);
splash animation on water falls; USER WILL SUPPLY custom spritesheets for
bomb-carry and bomb-throw; pack explosion FX + ragdoll-toward-camera launch.
Reference: new Tiny Swords store-page look (blue-gray cliffs, layered island).

## Pack inventory (`assets-src/ts_new/Tiny Swords (Free Pack)/`)

- **Units/<Color> Units/Pawn/** — colors: Black, Blue, Purple, Red, Yellow (5!).
  Separate file per animation, all 192px frames:
  - `Pawn_Idle.png` 1536x192 = **8 frames**; `Pawn_Run.png` 1152x192 = **6 frames**
  - `Pawn_Idle Wood.png` / `Pawn_Run Wood.png` = carrying-overhead variants →
    interim bomb-carry (draw dynamite over the wood) until user's custom sheets
  - Also Idle/Run with Axe/Gold/Hammer/Knife/Meat/Pickaxe; `Pawn_Interact *`
  - Aseprite sources in `Units/Units (aseprite in Blue only)/`
- **Terrain/Tileset/**: `Tilemap_color1..5.png` (576x384 = 9x6 tiles of 64) —
  **5 color variants = elevation levels**; `Water Background color.png`;
  `Water Foam.png`; `Shadow.png` (192). Layout per official tilemap guide
  (devlog 1138989): six modular components — background water color, water
  foam, flat ground, shadows, elevated ground (two cliff faces), stairs.
  Probe each 9x6 sheet at build time OR hand-map once in an ASCII sketch.
- **Particle FX/**: `Explosion_01/02.png` (1536x192 = 8 frames of 192),
  `Water Splash.png` (1728x192 = **9 frames** — falling-in-water anim),
  `Fire_01..03`.
- **Terrain/Decorations/**: `Clouds/Clouds_01..08.png` (576x256 each — big
  drifting cloud sprites for the top layer); `Rocks/Rock1..4`; `Rocks in the
  Water/Water Rocks_01..04.png` (1024x64 = 16 frames of 64, animated);
  `Rubber Duck/Rubber duck.png` (96x32 = 3 frames of 32); `Bushes/Bushe1..4`.
- **Terrain/Resources/**: `Meat/Sheep/Sheep_Idle.png` (768x128 = 6f),
  `Sheep_Move.png` (512x128 = 4f), `Sheep_Grass`; Trees `Tree1..4.png`
  (1536x256 = 6 frames of 256) + stumps; Gold/Wood/Tools props.
- **Buildings/** in 5 colors (Castle/House/Tower — optional set dressing).
- **UI Elements/**: Banners, Ribbons, Bars, Buttons, Icons, Papers, and
  **Human Avatars** (ready-made portraits for HUD cards!).

## Implementation plan (next session)

1. **Curate v2 sprites** into `public/sprites/v2/`: 5 pawn colors
   (Idle/Run/Idle Wood/Run Wood), Tilemap_color1..3 (3 elevation levels
   enough), Water Background, Water Foam, Shadow, Explosion_01, Water Splash,
   Clouds 1-4, Rock1-4, Water Rocks 1-2, Rubber duck, Sheep idle/move,
   Tree1-2, Bushe1-4, a few UI avatars/banners. Update `.gitignore` note.
2. **Map the 9x6 tilemap layout**: PIL-probe `Tilemap_color1.png` per-cell
   (like the old 4x4 probe) against the devlog guide: flat-ground blob,
   elevated-ground cliff tiles (terrain-facing + water-facing), stairs strip.
   Record exact (col,row) mapping as constants in assets code.
3. **Sim: real elevation levels.** Island grid gains `level: 0|1|2` per cell
   (0 = lowest ground). Movement rule: can walk within same level; can change
   level ONLY via stair cells; walking off a cliff edge = blocked (or drop
   down one level with a hop, designer's pick — start with blocked).
   Generation: base blob level0 → smaller level1 patch(es) on top → rare
   level2; stairs placed on patch edges (1-2 per patch, guaranteed).
   Bombs: blast lowers cell one level (2→1→0→water). Grid ~26x16 at
   TILE 64 (ARENA 1664x1024) = smaller-looking tiles, much bigger map,
   1-2 water-margin cells each side.
4. **Renderer v2**: per-level tile pass using Tilemap_colorN (level0=color1,
   level1=color2, level2=color3) with the guide's cliff-face tiles under
   south edges of raised patches + stairs tiles; water bg + foam margins;
   drifting cloud sprites layer ABOVE everything (slow parallax, alpha ~.9,
   also over water like the reference); animated water rocks + rubber ducks
   in open water; trees (animated 6f)/rocks/bushes as deco — trees block
   movement (cover); sheep drawn ~96px (bigger per user), idle/move anims.
5. **Pawn v2**: 5 pack colors + 3 hue-rotated = 8 slots. Idle 8f / Run 6f;
   carrier = `* Wood` sheets with dynamite drawn atop the carried bundle
   (until user's custom carry/throw sheets arrive — leave a clean hook:
   `PAWN_SHEETS.carry/throw` swappable file names).
   Water fall: play `Water Splash.png` 9f at the fall point (replaces ring).
   Launched: keep tumble but add scale-up-then-down (toward camera) per user.
   Explosion: Explosion_01 8f.
6. **HUD**: try pack `Human Avatars` for portraits instead of sheet crops.
7. Tests: elevation movement rules (stairs only), blast lowers level.

## Notes / risks

- New pack is pay-what-you-want (not CC0 like the old zip) — fine to ship in
  a game, don't redistribute raw pack; keep curating only used sprites.
- Old-pack sprites currently in `public/sprites/` (dynamite, TNT goblins,
  old tilemap) stay until v2 lands; dynamite.png (old pack, CC0) remains the
  bomb sprite — style-compatible.
- User's custom bomb-carry/throw spritesheets: integrate when delivered;
  design the pawn animation table so those are drop-in file swaps.
