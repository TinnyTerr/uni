import { useMemo, useRef, useState } from 'react';
import { uid, useStore } from '../lib/store';
import { allConnectors, roomCodeOf } from '../lib/campus';
import type { Building, Connector, Floor, Room } from '../lib/types';
import { ConfirmButton, Field, Modal } from '../components/ui';

type Tool = 'select' | 'room' | 'exit' | 'passage';

const DEFAULT_W = 1000;
const DEFAULT_H = 700;
const MIN_ROOM = 12;

type Drag =
  | { kind: 'draw'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'move'; id: string; dx: number; dy: number }
  | { kind: 'resize'; id: string }
  | { kind: 'point'; id: string };

/** Read an image and shrink it so a floor plan does not bloat the synced document. */
async function loadImage(file: File): Promise<{ url: string; w: number; h: number }> {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((ok, bad) => {
      img.onload = () => ok();
      img.onerror = () => bad(new Error('not an image'));
      img.src = src;
    });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return { url: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(src);
  }
}

export default function FloorPlans({
  buildingId,
  startLevel,
  highlight,
  onClose,
}: {
  buildingId: string;
  startLevel?: number;
  /** Room to light up, as a compact code like "26" on `startLevel`. */
  highlight?: string;
  onClose: () => void;
}) {
  const { state, update } = useStore();
  const building = state.buildings.find((b) => b.id === buildingId);
  const floors = useMemo(
    () => [...(building?.floors ?? [])].sort((a, b) => a.level - b.level),
    [building],
  );
  const [level, setLevel] = useState<number | null>(startLevel ?? floors[0]?.level ?? null);
  const [tool, setTool] = useState<Tool>('select');
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!building) return null;
  const floor = floors.find((f) => f.level === level) ?? floors[0] ?? null;

  const edit = (fn: (b: Building) => void) =>
    update((s) => {
      const b = s.buildings.find((x) => x.id === buildingId);
      if (b) {
        b.floors ??= [];
        fn(b);
      }
    });
  const editFloor = (fn: (f: Floor) => void) =>
    edit((b) => {
      const f = b.floors!.find((x) => x.level === floor?.level);
      if (f) fn(f);
    });

  const addFloor = () => {
    const next = floors.length ? Math.max(...floors.map((f) => f.level)) + 1 : 0;
    edit((b) => b.floors!.push({ id: uid(), level: next, w: DEFAULT_W, h: DEFAULT_H, rooms: [], connectors: [] }));
    setLevel(next);
    setSel(null);
  };

  const setLevelNumber = (n: number) => {
    if (!floor || !Number.isInteger(n) || n < 0 || n > 9) return;
    if (floors.some((f) => f.level === n && f.id !== floor.id)) return;
    editFloor((f) => (f.level = n));
    setLevel(n);
  };

  const point = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    const f = floor!;
    return {
      x: Math.max(0, Math.min(f.w, ((e.clientX - r.left) / r.width) * f.w)),
      y: Math.max(0, Math.min(f.h, ((e.clientY - r.top) / r.height) * f.h)),
    };
  };

  const onBackground = (e: React.PointerEvent) => {
    if (!floor) return;
    const p = point(e);
    if (tool === 'room') {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setDrag({ kind: 'draw', x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    } else if (tool === 'exit' || tool === 'passage') {
      const c: Connector = {
        id: uid(),
        kind: tool,
        label: tool === 'exit' ? 'Exit' : 'Passage',
        x: Math.round(p.x),
        y: Math.round(p.y),
      };
      editFloor((f) => f.connectors.push(c));
      setSel(c.id);
      setTool('select');
    } else setSel(null);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag || !floor) return;
    const p = point(e);
    if (drag.kind === 'draw') setDrag({ ...drag, x1: p.x, y1: p.y });
    else if (drag.kind === 'move') {
      editFloor((f) => {
        const r = f.rooms.find((x) => x.id === drag.id);
        if (r) {
          r.x = Math.round(Math.max(0, Math.min(f.w - r.w, p.x - drag.dx)));
          r.y = Math.round(Math.max(0, Math.min(f.h - r.h, p.y - drag.dy)));
        }
      });
    } else if (drag.kind === 'resize') {
      editFloor((f) => {
        const r = f.rooms.find((x) => x.id === drag.id);
        if (r) {
          r.w = Math.round(Math.max(MIN_ROOM, p.x - r.x));
          r.h = Math.round(Math.max(MIN_ROOM, p.y - r.y));
        }
      });
    } else {
      editFloor((f) => {
        const c = f.connectors.find((x) => x.id === drag.id);
        if (c) {
          c.x = Math.round(p.x);
          c.y = Math.round(p.y);
        }
      });
    }
  };

  const onUp = () => {
    if (drag?.kind === 'draw') {
      const x = Math.min(drag.x0, drag.x1);
      const y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0);
      const h = Math.abs(drag.y1 - drag.y0);
      if (w >= MIN_ROOM && h >= MIN_ROOM) {
        const room: Room = {
          id: uid(),
          code: '',
          name: '',
          x: Math.round(x),
          y: Math.round(y),
          w: Math.round(w),
          h: Math.round(h),
        };
        editFloor((f) => f.rooms.push(room));
        setSel(room.id);
        setTool('select');
      }
    }
    setDrag(null);
  };

  const pickImage = async (file?: File) => {
    if (!file || !floor) return;
    try {
      const img = await loadImage(file);
      editFloor((f) => {
        f.image = img.url;
        f.w = img.w;
        f.h = img.h;
        // Rooms drawn before the image existed keep their relative place.
      });
    } catch {
      /* not an image: leave the plan alone */
    }
  };

  const room = floor?.rooms.find((r) => r.id === sel);
  const conn = floor?.connectors.find((c) => c.id === sel);
  const dupe =
    !!room && !!floor && floor.rooms.some((r) => r.id !== room.id && r.code && r.code.toLowerCase() === room.code.toLowerCase());
  const others = allConnectors(state.buildings).filter(
    (x) => x.connector.kind === 'passage' && x.building.id !== building.id,
  );
  const stroke = 'var(--text)';

  return (
    <Modal wide title={`${building.name} — floor plans`} onClose={onClose}>
      <div className="plan-bar">
        {floors.map((f) => (
          <button
            key={f.id}
            className={f.level === floor?.level ? 'btn primary sm' : 'btn sm'}
            onClick={() => {
              setLevel(f.level);
              setSel(null);
            }}
          >
            Floor {f.level}
          </button>
        ))}
        <button className="btn ghost sm" onClick={addFloor}>
          + Floor
        </button>
      </div>

      {!floor ? (
        <p className="tiny dim">
          No floors yet. Add one, then draw rooms or upload a plan to trace. Rooms are named{' '}
          <b className="mono">{(building.code || 'XX').toUpperCase()}</b>
          <b className="mono">floor</b>
          <b className="mono">room</b>, e.g. <span className="mono">{(building.code || 'RC').toUpperCase()}426</span> is
          room 26 on floor 4.
        </p>
      ) : (
        <>
          <div className="plan-bar">
            {(
              [
                ['select', 'Select'],
                ['room', 'Draw room'],
                ['exit', 'Exit'],
                ['passage', 'Passage'],
              ] as [Tool, string][]
            ).map(([t, label]) => (
              <button key={t} className={tool === t ? 'btn primary sm' : 'btn sm'} onClick={() => setTool(t)}>
                {label}
              </button>
            ))}
            <div className="spacer" />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                pickImage(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button className="btn sm" onClick={() => fileRef.current?.click()}>
              {floor.image ? 'Replace plan image' : 'Trace over an image'}
            </button>
            {floor.image && (
              <button className="btn ghost sm" onClick={() => editFloor((f) => delete f.image)}>
                Remove image
              </button>
            )}
          </div>

          <div className="plan-grid">
            <svg
              ref={svgRef}
              className={`plan-svg ${tool !== 'select' ? 'drawing' : ''}`}
              viewBox={`0 0 ${floor.w} ${floor.h}`}
              onPointerMove={onMove}
              onPointerUp={onUp}
            >
              <rect x={0} y={0} width={floor.w} height={floor.h} className="plan-bg" onPointerDown={onBackground} />
              {floor.image && (
                <image
                  href={floor.image}
                  x={0}
                  y={0}
                  width={floor.w}
                  height={floor.h}
                  opacity={0.55}
                  style={{ pointerEvents: 'none' }}
                />
              )}
              {floor.rooms.map((r) => {
                const lit = !!highlight && r.code.toLowerCase() === highlight.toLowerCase() && floor.level === startLevel;
                return (
                  <g key={r.id}>
                    <rect
                      x={r.x}
                      y={r.y}
                      width={r.w}
                      height={r.h}
                      className={`plan-room ${r.id === sel ? 'sel' : ''} ${lit ? 'lit' : ''}`}
                      onPointerDown={(e) => {
                        if (tool !== 'select') return onBackground(e);
                        e.stopPropagation();
                        setSel(r.id);
                        const p = point(e);
                        (e.currentTarget as Element).setPointerCapture(e.pointerId);
                        setDrag({ kind: 'move', id: r.id, dx: p.x - r.x, dy: p.y - r.y });
                      }}
                    />
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2}
                      className="plan-label"
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      {r.code ? roomCodeOf(building, floor, r) : '?'}
                    </text>
                    {r.id === sel && tool === 'select' && (
                      <rect
                        x={r.x + r.w - 8}
                        y={r.y + r.h - 8}
                        width={16}
                        height={16}
                        className="plan-handle"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          (e.currentTarget as Element).setPointerCapture(e.pointerId);
                          setDrag({ kind: 'resize', id: r.id });
                        }}
                      />
                    )}
                  </g>
                );
              })}
              {floor.connectors.map((c) => (
                <g
                  key={c.id}
                  transform={`translate(${c.x} ${c.y})`}
                  onPointerDown={(e) => {
                    if (tool !== 'select') return onBackground(e);
                    e.stopPropagation();
                    setSel(c.id);
                    (e.currentTarget as Element).setPointerCapture(e.pointerId);
                    setDrag({ kind: 'point', id: c.id });
                  }}
                  style={{ cursor: 'grab' }}
                >
                  {c.kind === 'exit' ? (
                    <circle r={13} className={`plan-exit ${c.id === sel ? 'sel' : ''}`} />
                  ) : (
                    <rect x={-13} y={-13} width={26} height={26} transform="rotate(45)" className={`plan-pass ${c.id === sel ? 'sel' : ''}`} />
                  )}
                  <text y={-20} textAnchor="middle" className="plan-label small" stroke={stroke} strokeWidth={0}>
                    {c.label}
                    {c.kind === 'passage' && c.linkTo ? ' →' : ''}
                  </text>
                </g>
              ))}
              {drag?.kind === 'draw' && (
                <rect
                  x={Math.min(drag.x0, drag.x1)}
                  y={Math.min(drag.y0, drag.y1)}
                  width={Math.abs(drag.x1 - drag.x0)}
                  height={Math.abs(drag.y1 - drag.y0)}
                  className="plan-room sel"
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </svg>

            <aside className="plan-side">
              {room && (
                <>
                  <Field label="Room" hint={`full code ${roomCodeOf(building, floor, room)}`}>
                    <input
                      autoFocus
                      value={room.code}
                      onChange={(e) =>
                        editFloor((f) => {
                          const r = f.rooms.find((x) => x.id === room.id);
                          if (r) r.code = e.target.value.replace(/\s+/g, '');
                        })
                      }
                      placeholder="26"
                    />
                  </Field>
                  {dupe && <div className="tiny" style={{ color: 'var(--danger)' }}>Another room here has this code.</div>}
                  <Field label="Name">
                    <input
                      value={room.name}
                      onChange={(e) =>
                        editFloor((f) => {
                          const r = f.rooms.find((x) => x.id === room.id);
                          if (r) r.name = e.target.value;
                        })
                      }
                      placeholder="Lecture theatre"
                    />
                  </Field>
                  <ConfirmButton
                    onConfirm={() => {
                      editFloor((f) => (f.rooms = f.rooms.filter((x) => x.id !== room.id)));
                      setSel(null);
                    }}
                  />
                </>
              )}
              {conn && (
                <>
                  <Field label={conn.kind === 'exit' ? 'Exit' : 'Passage'}>
                    <input
                      autoFocus
                      value={conn.label}
                      onChange={(e) =>
                        editFloor((f) => {
                          const c = f.connectors.find((x) => x.id === conn.id);
                          if (c) c.label = e.target.value;
                        })
                      }
                    />
                  </Field>
                  {conn.kind === 'passage' && (
                    <Field label="Leads to" hint="the other end, drawn in that building">
                      <select
                        value={conn.linkTo ?? ''}
                        onChange={(e) => {
                          const to = e.target.value || undefined;
                          update((s) => {
                            // Links run both ways, so the far end never points at a stale connector.
                            for (const x of allConnectors(s.buildings)) {
                              const c = x.connector;
                              if (c.id === conn.id) c.linkTo = to;
                              else if (c.linkTo === conn.id && c.id !== to) c.linkTo = undefined;
                              else if (c.id === to) c.linkTo = conn.id;
                            }
                          });
                        }}
                      >
                        <option value="">— not linked —</option>
                        {others.map((x) => (
                          <option key={x.connector.id} value={x.connector.id}>
                            {x.building.code || x.building.name} floor {x.floor.level}: {x.connector.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <ConfirmButton
                    onConfirm={() => {
                      update((s) => {
                        for (const x of allConnectors(s.buildings)) if (x.connector.linkTo === conn.id) x.connector.linkTo = undefined;
                      });
                      editFloor((f) => (f.connectors = f.connectors.filter((x) => x.id !== conn.id)));
                      setSel(null);
                    }}
                  />
                </>
              )}
              {!room && !conn && (
                <>
                  <Field label="Floor number" hint="0 is ground">
                    <input
                      type="number"
                      min={0}
                      max={9}
                      value={floor.level}
                      onChange={(e) => setLevelNumber(Number(e.target.value))}
                    />
                  </Field>
                  <div className="tiny dim">
                    {floor.rooms.length} room{floor.rooms.length === 1 ? '' : 's'},{' '}
                    {floor.connectors.length} exit/passage{floor.connectors.length === 1 ? '' : 's'}. Pick{' '}
                    <b>Draw room</b> and drag on the plan; click a room to rename or resize it.
                  </div>
                  <ConfirmButton
                    label="Delete floor"
                    onConfirm={() => {
                      update((s) => {
                        const gone = new Set(floor.connectors.map((c) => c.id));
                        for (const x of allConnectors(s.buildings))
                          if (x.connector.linkTo && gone.has(x.connector.linkTo)) x.connector.linkTo = undefined;
                      });
                      edit((b) => (b.floors = b.floors!.filter((f) => f.level !== floor.level)));
                      setLevel(null);
                      setSel(null);
                    }}
                  />
                </>
              )}
            </aside>
          </div>
        </>
      )}
      {!floor && (
        <div style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={addFloor}>
            + Floor
          </button>
        </div>
      )}
    </Modal>
  );
}
