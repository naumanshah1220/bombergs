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
  let stairsFlip = new Set<number>();
  let skins: number[] = new Array(GRID_COLS * GRID_ROWS).fill(1);
  let topSkins: number[] = new Array(GRID_COLS * GRID_ROWS).fill(1);
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
        <button id="mimport" style="width:100%;margin-top:6px;padding:6px;background:#131a3a;color:#eaf6ff;border:1px solid #29B6F6;border-radius:6px">⬆ import JSON</button>
        <input id="mfile" type="file" accept=".json" style="display:none"/>
        <button id="mclear" style="width:100%;margin-top:6px;padding:6px;background:#131a3a;color:#eaf6ff;border:1px solid #29B6F6;border-radius:6px">🧹 clear map</button>
        <div style="opacity:.5;margin-top:10px">paint: click/drag · deco: click to place,
          click again to select · <a href="/" style="color:#29B6F6">back to game</a></div>
      </div>
      <div style="flex:1 1 0;min-width:0;position:relative">
        <canvas id="mcanvas" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
      </div>
    </div>`;

  const toolsDiv = document.getElementById('tools')!;
  const terrainTools: [Tool, string][] = [['water', '🌊 water'], ['ground', '🟩 ground'], ['plateau', '⬛ plateau'], ['stair', '🪜 stairs ◀'], ['stairflip', '🪜 stairs ▶']];
  const groups: [string, [Tool, string][]][] = [
    ['TILES', terrainTools],
    ['DECO', DECO_LIB.filter((d) => !d.startsWith('bld_')).map((d) => [d, `🌳 ${d}`] as [Tool, string])],
    ['BUILDINGS', DECO_LIB.filter((d) => d.startsWith('bld_')).map((d) => [d, `🏰 ${d.slice(4)}`] as [Tool, string])],
  ];
  const allButtons: HTMLButtonElement[] = [];
  for (const [title, tools] of groups) {
    const det = document.createElement('details');
    det.open = title === 'TILES';
    const sum = document.createElement('summary');
    sum.textContent = title;
    sum.style.cssText = 'font-weight:800;margin:8px 0 4px;cursor:pointer;opacity:.8';
    det.appendChild(sum);
    for (const [id, label] of tools) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'display:block;width:100%;margin:2px 0;padding:6px;border-radius:6px;border:1px solid #29B6F6;background:#131a3a;color:#eaf6ff;text-align:left';
      b.addEventListener('click', () => {
        tool = id;
        allButtons.forEach((el) => (el.style.background = '#131a3a'));
        b.style.background = '#29B6F6';
      });
      allButtons.push(b);
      det.appendChild(b);
    }
    toolsDiv.appendChild(det);
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
    if (tool === 'water') { cells[idx] = 0; stairs.delete(idx); stairsFlip.delete(idx); }
    else if (tool === 'ground') { cells[idx] = 1; skins[idx] = skin; stairs.delete(idx); stairsFlip.delete(idx); }
    else if (tool === 'plateau') {
      if (cells[idx] === 0) skins[idx] = skin; // plateau on water: ground layer inherits
      cells[idx] = 2; topSkins[idx] = skin; stairs.delete(idx); stairsFlip.delete(idx);
    } else if (tool === 'stair') {
      if (cells[idx] === 0) skins[idx] = skin;
      cells[idx] = 2; topSkins[idx] = skin; stairs.add(idx); stairsFlip.delete(idx);
    } else if (tool === 'stairflip') {
      if (cells[idx] === 0) skins[idx] = skin;
      cells[idx] = 2; topSkins[idx] = skin; stairs.add(idx); stairsFlip.add(idx);
    }
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
    topSkins = new Array(GRID_COLS * GRID_ROWS).fill(1);
    stairs = new Set();
    stairsFlip = new Set();
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
    levels[name] = { name, skin, skins: [...skins], topSkins: [...topSkins], cols: GRID_COLS, rows: GRID_ROWS, cells: [...cells], stairs: [...stairs], stairsFlip: [...stairsFlip], deco: [...deco] };
    saveLevels(levels);
    refreshLoad();
    alert(`saved "${name}" — it's now in the lobby's level picker`);
  });
  loadSel.addEventListener('change', () => {
    const lv = loadLevels()[loadSel.value];
    if (!lv) return;
    cells = [...lv.cells] as Cell[];
    stairs = new Set(lv.stairs);
    stairsFlip = new Set(lv.stairsFlip ?? []);
    skin = lv.skin ?? 1;
    skins = lv.skins ? [...lv.skins] : new Array(GRID_COLS * GRID_ROWS).fill(skin);
    topSkins = lv.topSkins ? [...lv.topSkins] : [...skins];
    (document.getElementById('mskin') as HTMLSelectElement).value = String(skin);
    deco = lv.deco.map((d) => ({ ...d }));
    nameInput.value = lv.name;
    selected = -1;
  });
  document.getElementById('mimport')!.addEventListener('click', () => {
    (document.getElementById('mfile') as HTMLInputElement).click();
  });
  (document.getElementById('mfile') as HTMLInputElement).addEventListener('change', (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    file.text().then((txt) => {
      try {
        const lv = JSON.parse(txt) as LevelData;
        cells = [...lv.cells] as Cell[];
        skins = lv.skins ? [...lv.skins] : new Array(GRID_COLS * GRID_ROWS).fill(lv.skin ?? 1);
        topSkins = lv.topSkins ? [...lv.topSkins] : [...skins];
        stairs = new Set(lv.stairs);
        stairsFlip = new Set(lv.stairsFlip ?? []);
        deco = (lv.deco ?? []).map((d) => ({ ...d }));
        nameInput.value = lv.name ?? 'imported';
        selected = -1;
      } catch {
        alert('could not read that file as a level');
      }
    });
  });
  // continuous autosave: crash/reload insurance, shows up in the load list
  setInterval(() => {
    const levels = loadLevels();
    levels['(autosave)'] = {
      name: '(autosave)', skin, skins: [...skins], topSkins: [...topSkins],
      cols: GRID_COLS, rows: GRID_ROWS, cells: [...cells],
      stairs: [...stairs], stairsFlip: [...stairsFlip], deco: [...deco],
    };
    saveLevels(levels);
    refreshLoad();
  }, 3000);
  document.getElementById('mexport')!.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'level';
    const blob = new Blob([JSON.stringify({ name, skin, skins, topSkins, cols: GRID_COLS, rows: GRID_ROWS, cells, stairs: [...stairs], stairsFlip: [...stairsFlip], deco }, null, 1)], { type: 'application/json' });
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
    const sheetTopFor = (idx: number) =>
      (assets.img as Record<string, HTMLImageElement>)['tilemap' + (topSkins[idx] ?? 1)] ?? assets.img.tilemap1;
    const pat = ctx.createPattern(assets.img.water, 'repeat');
    if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, ARENA_W, ARENA_H); }
    // auto-foam preview: the game foams every shore edge by itself
    const foamFrame = Math.floor(t * 10) % 16;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (!land(c, r)) continue;
        if (land(c - 1, r) && land(c + 1, r) && land(c, r - 1) && land(c, r + 1)) continue;
        ctx.drawImage(assets.img.foam, foamFrame * 192, 0, 192, 192, c * TILE + TILE / 2 - 96, r * TILE + TILE / 2 - 96, 192, 192);
      }
    }
    drawDeco(true);
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (!land(c, r)) continue;
        const sk = skins[r * GRID_COLS + c];
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= GRID_COLS || nr >= GRID_ROWS) continue;
          if (cells[nr * GRID_COLS + nc] >= 1 && skins[nr * GRID_COLS + nc] !== sk) {
            ctx.drawImage(sheetFor(nr * GRID_COLS + nc), 64, 64, 64, 64, c * TILE, r * TILE, TILE, TILE);
            break;
          }
        }
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
        ctx.drawImage(assets.img.shadow, c * TILE + TILE / 2 - 96, r * TILE + TILE / 2 - 96 + 10, 192, 192);
        if (stairs.has(idx)) {
          ctx.save();
          ctx.translate(c * TILE + TILE / 2, 0);
          if (stairsFlip.has(idx)) ctx.scale(-1, 1);
          ctx.drawImage(sheetTopFor(idx), 192, 256, 64, 128, -TILE / 2, r * TILE - TILE, TILE, TILE * 2);
          ctx.restore();
          continue;
        }
        const sk = topSkins[idx];
        const sameTop = (c2: number, r2: number) =>
          land(c2, r2, 2) && !stairs.has(r2 * GRID_COLS + c2) && topSkins[r2 * GRID_COLS + c2] === sk;
        const L = sameTop(c - 1, r); const R = sameTop(c + 1, r);
        const U = sameTop(c, r - 1); const D = sameTop(c, r + 1);
        if (!land(c, r + 1, 2)) {
          const wx = L && R ? 6 : R ? 5 : L ? 7 : 8;
          ctx.drawImage(sheetTopFor(idx), wx * 64, 4 * 64, 64, 64, c * TILE, r * TILE, TILE, TILE);
        }
        const sx = 320 + (L && R ? 1 : R ? 0 : L ? 2 : 3) * 64;
        const sy = (U && D ? 1 : D ? 0 : U ? 2 : 3) * 64;
        ctx.drawImage(sheetTopFor(idx), sx, sy, 64, 64, c * TILE, r * TILE - 64, TILE, TILE);
      }
    }
    drawDeco(false);
    function drawDeco(under: boolean): void { deco.forEach((d, i) => {
      const img = (assets.img as Record<string, HTMLImageElement>)[d.img];
      const meta = DECO_META[d.img];
      if (!img || !meta || Boolean(meta.under) !== under) return;
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
    }); }
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
