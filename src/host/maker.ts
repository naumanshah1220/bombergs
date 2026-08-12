// Map maker (?maker=1): paint terrain on the grid, place/scale/rotate deco,
// save named levels to localStorage, export/import JSON. Levels appear in
// the lobby's level picker.

import { ARENA_H, ARENA_W, GRID_COLS, GRID_ROWS } from '../sim/constants';
import { TILE, type Cell, type DecoItem, type LevelData } from '../sim/island';
import { DECO_META, type Assets } from './assets';

const STORE = 'bombergs-levels';

export function loadLevels(): Record<string, LevelData> {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { return {}; }
}

function saveLevels(levels: Record<string, LevelData>): void {
  localStorage.setItem(STORE, JSON.stringify(levels));
}

const DECO_LIB = Object.keys(DECO_META);
type Tool = 'water' | 'ground' | 'plateau' | 'stair' | string; // deco names too

export function startMaker(app: HTMLElement, assets: Assets): void {
  let cells: Cell[] = new Array(GRID_COLS * GRID_ROWS).fill(0) as Cell[];
  let stairs = new Set<number>();
  let skins: number[] = new Array(GRID_COLS * GRID_ROWS).fill(1);
  let deco: DecoItem[] = [];
  let tool: Tool = 'ground';
  let skin = 1; // tilemap color 1-5
  let selected = -1; // deco index
  let painting = false;

  app.innerHTML = `
    <div style="display:flex;height:100%;flex-direction:row">
      <div style="flex:0 0 240px;box-sizing:border-box;background:#0e1430;padding:12px;
           overflow-y:auto;font-size:13px;color:#eaf6ff">
        <div style="font-weight:800;font-size:17px;margin-bottom:8px">🛠 MAP MAKER</div>
        <label>grass color <select id="mskin" style="width:100%;padding:4px;background:#131a3a;color:#eaf6ff">
          <option value="1">color 1</option><option value="2">color 2</option>
          <option value="3">color 3</option><option value="4">color 4</option>
          <option value="5">color 5</option></select></label>
        <div id="tools"></div>
        <div style="margin:10px 0 4px;opacity:.6">SELECTED DECO</div>
        <label>scale <input id="mscale" type="range" min="0.3" max="2.5" step="0.05" value="1" style="width:100%"></label>
        <label>rotate <input id="mrot" type="range" min="-3.14" max="3.14" step="0.05" value="0" style="width:100%"></label>
        <button id="mdel" style="width:100%;margin-top:4px;padding:6px;background:#131a3a;color:#eaf6ff;border:1px solid #ff5a5f;border-radius:6px">🗑 delete selected</button>
        <div style="margin:12px 0 4px;opacity:.6">LEVEL</div>
        <input id="mname" placeholder="level name" style="width:100%;padding:6px;background:#131a3a;
          color:#eaf6ff;border:1px solid #29B6F6;border-radius:6px"/>
        <button id="msave" style="width:100%;margin-top:6px;background:#3DDC84;border:none;
          padding:8px;border-radius:8px;font-weight:700">💾 SAVE</button>
        <select id="mload" style="width:100%;margin-top:6px;padding:6px;background:#131a3a;color:#eaf6ff"></select>
        <button id="mexport" style="width:100%;margin-top:6px;padding:6px;background:#131a3a;color:#eaf6ff;border:1px solid #29B6F6;border-radius:6px">⬇ export JSON</button>
        <button id="mclear" style="width:100%;margin-top:6px;padding:6px;background:#131a3a;color:#eaf6ff;border:1px solid #29B6F6;border-radius:6px">🧹 clear map</button>
        <div style="opacity:.5;margin-top:10px">paint: click/drag · deco: click to place,
          click again to select · <a href="/" style="color:#29B6F6">back to game</a></div>
      </div>
      <div style="flex:1 1 0;min-width:0;position:relative">
        <canvas id="mcanvas" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
      </div>
    </div>`;

  const toolsDiv = document.getElementById('tools')!;
  const terrainTools: [Tool, string][] = [['water', '🌊 water'], ['ground', '🟩 ground'], ['plateau', '⬛ plateau'], ['stair', '🪜 stairs']];
  for (const [id, label] of [...terrainTools, ...DECO_LIB.map((d) => [d, `🌳 ${d}`] as [Tool, string])]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'display:block;width:100%;margin:2px 0;padding:6px;border-radius:6px;border:1px solid #29B6F6;background:#131a3a;color:#eaf6ff;text-align:left';
    b.addEventListener('click', () => {
      tool = id;
      [...toolsDiv.children].forEach((el) => ((el as HTMLElement).style.background = '#131a3a'));
      b.style.background = '#29B6F6';
    });
    toolsDiv.appendChild(b);
  }

  (document.getElementById('mskin') as HTMLSelectElement).addEventListener('change', (e) => {
    skin = Number((e.target as HTMLSelectElement).value);
  });
  const canvas = document.getElementById('mcanvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  function toWorld(e: MouseEvent): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    const scale = Math.min(canvas.width / ARENA_W, canvas.height / ARENA_H);
    const ox = (canvas.width - ARENA_W * scale) / 2;
    const oy = (canvas.height - ARENA_H * scale) / 2;
    return { x: ((e.clientX - r.left) * (canvas.width / r.width) - ox) / scale, y: ((e.clientY - r.top) * (canvas.height / r.height) - oy) / scale };
  }

  function applyPaint(x: number, y: number): void {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (c < 0 || r < 0 || c >= GRID_COLS || r >= GRID_ROWS) return;
    const idx = r * GRID_COLS + c;
    if (tool === 'water') { cells[idx] = 0; stairs.delete(idx); }
    else if (tool === 'ground') { cells[idx] = 1; skins[idx] = skin; stairs.delete(idx); }
    else if (tool === 'plateau') { cells[idx] = 2; skins[idx] = skin; stairs.delete(idx); }
    else if (tool === 'stair') { cells[idx] = 1; skins[idx] = skin; stairs.add(idx); }
  }

  canvas.addEventListener('mousedown', (e) => {
    const p = toWorld(e);
    if (DECO_LIB.includes(tool)) {
      // select if clicking near an existing piece, else place a new one
      const hit = deco.findIndex((d) => Math.hypot(d.x - p.x, d.y - p.y) < 40);
      if (hit >= 0) selected = hit;
      else { deco.push({ img: tool, x: p.x, y: p.y, scale: 1, rot: 0 }); selected = deco.length - 1; }
      const sel = deco[selected];
      (document.getElementById('mscale') as HTMLInputElement).value = String(sel.scale);
      (document.getElementById('mrot') as HTMLInputElement).value = String(sel.rot);
    } else {
      painting = true;
      applyPaint(p.x, p.y);
    }
  });
  canvas.addEventListener('mousemove', (e) => {
    if (painting) { const p = toWorld(e); applyPaint(p.x, p.y); }
  });
  window.addEventListener('mouseup', () => { painting = false; });

  (document.getElementById('mscale') as HTMLInputElement).addEventListener('input', (e) => {
    if (deco[selected]) deco[selected].scale = Number((e.target as HTMLInputElement).value);
  });
  (document.getElementById('mrot') as HTMLInputElement).addEventListener('input', (e) => {
    if (deco[selected]) deco[selected].rot = Number((e.target as HTMLInputElement).value);
  });
  document.getElementById('mdel')!.addEventListener('click', () => {
    if (selected >= 0) { deco.splice(selected, 1); selected = -1; }
  });
  document.getElementById('mclear')!.addEventListener('click', () => {
    cells = new Array(GRID_COLS * GRID_ROWS).fill(0) as Cell[];
    skins = new Array(GRID_COLS * GRID_ROWS).fill(1);
    stairs = new Set();
    deco = [];
    selected = -1;
  });

  const nameInput = document.getElementById('mname') as HTMLInputElement;
  const loadSel = document.getElementById('mload') as HTMLSelectElement;
  function refreshLoad(): void {
    const levels = loadLevels();
    loadSel.innerHTML = '<option value="">— load level —</option>'
      + Object.keys(levels).map((n) => `<option>${n}</option>`).join('');
  }
  refreshLoad();
  document.getElementById('msave')!.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { alert('name the level first'); return; }
    const levels = loadLevels();
    levels[name] = { name, skin, skins: [...skins], cols: GRID_COLS, rows: GRID_ROWS, cells: [...cells], stairs: [...stairs], deco: [...deco] };
    saveLevels(levels);
    refreshLoad();
    alert(`saved "${name}" — it's now in the lobby's level picker`);
  });
  loadSel.addEventListener('change', () => {
    const lv = loadLevels()[loadSel.value];
    if (!lv) return;
    cells = [...lv.cells] as Cell[];
    stairs = new Set(lv.stairs);
    skin = lv.skin ?? 1;
    skins = lv.skins ? [...lv.skins] : new Array(GRID_COLS * GRID_ROWS).fill(skin);
    (document.getElementById('mskin') as HTMLSelectElement).value = String(skin);
    deco = lv.deco.map((d) => ({ ...d }));
    nameInput.value = lv.name;
    selected = -1;
  });
  document.getElementById('mexport')!.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'level';
    const blob = new Blob([JSON.stringify({ name, skin, skins, cols: GRID_COLS, rows: GRID_ROWS, cells, stairs: [...stairs], deco }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.json`;
    a.click();
  });

  // --- render loop (simplified static view of the level) ---
  const land = (c: number, r: number, min = 1) =>
    c >= 0 && r >= 0 && c < GRID_COLS && r < GRID_ROWS && cells[r * GRID_COLS + c] >= min;
  const same = (c: number, r: number, min: number, sk: number) =>
    land(c, r, min) && skins[r * GRID_COLS + c] === sk;
  let t = 0;
  function draw(): void {
    t += 1 / 60;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    ctx.imageSmoothingEnabled = false;
    const scale = Math.min(canvas.width / ARENA_W, canvas.height / ARENA_H);
    ctx.fillStyle = '#2a3550';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate((canvas.width - ARENA_W * scale) / 2, (canvas.height - ARENA_H * scale) / 2);
    ctx.scale(scale, scale);
    const sheetFor = (idx: number) =>
      (assets.img as Record<string, HTMLImageElement>)['tilemap' + (skins[idx] ?? 1)] ?? assets.img.tilemap1;
    const pat = ctx.createPattern(assets.img.water, 'repeat');
    if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, ARENA_W, ARENA_H); }
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (!land(c, r)) continue;
        const sk = skins[r * GRID_COLS + c];
        const L = same(c - 1, r, 1, sk); const R = same(c + 1, r, 1, sk);
        const U = same(c, r - 1, 1, sk); const D = same(c, r + 1, 1, sk);
        const sx = (L && R ? 1 : R ? 0 : L ? 2 : 3) * 64;
        const sy = (U && D ? 1 : D ? 0 : U ? 2 : 3) * 64;
        ctx.drawImage(sheetFor(r * GRID_COLS + c), sx, sy, 64, 64, c * TILE, r * TILE, TILE, TILE);
      }
    }
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const idx = r * GRID_COLS + c;
        if (cells[idx] !== 2) continue;
        const sk = skins[idx];
        const L = same(c - 1, r, 2, sk); const R = same(c + 1, r, 2, sk);
        const U = same(c, r - 1, 2, sk); const D = same(c, r + 1, 2, sk);
        if (!land(c, r + 1, 2)) {
          const wx = L && R ? 6 : R ? 5 : L ? 7 : 8;
          ctx.drawImage(sheetFor(idx), wx * 64, 4 * 64, 64, 64, c * TILE, r * TILE + TILE - 40, TILE, TILE);
        }
        const sx = 320 + (L && R ? 1 : R ? 0 : L ? 2 : 3) * 64;
        const sy = (U && D ? 1 : D ? 0 : U ? 2 : 3) * 64;
        ctx.drawImage(sheetFor(idx), sx, sy, 64, 64, c * TILE, r * TILE - 20, TILE, TILE);
      }
    }
    for (const sidx of stairs) {
      const sc2 = sidx % GRID_COLS;
      const sr2 = Math.floor(sidx / GRID_COLS);
      ctx.drawImage(sheetFor(sidx), 192, 256, 64, 128, sc2 * TILE, sr2 * TILE - TILE + 12, TILE, TILE * 2);
    }
    deco.forEach((d, i) => {
      const img = (assets.img as Record<string, HTMLImageElement>)[d.img];
      const meta = DECO_META[d.img];
      if (!img || !meta) return;
      const fw = meta.fw;
      const size = fw * d.scale;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.drawImage(img, 0, 0, fw, img.height, -size / 2, -size * 0.7, size, size * (img.height / fw));
      if (i === selected) {
        ctx.strokeStyle = '#3DDC84';
        ctx.lineWidth = 3;
        ctx.strokeRect(-size / 2, -size * 0.7, size, size * (img.height / fw));
      }
      ctx.restore();
    });
    // grid overlay
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= GRID_COLS; c++) { ctx.beginPath(); ctx.moveTo(c * TILE, 0); ctx.lineTo(c * TILE, ARENA_H); ctx.stroke(); }
    for (let r = 0; r <= GRID_ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * TILE); ctx.lineTo(ARENA_W, r * TILE); ctx.stroke(); }
    ctx.restore();
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
