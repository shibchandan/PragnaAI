import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';

const COL = {
  cs: "#49d6ff",
  math: "#ff7aa2",
  food: "#ffbf5a",
  sports: "#73f0aa",
  doc: "#b7ff8a",
  default: "#8ea9c6"
};

const CATEGORY_LABEL = {
  cs: "CS / Algorithms",
  math: "Mathematics",
  food: "Food / Cooking",
  sports: "Sports / Games",
  doc: "Document chunk"
};

const PcaCanvas = forwardRef(({
  scenePoints,
  queryPoint,
  hitIds,
  autoSpin,
  sceneExtent,
  onHoverItemChange,
  cameraZoom,
  onCameraZoomChange
}, ref) => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  useImperativeHandle(ref, () => ({
    resetView() {
      rotationXRef.current = -0.42;
      rotationYRef.current = 0.84;
      onCameraZoomChange(1.15);
    }
  }));

  // Refs for tracking interactive states without triggering React re-renders during draw frames
  const rotationXRef = useRef(-0.42);
  const rotationYRef = useRef(0.84);
  const zoomRef = useRef(1.15);
  const draggingRef = useRef(false);
  const lastPointerRef = useRef(null);
  const projectedPointsRef = useRef([]);

  const [hoverCard, setHoverCard] = useState({ show: false, x: 0, y: 0, kind: '', title: '' });

  // Sync zoom prop changes to internal zoom ref
  useEffect(() => {
    zoomRef.current = cameraZoom;
  }, [cameraZoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resizeCanvas = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const rotatePoint = (point) => {
      const ny = point.y / sceneExtent;
      const nx = point.x / sceneExtent;
      const nz = point.z / sceneExtent;
      const cosY = Math.cos(rotationYRef.current);
      const sinY = Math.sin(rotationYRef.current);
      const cosX = Math.cos(rotationXRef.current);
      const sinX = Math.sin(rotationXRef.current);

      let rx = nx * cosY - nz * sinY;
      let rz = nx * sinY + nz * cosY;
      let ry = ny * cosX - rz * sinX;
      rz = ny * sinX + rz * cosX;
      return { x: rx, y: ry, z: rz };
    };

    const projectPoint = (point, width, height) => {
      const rotated = rotatePoint(point);
      const camera = 3.3 / zoomRef.current;
      const perspective = camera / (camera - rotated.z);
      const radius = Math.min(width, height) * 0.31;
      return {
        x: width * 0.5 + rotated.x * radius * perspective,
        y: height * 0.54 + rotated.y * radius * perspective * 0.86,
        z: rotated.z,
        size: Math.max(3.5, 7 * perspective),
        alpha: Math.min(1, Math.max(0.22, 0.28 + (rotated.z + 1.2) * 0.36)),
        perspective,
        item: point.item,
        world: point
      };
    };

    const drawWirePoint = (point, width, height) => {
      return projectPoint(point, width, height);
    };

    const drawSceneGrid = (width, height) => {
      ctx.save();
      ctx.lineWidth = 1;
      for (let y = -0.72; y <= 0.72; y += 0.24) {
        ctx.beginPath();
        let started = false;
        for (let x = -1.1; x <= 1.1; x += 0.05) {
          const p = drawWirePoint({ x, y, z: -1.05, item: {} }, width, height);
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        ctx.strokeStyle = "rgba(118, 151, 187, 0.08)";
        ctx.stroke();
      }

      for (let x = -1.1; x <= 1.1; x += 0.22) {
        ctx.beginPath();
        let started = false;
        for (let y = -0.72; y <= 0.72; y += 0.05) {
          const p = drawWirePoint({ x, y, z: -1.05, item: {} }, width, height);
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        ctx.strokeStyle = "rgba(118, 151, 187, 0.06)";
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawAxes = (width, height) => {
      const origin = drawWirePoint({ x: 0, y: 0, z: 0, item: {} }, width, height);
      const axisX = drawWirePoint({ x: 1.1, y: 0, z: 0, item: {} }, width, height);
      const axisY = drawWirePoint({ x: 0, y: 1.1, z: 0, item: {} }, width, height);
      const axisZ = drawWirePoint({ x: 0, y: 0, z: 1.1, item: {} }, width, height);

      ctx.save();
      ctx.lineWidth = 1.4;

      ctx.strokeStyle = "rgba(73, 214, 255, 0.45)";
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(axisX.x, axisX.y);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 122, 162, 0.38)";
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(axisY.x, axisY.y);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 191, 90, 0.34)";
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(axisZ.x, axisZ.y);
      ctx.stroke();

      ctx.fillStyle = "rgba(212, 231, 255, 0.72)";
      ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.fillText("PC1", axisX.x + 8, axisX.y);
      ctx.fillText("PC2", axisY.x + 8, axisY.y);
      ctx.fillText("PC3", axisZ.x + 8, axisZ.y);
      ctx.restore();
    };

    const drawQueryConnections = (width, height) => {
      if (!queryPoint || !hitIds.size) return;
      const queryProjection = projectPoint(queryPoint, width, height);
      for (const point of scenePoints) {
        if (!hitIds.has(point.item.id)) continue;
        const target = projectPoint(point, width, height);
        ctx.save();
        ctx.strokeStyle = "rgba(73, 214, 255, 0.16)";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 8]);
        ctx.beginPath();
        ctx.moveTo(queryProjection.x, queryProjection.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.restore();
      }
    };

    const drawQueryAnchor = (width, height) => {
      if (!queryPoint) return;
      const point = projectPoint(queryPoint, width, height);
      if (isNaN(point.x) || isNaN(point.y)) return;
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
      ctx.shadowBlur = 24;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const radius = i % 2 === 0 ? 12 : 5.5;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const drawPoints = (width, height) => {
      const projected = scenePoints.map((point) => projectPoint(point, width, height));
      projected.sort((a, b) => a.z - b.z);
      projectedPointsRef.current = projected;

      for (const proj of projected) {
        const category = proj.item.category;
        const color = COL[category] || COL.default;
        const hit = hitIds.has(proj.item.id);
        const hovered = hoverCard.show && hoverCard.title === proj.item.metadata;
        const size = proj.size + (hit ? 2.2 : 0) + (hovered ? 1.5 : 0);

        const glow = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, size * 4);
        glow.addColorStop(0, `${color}dd`);
        glow.addColorStop(0.55, `${color}55`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, size * 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.globalAlpha = proj.alpha;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, size, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();

        if (hit || hovered) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, size + 6 + Math.sin(Date.now() / 250) * 1.4, 0, Math.PI * 2);
          ctx.strokeStyle = hit ? `${color}99` : `${color}77`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        }
      }
    };

    const drawFrame = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);

      const background = ctx.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, "rgba(7, 13, 22, 0.94)");
      background.addColorStop(1, "rgba(4, 9, 15, 1)");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      const halo = ctx.createRadialGradient(width * 0.25, height * 0.18, 0, width * 0.25, height * 0.18, width * 0.42);
      halo.addColorStop(0, "rgba(73, 214, 255, 0.09)");
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      drawSceneGrid(width, height);
      drawAxes(width, height);
      drawQueryConnections(width, height);
      drawPoints(width, height);
      drawQueryAnchor(width, height);

      if (autoSpin && !draggingRef.current) {
        rotationYRef.current += 0.0022;
      }
      animationRef.current = requestAnimationFrame(drawFrame);
    };

    drawFrame();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationRef.current);
    };
  }, [scenePoints, queryPoint, hitIds, autoSpin, sceneExtent, hoverCard.show, hoverCard.title]);

  const handleMouseDown = (event) => {
    draggingRef.current = true;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    setHoverCard({ show: false, x: 0, y: 0, kind: '', title: '' });
    onHoverItemChange(null);
  };

  const handleMouseUp = () => {
    draggingRef.current = false;
    lastPointerRef.current = null;
  };

  const handleMouseMove = (event) => {
    if (draggingRef.current && lastPointerRef.current) {
      const dx = event.clientX - lastPointerRef.current.x;
      const dy = event.clientY - lastPointerRef.current.y;
      rotationYRef.current += dx * 0.0085;
      rotationXRef.current += dy * 0.006;
      rotationXRef.current = Math.max(-1.2, Math.min(1.2, rotationXRef.current));
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      setHoverCard({ show: false, x: 0, y: 0, kind: '', title: '' });
      onHoverItemChange(null);
      return;
    }

    // Hover detection
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let best = null;
    let distance = 24;
    for (const point of projectedPointsRef.current) {
      const d = Math.hypot(point.x - x, point.y - y);
      if (d < distance) {
        distance = d;
        best = point;
      }
    }

    if (best) {
      setHoverCard({
        show: true,
        x: event.clientX,
        y: event.clientY,
        kind: CATEGORY_LABEL[best.item.category] || best.item.category,
        title: best.item.metadata
      });
      onHoverItemChange(best.item);
    } else {
      setHoverCard({ show: false, x: 0, y: 0, kind: '', title: '' });
      onHoverItemChange(null);
    }
  };

  const handleMouseLeave = () => {
    if (!draggingRef.current) {
      setHoverCard({ show: false, x: 0, y: 0, kind: '', title: '' });
      onHoverItemChange(null);
    }
  };

  const handleWheel = (event) => {
    event.preventDefault();
    let newZoom = zoomRef.current + (event.deltaY > 0 ? -0.08 : 0.08);
    newZoom = Math.max(0.72, Math.min(1.9, newZoom));
    onCameraZoomChange(newZoom);
    setHoverCard({ show: false, x: 0, y: 0, kind: '', title: '' });
    onHoverItemChange(null);
  };

  return (
    <div className="scene-shell" style={{ position: 'relative', flex: 1, minHeight: '520px', display: 'flex', flexDirection: 'column' }}>
      <canvas
        ref={canvasRef}
        id="scatter"
        onPointerDown={handleMouseDown}
        onPointerUp={handleMouseUp}
        onPointerMove={handleMouseMove}
        onPointerLeave={handleMouseLeave}
        onWheel={handleWheel}
        style={{ display: 'block', width: '100%', height: '100%', flex: 1, touchAction: 'none' }}
      />
      {hoverCard.show && (
        <div
          id="hoverCard"
          style={{
            display: 'block',
            position: 'fixed',
            left: `${hoverCard.x + 16}px`,
            top: `${hoverCard.y + 16}px`,
            maxWidth: '260px',
            padding: '12px 14px',
            borderRadius: '18px',
            background: 'rgba(5, 12, 20, 0.92)',
            border: '1px solid rgba(139, 170, 205, 0.2)',
            boxShadow: 'var(--shadow)',
            pointerEvents: 'none',
            zIndex: 20
          }}
        >
          <div className="hover-kind" style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            {hoverCard.kind}
          </div>
          <div className="hover-title" style={{ marginTop: '8px', color: 'var(--text)', fontSize: '13px', lineHeight: '1.6' }}>
            {hoverCard.title}
          </div>
        </div>
      )}
    </div>
  );
});

export default PcaCanvas;
