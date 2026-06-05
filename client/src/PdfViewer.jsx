import React, { useRef, useEffect, useState, useCallback } from 'react';
import SketchCanvas from './SketchCanvas';

function PdfViewer({
  pdfDoc,
  pageNumber,
  scale,
  pins = [],           // [{ field, number, x, y }]
  activeField,         // string | null
  onPinClick,          // (field) => void
  onPinDragEnd,        // (field, x, y) => void  — x,y as fractions
  onPinDelete,         // (field) => void
  // Sketch props
  sketches = [],
  onAddObject,
  onRemoveObject,
  onUpdateObject,
  onZoomRegion,
  activeTool = 'pan',
  activeColor = '#ef4444',
  activeWidth = 2,
  activeFontSizeFrac = 0.025,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const wrapperRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [canvasDims, setCanvasDims] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !containerRef.current) return;

    let cancelled = false;

    const renderPage = async () => {
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }

      setLoading(true);

      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;

        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) return;

        const viewport0 = page.getViewport({ scale: 1 });
        let effectiveScale;
        if (scale != null) {
          effectiveScale = scale;
        } else {
          const scaleX = container.clientWidth / viewport0.width;
          const scaleY = container.clientHeight / viewport0.height;
          effectiveScale = Math.min(scaleX, scaleY);
        }

        const vp = page.getViewport({ scale: effectiveScale });
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = Math.floor(vp.width);
        const cssHeight = Math.floor(vp.height);

        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        setCanvasDims({ width: cssWidth, height: cssHeight });

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderTask = page.render({ canvasContext: ctx, viewport: vp });
        renderTaskRef.current = renderTask;

        await renderTask.promise;

        if (!cancelled) {
          setLoading(false);
        }
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException' && !cancelled) {
          console.error('PDF render error:', err);
          setLoading(false);
        }
      }
    };

    renderPage();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, pageNumber, scale]);

  // Drag: move pin element directly via style, commit to state on mouseup
  const handlePinDragStart = useCallback((e, pin) => {
    e.preventDefault();
    e.stopPropagation();

    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const pinEl = e.currentTarget;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let hasMoved = false;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startClientX;
      const dy = moveEvent.clientY - startClientY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;

      if (hasMoved) {
        const rect = wrapper.getBoundingClientRect();
        const newFracX = pin.x + dx / rect.width;
        const newFracY = pin.y + dy / rect.height;
        pinEl.style.left = `${Math.max(0, Math.min(1, newFracX)) * 100}%`;
        pinEl.style.top = `${Math.max(0, Math.min(1, newFracY)) * 100}%`;
      }
    };

    const onUp = (upEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (hasMoved) {
        const rect = wrapper.getBoundingClientRect();
        const dx = upEvent.clientX - startClientX;
        const dy = upEvent.clientY - startClientY;
        const newX = Math.max(0, Math.min(1, pin.x + dx / rect.width));
        const newY = Math.max(0, Math.min(1, pin.y + dy / rect.height));
        onPinDragEnd?.(pin.field, newX, newY);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onPinDragEnd]);

  return (
    <div className="pdf-container" ref={containerRef}>
      {loading && <div className="pdf-loading">Loading page...</div>}
      <div
        className="pdf-page-wrapper"
        ref={wrapperRef}
        style={{
          position: 'relative',
          display: 'inline-block',
          width: canvasDims.width || undefined,
          height: canvasDims.height || undefined,
        }}
      >
        <canvas ref={canvasRef} className="pdf-canvas" />
        {canvasDims.width > 0 && (
          <>
            {/* Sketch overlay — zIndex:2, pointer-events controlled by activeTool */}
            <SketchCanvas
              sketches={sketches}
              onAddObject={onAddObject}
              onRemoveObject={onRemoveObject}
              onUpdateObject={onUpdateObject}
              onZoomRegion={onZoomRegion}
              activeTool={activeTool}
              activeColor={activeColor}
              activeWidth={activeWidth}
              activeFontSizeFrac={activeFontSizeFrac}
              canvasDims={canvasDims}
            />
            {/* Pin overlay — zIndex:10, always on top */}
            <div className="pdf-pin-overlay" style={{ zIndex: 10 }}>
              {pins.map(pin => (
                <div
                  key={pin.field}
                  className={`pdf-pin ${activeField === pin.field ? 'pdf-pin-active' : ''}`}
                  style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                  onMouseDown={(e) => handlePinDragStart(e, pin)}
                  onClick={(e) => { e.stopPropagation(); onPinClick?.(pin.field); }}
                  onContextMenu={(e) => { e.preventDefault(); onPinDelete?.(pin.field); }}
                >
                  {pin.number}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default PdfViewer;
