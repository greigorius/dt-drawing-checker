import { useRef, useEffect, useCallback, useState } from 'react';

// ─── Image cache ───────────────────────────────────────────────────────────
const _imgCache = new Map();
function getCachedImage(src) {
  if (_imgCache.has(src)) return _imgCache.get(src);
  const img = new Image();
  img.src = src;
  _imgCache.set(src, img);
  return img;
}

// ─── Bounding box (fractional coords) ─────────────────────────────────────
export function getBoundingBox(obj) {
  switch (obj?.type) {
    case 'stroke': {
      if (!obj.points?.length) return null;
      const xs = obj.points.map(p => p.x), ys = obj.points.map(p => p.y);
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    }
    case 'highlight':
    case 'rect':
      return { x1: Math.min(obj.x1, obj.x2), y1: Math.min(obj.y1, obj.y2),
               x2: Math.max(obj.x1, obj.x2), y2: Math.max(obj.y1, obj.y2) };
    case 'ellipse':
      return { x1: obj.cx - obj.rx, y1: obj.cy - obj.ry, x2: obj.cx + obj.rx, y2: obj.cy + obj.ry };
    case 'line':
    case 'arrow':
      return { x1: Math.min(obj.x1, obj.x2), y1: Math.min(obj.y1, obj.y2),
               x2: Math.max(obj.x1, obj.x2), y2: Math.max(obj.y1, obj.y2) };
    case 'text':
      return { x1: obj.x, y1: obj.y, x2: obj.x + 0.14, y2: obj.y + (obj.fontSizeFrac ?? 0.025) * 2 };
    case 'image':
      return { x1: obj.x, y1: obj.y, x2: obj.x + obj.w, y2: obj.y + obj.h };
    default: return null;
  }
}

// ─── Translate an object by fractional delta ───────────────────────────────
function translateObject(obj, dx, dy) {
  switch (obj.type) {
    case 'stroke':
      return { ...obj, points: obj.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
    case 'highlight':
    case 'rect':
    case 'line':
    case 'arrow':
      return { ...obj, x1: obj.x1 + dx, y1: obj.y1 + dy, x2: obj.x2 + dx, y2: obj.y2 + dy };
    case 'ellipse':
      return { ...obj, cx: obj.cx + dx, cy: obj.cy + dy };
    case 'text':
    case 'image':
      return { ...obj, x: obj.x + dx, y: obj.y + dy };
    default: return obj;
  }
}

// ─── Replay all committed sketch objects ────────────────────────────────────
export function replaySketchObjects(ctx, objects, w, h) {
  if (!objects?.length) return;
  for (const obj of objects) {
    ctx.save();
    try {
      switch (obj.type) {
        case 'stroke': {
          if (!obj.points || obj.points.length < 2) break;
          ctx.strokeStyle = obj.color; ctx.lineWidth = obj.width;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(obj.points[0].x * w, obj.points[0].y * h);
          for (let i = 1; i < obj.points.length; i++) ctx.lineTo(obj.points[i].x * w, obj.points[i].y * h);
          ctx.stroke();
          break;
        }
        case 'highlight': {
          ctx.fillStyle = 'rgba(255, 230, 0, 0.35)';
          ctx.fillRect(Math.min(obj.x1,obj.x2)*w, Math.min(obj.y1,obj.y2)*h,
            Math.abs(obj.x2-obj.x1)*w, Math.abs(obj.y2-obj.y1)*h);
          break;
        }
        case 'rect': {
          ctx.strokeStyle = obj.color; ctx.lineWidth = obj.width;
          ctx.strokeRect(Math.min(obj.x1,obj.x2)*w, Math.min(obj.y1,obj.y2)*h,
            Math.abs(obj.x2-obj.x1)*w, Math.abs(obj.y2-obj.y1)*h);
          break;
        }
        case 'ellipse': {
          ctx.strokeStyle = obj.color; ctx.lineWidth = obj.width;
          ctx.beginPath();
          ctx.ellipse(obj.cx*w, obj.cy*h, Math.max(1,obj.rx*w), Math.max(1,obj.ry*h), 0, 0, 2*Math.PI);
          ctx.stroke();
          break;
        }
        case 'line': {
          ctx.strokeStyle = obj.color; ctx.lineWidth = obj.width; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(obj.x1*w, obj.y1*h); ctx.lineTo(obj.x2*w, obj.y2*h); ctx.stroke();
          break;
        }
        case 'arrow': {
          const ax1=obj.x1*w, ay1=obj.y1*h, ax2=obj.x2*w, ay2=obj.y2*h;
          ctx.strokeStyle=obj.color; ctx.fillStyle=obj.color; ctx.lineWidth=obj.width; ctx.lineCap='round';
          ctx.beginPath(); ctx.moveTo(ax1,ay1); ctx.lineTo(ax2,ay2); ctx.stroke();
          const angle=Math.atan2(ay2-ay1,ax2-ax1), hl=Math.max(10,obj.width*5);
          ctx.beginPath(); ctx.moveTo(ax2,ay2);
          ctx.lineTo(ax2-hl*Math.cos(angle-Math.PI/6), ay2-hl*Math.sin(angle-Math.PI/6));
          ctx.lineTo(ax2-hl*Math.cos(angle+Math.PI/6), ay2-hl*Math.sin(angle+Math.PI/6));
          ctx.closePath(); ctx.fill();
          break;
        }
        case 'text': {
          const fs = Math.max(8, (obj.fontSizeFrac ?? 0.025) * h);
          ctx.fillStyle = obj.color; ctx.font = `${fs}px sans-serif`; ctx.textBaseline = 'top';
          (obj.content || '').split('\n').forEach((line, li) => ctx.fillText(line, obj.x*w, obj.y*h + li*fs*1.3));
          break;
        }
        case 'image': {
          const img = getCachedImage(obj.dataUrl);
          if (img.complete && img.naturalWidth > 0) ctx.drawImage(img, obj.x*w, obj.y*h, obj.w*w, obj.h*h);
          break;
        }
      }
    } catch { /* skip broken object */ }
    ctx.restore();
  }
}

// ─── Async version (pre-loads images) used by export ──────────────────────
export async function replaySketchObjectsAsync(ctx, objects, w, h) {
  if (!objects?.length) return;
  const imgs = objects.filter(o => o.type === 'image');
  await Promise.all(imgs.map(o => new Promise(res => {
    const img = getCachedImage(o.dataUrl);
    if (img.complete) { res(); return; }
    img.onload = res; img.onerror = res;
  })));
  replaySketchObjects(ctx, objects, w, h);
}

// ─── Selection bounding-box overlay ───────────────────────────────────────
function drawSelectionBox(ctx, obj, w, h) {
  const bb = getBoundingBox(obj);
  if (!bb) return;
  const PAD = 6;
  const x  = bb.x1 * w - PAD,    y  = bb.y1 * h - PAD;
  const bw = (bb.x2 - bb.x1) * w + PAD * 2;
  const bh = (bb.y2 - bb.y1) * h + PAD * 2;
  ctx.save();
  ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
  ctx.strokeRect(x, y, bw, bh);
  ctx.setLineDash([]);
  // Corner + midpoint handles
  const hx = [x, x + bw/2, x + bw], hy = [y, y + bh/2, y + bh];
  ctx.fillStyle = '#1d4ed8';
  for (const hxi of hx) for (const hyi of hy) {
    if (hxi === x + bw/2 && hyi === y + bh/2) continue; // skip centre
    ctx.fillRect(hxi - 3.5, hyi - 3.5, 7, 7);
  }
  ctx.restore();
}

// ─── Preview shape during drag ─────────────────────────────────────────────
function drawPreview(ctx, tool, start, current, points, color, width, w, h) {
  if (!start || !current) return;
  ctx.save();
  switch (tool) {
    case 'pen': {
      if (!points?.length || points.length < 2) break;
      ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.beginPath(); ctx.moveTo(points[0].x*w, points[0].y*h);
      for (let i=1;i<points.length;i++) ctx.lineTo(points[i].x*w, points[i].y*h);
      ctx.stroke(); break;
    }
    case 'highlight':
      ctx.fillStyle='rgba(255,230,0,0.35)';
      ctx.fillRect(Math.min(start.fracX,current.fracX)*w, Math.min(start.fracY,current.fracY)*h,
        Math.abs(current.fracX-start.fracX)*w, Math.abs(current.fracY-start.fracY)*h);
      break;
    case 'rect':
      ctx.strokeStyle=color; ctx.lineWidth=width;
      ctx.strokeRect(Math.min(start.fracX,current.fracX)*w, Math.min(start.fracY,current.fracY)*h,
        Math.abs(current.fracX-start.fracX)*w, Math.abs(current.fracY-start.fracY)*h);
      break;
    case 'ellipse': {
      const ecx=((start.fracX+current.fracX)/2)*w, ecy=((start.fracY+current.fracY)/2)*h;
      const erx=Math.max(1,Math.abs(current.fracX-start.fracX)/2*w);
      const ery=Math.max(1,Math.abs(current.fracY-start.fracY)/2*h);
      ctx.strokeStyle=color; ctx.lineWidth=width;
      ctx.beginPath(); ctx.ellipse(ecx,ecy,erx,ery,0,0,2*Math.PI); ctx.stroke(); break;
    }
    case 'arrow': {
      const ax1=start.fracX*w, ay1=start.fracY*h, ax2=current.fracX*w, ay2=current.fracY*h;
      ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=width; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(ax1,ay1); ctx.lineTo(ax2,ay2); ctx.stroke();
      const angle=Math.atan2(ay2-ay1,ax2-ax1), hl=Math.max(10,width*5);
      ctx.beginPath(); ctx.moveTo(ax2,ay2);
      ctx.lineTo(ax2-hl*Math.cos(angle-Math.PI/6), ay2-hl*Math.sin(angle-Math.PI/6));
      ctx.lineTo(ax2-hl*Math.cos(angle+Math.PI/6), ay2-hl*Math.sin(angle+Math.PI/6));
      ctx.closePath(); ctx.fill(); break;
    }
    case 'line':
      ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(start.fracX*w, start.fracY*h);
      ctx.lineTo(current.fracX*w, current.fracY*h); ctx.stroke(); break;
  }
  ctx.restore();
}

// ─── Hit test ─────────────────────────────────────────────────────────────
function hitTest(obj, px, py, w, h) {
  const THRESH = 12;
  const tx = THRESH/w, ty = THRESH/h;
  switch (obj.type) {
    case 'stroke':
      return (obj.points||[]).some(pt => Math.hypot((pt.x-px)*w,(pt.y-py)*h) < THRESH);
    case 'highlight':
    case 'rect': {
      const x1=Math.min(obj.x1,obj.x2), x2=Math.max(obj.x1,obj.x2);
      const y1=Math.min(obj.y1,obj.y2), y2=Math.max(obj.y1,obj.y2);
      return px>=x1-tx && px<=x2+tx && py>=y1-ty && py<=y2+ty;
    }
    case 'ellipse': {
      if (!obj.rx||!obj.ry) return false;
      const nd=Math.abs(((px-obj.cx)/obj.rx)**2 + ((py-obj.cy)/obj.ry)**2 - 1);
      return nd < 0.3;
    }
    case 'line':
    case 'arrow': {
      const ldx=obj.x2-obj.x1, ldy=obj.y2-obj.y1;
      const len2=ldx*ldx*w*w+ldy*ldy*h*h;
      if (len2===0) return false;
      const t=Math.max(0,Math.min(1,((px-obj.x1)*ldx*w*w+(py-obj.y1)*ldy*h*h)/len2));
      return Math.hypot((px-(obj.x1+t*ldx))*w,(py-(obj.y1+t*ldy))*h) < THRESH;
    }
    case 'text':
      return Math.abs(px-obj.x)*w < 70 && Math.abs(py-obj.y)*h < 36;
    case 'image':
      return px>=obj.x && px<=obj.x+obj.w && py>=obj.y && py<=obj.y+obj.h;
    default: return false;
  }
}

// ─── Cursor per tool ──────────────────────────────────────────────────────
export function toolCursor(tool) {
  switch (tool) {
    case 'pan':    return 'grab';
    case 'select': return 'default';
    case 'text':   return 'text';
    case 'eraser': return 'cell';
    default:       return 'crosshair';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SketchCanvas
// ═══════════════════════════════════════════════════════════════════════════
export default function SketchCanvas({
  sketches = [],
  onAddObject,
  onRemoveObject,
  onUpdateObject,       // (index, newObj) => void  — for move
  activeTool,
  activeColor,
  activeWidth,
  activeFontSizeFrac,
  canvasDims,
}) {
  const canvasRef         = useRef(null);
  const isDrawingRef      = useRef(false);
  const startPosRef       = useRef(null);
  const currentPosRef     = useRef(null);
  const strokePointsRef   = useRef([]);
  const dragStartObjRef   = useRef(null);   // original object before move drag
  const dragLiveObjRef    = useRef(null);   // live preview during move drag
  const cssDimsRef        = useRef({ w: 0, h: 0 });

  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [textInput,     setTextInput]     = useState(null);

  // Clear selection when tool changes
  useEffect(() => {
    if (activeTool !== 'select') setSelectedIndex(-1);
  }, [activeTool]);

  // ── Resize canvas ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasDims.width || !canvasDims.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.floor(canvasDims.width  * dpr);
    canvas.height = Math.floor(canvasDims.height * dpr);
    canvas.style.width  = `${canvasDims.width}px`;
    canvas.style.height = `${canvasDims.height}px`;
    cssDimsRef.current = { w: canvasDims.width, h: canvasDims.height };
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [canvasDims.width, canvasDims.height]);

  // ── Core redraw ──
  const redraw = useCallback((opts = {}) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { w, h } = cssDimsRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Draw committed objects, substituting live drag preview if dragging selected
    const drawList = sketches.map((obj, i) =>
      (opts.liveObj !== undefined && i === opts.selectedIdx) ? opts.liveObj : obj
    );
    replaySketchObjects(ctx, drawList, w, h);

    // Selection box
    const selObj = opts.liveObj !== undefined ? opts.liveObj : sketches[selectedIndex];
    if (selectedIndex >= 0 && selObj) drawSelectionBox(ctx, selObj, w, h);

    // Drawing preview
    if (opts.previewTool) {
      drawPreview(ctx, opts.previewTool, opts.previewStart, opts.previewCurrent,
                  opts.previewPoints, activeColor, activeWidth, w, h);
    }
    ctx.restore();
  }, [sketches, selectedIndex, activeColor, activeWidth]);

  useEffect(() => { redraw(); }, [redraw]);

  // ── Delete / Backspace key for selected object ──
  useEffect(() => {
    if (activeTool !== 'select') return;
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIndex >= 0) {
        e.preventDefault();
        onRemoveObject?.(selectedIndex);
        setSelectedIndex(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, selectedIndex, onRemoveObject]);

  // ── Coordinate helper ──
  const getPos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { fracX: 0, fracY: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      fracX: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      fracY: Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height)),
    };
  };

  // ══════════════════════════════════════════════
  //  Pointer down
  // ══════════════════════════════════════════════
  const handlePointerDown = useCallback((e) => {
    if (activeTool === 'pan') return;
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos(e);
    const { w, h } = cssDimsRef.current;

    // ── Text ──
    if (activeTool === 'text') {
      setTextInput({ fracX: pos.fracX, fracY: pos.fracY });
      return;
    }

    // ── Eraser ──
    if (activeTool === 'eraser') {
      let bestIdx = -1, bestDist = Infinity;
      sketches.forEach((obj, i) => {
        if (hitTest(obj, pos.fracX, pos.fracY, w, h)) {
          const bb = getBoundingBox(obj);
          const cx = bb ? (bb.x1 + bb.x2) / 2 : pos.fracX;
          const cy = bb ? (bb.y1 + bb.y2) / 2 : pos.fracY;
          const d = Math.hypot((cx - pos.fracX) * w, (cy - pos.fracY) * h);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
      });
      if (bestIdx >= 0) { onRemoveObject?.(bestIdx); setSelectedIndex(-1); }
      return;
    }

    // ── Select ──
    if (activeTool === 'select') {
      let hit = -1;
      for (let i = sketches.length - 1; i >= 0; i--) {
        if (hitTest(sketches[i], pos.fracX, pos.fracY, w, h)) { hit = i; break; }
      }
      setSelectedIndex(hit);
      if (hit >= 0) {
        isDrawingRef.current  = true;
        startPosRef.current   = pos;
        dragStartObjRef.current = sketches[hit];
        dragLiveObjRef.current  = sketches[hit];
        canvasRef.current?.setPointerCapture(e.pointerId);
      }
      return;
    }

    // ── Drawing tools ──
    isDrawingRef.current    = true;
    startPosRef.current     = pos;
    currentPosRef.current   = pos;
    strokePointsRef.current = activeTool === 'pen' ? [pos] : [];
    canvasRef.current?.setPointerCapture(e.pointerId);
  }, [activeTool, sketches, onRemoveObject]);

  // ══════════════════════════════════════════════
  //  Pointer move
  // ══════════════════════════════════════════════
  const handlePointerMove = useCallback((e) => {
    if (!isDrawingRef.current) return;
    const pos = getPos(e);

    // ── Moving a selected object ──
    if (activeTool === 'select' && dragStartObjRef.current) {
      const dx = pos.fracX - startPosRef.current.fracX;
      const dy = pos.fracY - startPosRef.current.fracY;
      const liveObj = translateObject(dragStartObjRef.current, dx, dy);
      dragLiveObjRef.current = liveObj;
      redraw({ liveObj, selectedIdx: selectedIndex });
      return;
    }

    // ── Drawing preview ──
    currentPosRef.current = pos;
    if (activeTool === 'pen') strokePointsRef.current.push(pos);
    redraw({
      previewTool:    activeTool,
      previewStart:   startPosRef.current,
      previewCurrent: pos,
      previewPoints:  strokePointsRef.current,
    });
  }, [activeTool, selectedIndex, redraw]);

  // ══════════════════════════════════════════════
  //  Pointer up
  // ══════════════════════════════════════════════
  const handlePointerUp = useCallback((e) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const pos   = getPos(e);
    const start = startPosRef.current;

    // ── Commit moved object ──
    if (activeTool === 'select') {
      if (dragLiveObjRef.current && start) {
        const dx = pos.fracX - start.fracX, dy = pos.fracY - start.fracY;
        if (Math.hypot(dx, dy) > 0.003 && selectedIndex >= 0) {
          onUpdateObject?.(selectedIndex, dragLiveObjRef.current);
        }
      }
      dragStartObjRef.current = null;
      dragLiveObjRef.current  = null;
      startPosRef.current     = null;
      redraw();
      return;
    }

    if (!start) { redraw(); return; }

    // ── Commit drawing ──
    let obj = null;
    switch (activeTool) {
      case 'pen':
        if (strokePointsRef.current.length > 1)
          obj = { type: 'stroke', points: [...strokePointsRef.current], color: activeColor, width: activeWidth };
        break;
      case 'highlight':
        if (Math.abs(pos.fracX - start.fracX) > 0.005 || Math.abs(pos.fracY - start.fracY) > 0.005)
          obj = { type: 'highlight', x1: start.fracX, y1: start.fracY, x2: pos.fracX, y2: pos.fracY };
        break;
      case 'rect':
        if (Math.abs(pos.fracX - start.fracX) > 0.005 || Math.abs(pos.fracY - start.fracY) > 0.005)
          obj = { type: 'rect', x1: start.fracX, y1: start.fracY, x2: pos.fracX, y2: pos.fracY, color: activeColor, width: activeWidth };
        break;
      case 'ellipse': {
        const rx = Math.abs(pos.fracX - start.fracX) / 2, ry = Math.abs(pos.fracY - start.fracY) / 2;
        if (rx > 0.005 || ry > 0.005)
          obj = { type: 'ellipse', cx: (start.fracX+pos.fracX)/2, cy: (start.fracY+pos.fracY)/2, rx, ry, color: activeColor, width: activeWidth };
        break;
      }
      case 'arrow':
        if (Math.hypot(pos.fracX - start.fracX, pos.fracY - start.fracY) > 0.01)
          obj = { type: 'arrow', x1: start.fracX, y1: start.fracY, x2: pos.fracX, y2: pos.fracY, color: activeColor, width: activeWidth };
        break;
      case 'line':
        if (Math.hypot(pos.fracX - start.fracX, pos.fracY - start.fracY) > 0.005)
          obj = { type: 'line', x1: start.fracX, y1: start.fracY, x2: pos.fracX, y2: pos.fracY, color: activeColor, width: activeWidth };
        break;
    }

    strokePointsRef.current = [];
    startPosRef.current     = null;
    currentPosRef.current   = null;
    if (obj) onAddObject?.(obj);
    else redraw();
  }, [activeTool, activeColor, activeWidth, selectedIndex, onAddObject, onUpdateObject, redraw]);

  // ── Commit text ──
  const commitText = useCallback((content) => {
    setTextInput(null);
    if (!content.trim() || !textInput) return;
    onAddObject?.({ type: 'text', x: textInput.fracX, y: textInput.fracY,
      content, color: activeColor, fontSizeFrac: activeFontSizeFrac ?? 0.025 });
  }, [textInput, activeColor, activeFontSizeFrac, onAddObject]);

  const isActive = activeTool !== 'pan';

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position:      'absolute',
          top: 0, left: 0,
          pointerEvents: isActive ? 'all' : 'none',
          cursor:        toolCursor(activeTool),
          zIndex:        2,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      {textInput && (
        <div style={{ position: 'absolute', top: `${textInput.fracY*100}%`, left: `${textInput.fracX*100}%`, zIndex: 10 }}>
          <textarea
            autoFocus
            className="sketch-text-input"
            rows={3}
            style={{ color: activeColor }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(e.target.value); }
              if (e.key === 'Escape') setTextInput(null);
            }}
            onBlur={(e) => commitText(e.target.value)}
          />
        </div>
      )}
    </>
  );
}
