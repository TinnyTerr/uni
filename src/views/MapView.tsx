import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { format } from 'date-fns';
import { uid, useStore } from '../lib/store';
import { occurrencesOn } from '../lib/occurrences';
import {
  TILE_ATTRIBUTION,
  TILE_URL,
  boundsOf,
  boxFrom,
  centreOf,
  directionsUrl,
  findRoom,
  resolveBuilding,
  transitionsOn,
  walkMinutes,
  type Bounds,
} from '../lib/campus';
import type { Building } from '../lib/types';
import { ConfirmButton, Empty, Field, Modal } from '../components/ui';
import FloorPlans from './FloorPlans';

interface Draft {
  id: string;
  code: string;
  name: string;
  bounds: Bounds;
  isNew: boolean;
}

/** Smallest box a drag may make, in degrees (about 5 m); anything less is a click. */
const MIN_SPAN = 0.00005;

const UK_CENTRE: L.LatLngTuple = [54.0, -2.5];

const COLOURS = { next: '#ffffff', today: '#5b8def', idle: '#8a93a6' } as const;

function handleIcon(centre = false) {
  return L.divIcon({
    className: '',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<div class="map-handle${centre ? ' centre' : ''}"></div>`,
  });
}

const label = (code: string) => code.replace(/[<>&"]/g, '');

export default function MapView() {
  const { state, update } = useStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [plans, setPlans] = useState<{ id: string; level?: number; room?: string } | null>(null);
  const placingRef = useRef(false);
  placingRef.current = placing;
  const fitted = useRef(false);

  const now = new Date();
  const { buildings } = state;

  // What is happening today, and where: drives pin highlighting and the route.
  const { nextHit, todayIds, transitions, unmatched } = useMemo(() => {
    const today = occurrencesOn(state, now).filter((o) => !o.allDay && o.kind !== 'deadline');
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const upcoming = [...today.filter((o) => o.end >= now), ...occurrencesOn(state, tomorrow)]
      .filter((o) => !o.allDay && o.kind !== 'deadline' && o.location)
      .map((o) => ({ o, hit: resolveBuilding(o.location, buildings) }))
      .find((x) => x.hit);
    const todayIds = new Set(
      today.map((o) => resolveBuilding(o.location, buildings)?.building.id).filter(Boolean) as string[],
    );
    const seen = new Set<string>();
    const unmatched: string[] = [];
    for (const loc of [...state.sessions.map((s) => s.location), ...state.events.map((e) => e.location)]) {
      const t = loc.trim();
      if (t && !seen.has(t.toLowerCase()) && !resolveBuilding(t, buildings)) {
        seen.add(t.toLowerCase());
        unmatched.push(t);
      }
    }
    return { nextHit: upcoming, todayIds, transitions: transitionsOn(state, now), unmatched };
  }, [state, buildings]);

  // Create the map once.
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, { zoomControl: true }).setView(UK_CENTRE, 6);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    // Drag out a box where the building stands.
    let start: L.LatLng | null = null;
    let preview: L.Rectangle | null = null;
    map.on('mousedown', (e: L.LeafletMouseEvent) => {
      if (!placingRef.current) return;
      start = e.latlng;
      map.dragging.disable();
      preview = L.rectangle(L.latLngBounds(start, start), { color: '#5b8def', weight: 2, dashArray: '4' }).addTo(map);
    });
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (start && preview) preview.setBounds(L.latLngBounds(start, e.latlng));
    });
    map.on('mouseup', (e: L.LeafletMouseEvent) => {
      if (!start) return;
      const box = boxFrom(start, e.latlng);
      start = null;
      preview?.remove();
      preview = null;
      map.dragging.enable();
      setPlacing(false);
      // A bare click gets the default-sized box round it.
      const small = box[2] - box[0] < MIN_SPAN || box[3] - box[1] < MIN_SPAN;
      const bounds = small
        ? boundsOf({ id: '', code: '', name: '', lat: e.latlng.lat, lng: e.latlng.lng })
        : box;
      setDraft({ id: uid(), code: '', name: '', bounds, isNew: true });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fitted.current = false;
    };
  }, []);

  // The container may have been sized after mount (flex layout).
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (el) el.style.cursor = placing ? 'crosshair' : '';
  }, [placing]);

  const commitBounds = (id: string, bounds: Bounds) =>
    update((s) => {
      const t = s.buildings.find((x) => x.id === id);
      if (t) {
        const c = centreOf(bounds);
        t.bounds = bounds.map((n) => Number(n.toFixed(6))) as Bounds;
        t.lat = Number(c.lat.toFixed(6));
        t.lng = Number(c.lng.toFixed(6));
      }
    });

  // Redraw boxes whenever the buildings or today's plan change.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const b of buildings) {
      const kind = nextHit?.hit?.building.id === b.id ? 'next' : todayIds.has(b.id) ? 'today' : 'idle';
      const bb = boundsOf(b);
      const chosen = b.id === selId;
      const rect = L.rectangle(
        [
          [bb[0], bb[1]],
          [bb[2], bb[3]],
        ],
        {
          color: COLOURS[kind],
          weight: chosen ? 3 : 2,
          fillColor: COLOURS[kind],
          fillOpacity: kind === 'idle' ? 0.15 : 0.3,
          bubblingMouseEvents: false,
        },
      );
      rect.bindTooltip(label(b.code || b.name.slice(0, 3)), {
        permanent: true,
        direction: 'center',
        className: `map-label ${kind}`,
      });
      rect.on('click', () => {
        setSelId(b.id);
      });
      rect.on('dblclick', () => edit(b));
      layer.addLayer(rect);

      if (!chosen) continue;
      // Corner handles resize against the opposite corner; the middle one moves the box.
      const corners: [number, number, 0 | 2, 1 | 3][] = [
        [bb[0], bb[1], 2, 3],
        [bb[0], bb[3], 2, 1],
        [bb[2], bb[1], 0, 3],
        [bb[2], bb[3], 0, 1],
      ];
      for (const [lat, lng, oLat, oLng] of corners) {
        const m = L.marker([lat, lng], { icon: handleIcon(), draggable: true, zIndexOffset: 2000 });
        m.on('drag', () => {
          const p = m.getLatLng();
          rect.setBounds(L.latLngBounds([p.lat, p.lng], [bb[oLat], bb[oLng]]));
        });
        m.on('dragend', () => {
          const p = m.getLatLng();
          commitBounds(b.id, boxFrom(p, { lat: bb[oLat], lng: bb[oLng] }));
        });
        layer.addLayer(m);
      }
      const c = centreOf(bb);
      const mover = L.marker([c.lat, c.lng], { icon: handleIcon(true), draggable: true, zIndexOffset: 2000 });
      mover.on('drag', () => {
        const p = mover.getLatLng();
        rect.setBounds([
          [bb[0] + p.lat - c.lat, bb[1] + p.lng - c.lng],
          [bb[2] + p.lat - c.lat, bb[3] + p.lng - c.lng],
        ]);
      });
      mover.on('dragend', () => {
        const p = mover.getLatLng();
        const dLat = p.lat - c.lat;
        const dLng = p.lng - c.lng;
        commitBounds(b.id, [bb[0] + dLat, bb[1] + dLng, bb[2] + dLat, bb[3] + dLng]);
      });
      layer.addLayer(mover);
    }
    if (!fitted.current && buildings.length) {
      fitted.current = true;
      const all = buildings.map(boundsOf);
      map.fitBounds(
        L.latLngBounds(all.flatMap((x) => [[x[0], x[1]] as L.LatLngTuple, [x[2], x[3]] as L.LatLngTuple])),
        { padding: [60, 60], maxZoom: 17 },
      );
    }
  }, [buildings, nextHit, todayIds, selId]);

  // Clicking empty map deselects.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const off = () => !placingRef.current && setSelId(null);
    map.on('click', off);
    return () => {
      map.off('click', off);
    };
  }, []);

  const edit = (b: Building) =>
    setDraft({ id: b.id, code: b.code, name: b.name, bounds: boundsOf(b), isNew: false });

  const fly = (b: Building) => {
    setSelId(b.id);
    const bb = boundsOf(b);
    mapRef.current?.flyToBounds(
      [
        [bb[0], bb[1]],
        [bb[2], bb[3]],
      ],
      { maxZoom: 18, padding: [80, 80] },
    );
  };

  const startFor = (location: string) => {
    const c = mapRef.current?.getCenter();
    setDraft({
      id: uid(),
      code: location.split(/[\s\-/,]/)[0]?.slice(0, 2).toUpperCase() ?? '',
      name: '',
      bounds: boundsOf({ id: '', code: '', name: '', lat: c?.lat ?? UK_CENTRE[0], lng: c?.lng ?? UK_CENTRE[1] }),
      isNew: true,
    });
  };

  const valid = !!draft && (draft.code.trim() !== '' || draft.name.trim() !== '');

  const save = () => {
    if (!draft || !valid) return;
    const c = centreOf(draft.bounds);
    update((s) => {
      const old = s.buildings.find((x) => x.id === draft.id);
      const b: Building = {
        ...old,
        id: draft.id,
        code: draft.code.trim(),
        name: draft.name.trim() || draft.code.trim(),
        lat: Number(c.lat.toFixed(6)),
        lng: Number(c.lng.toFixed(6)),
        bounds: draft.bounds,
      };
      const i = s.buildings.findIndex((x) => x.id === b.id);
      if (i >= 0) s.buildings[i] = b;
      else s.buildings.push(b);
    });
    setSelId(draft.id);
    setDraft(null);
    if (draft.isNew) fly({ id: draft.id, code: '', name: '', lat: c.lat, lng: c.lng, bounds: draft.bounds });
  };

  const selected = buildings.find((b) => b.id === selId) ?? null;

  return (
    <div className="map-view">
      <aside className="map-side">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className={placing ? 'btn primary' : 'btn'}
            onClick={() => setPlacing((v) => !v)}
            title="Then drag a box over the building on the map"
          >
            {placing ? 'Drag a box…' : '+ Building'}
          </button>
          <span className="tiny dim">drag out a box</span>
        </div>

        {selected && (
          <div className="map-card">
            <div className="tiny dim">Selected</div>
            <div>
              <b className="mono">{selected.code}</b> {selected.name}
            </div>
            <div className="tiny muted">
              {selected.floors?.length
                ? `${selected.floors.length} floor${selected.floors.length > 1 ? 's' : ''}, ${selected.floors.reduce((n, f) => n + f.rooms.length, 0)} rooms`
                : 'No floor plans yet'}
              . Drag the corners to resize.
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <button className="btn sm primary" onClick={() => setPlans({ id: selected.id })}>
                Floor plans
              </button>
              <button className="btn sm" onClick={() => edit(selected)}>
                Edit
              </button>
              <a className="btn sm" href={directionsUrl(selected)} target="_blank" rel="noreferrer">
                Directions ↗
              </a>
            </div>
          </div>
        )}

        {nextHit?.hit && (
          <div className="map-card">
            <div className="tiny dim">Next up</div>
            <div>
              <b>{nextHit.o.title}</b> · {format(nextHit.o.start, 'EEE HH:mm')}
            </div>
            <div className="tiny muted">
              {nextHit.hit.building.name}
              {nextHit.hit.room ? `, room ${nextHit.hit.room}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button className="btn sm" onClick={() => fly(nextHit.hit!.building)}>
                Show
              </button>
              {findRoom(nextHit.o.location, buildings) && (
                <button
                  className="btn sm"
                  onClick={() => {
                    const r = findRoom(nextHit.o.location, buildings)!;
                    setPlans({ id: r.building.id, level: r.floor.level, room: r.room.code });
                  }}
                >
                  Find room
                </button>
              )}
              <a className="btn sm" href={directionsUrl(nextHit.hit.building)} target="_blank" rel="noreferrer">
                Directions ↗
              </a>
            </div>
          </div>
        )}

        {transitions.length > 0 && (
          <div className="map-card">
            <div className="tiny dim" style={{ marginBottom: 4 }}>
              Today's walks
            </div>
            {transitions.map((t) => (
              <div key={t.to.key} className="tiny" style={{ padding: '3px 0' }}>
                {t.fromBuilding.code || t.fromBuilding.name} → {t.toBuilding.code || t.toBuilding.name}:{' '}
                <b>{t.walk} min</b> {t.passage ? 'via passage' : 'walk'}, {t.gap} min gap{' '}
                {t.shortBy > 0 ? (
                  <span style={{ color: 'var(--danger)' }}>· {t.shortBy} min short</span>
                ) : (
                  <span style={{ color: 'var(--ok)' }}>· fine</span>
                )}
              </div>
            ))}
          </div>
        )}

        {unmatched.length > 0 && buildings.length > 0 && (
          <div className="map-card">
            <div className="tiny dim" style={{ marginBottom: 4 }}>
              Locations with no building
            </div>
            {unmatched.slice(0, 8).map((u) => (
              <div key={u} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                <span className="tiny" style={{ flex: 1 }}>
                  {u}
                </span>
                <button className="btn ghost sm" onClick={() => startFor(u)}>
                  Add
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="tiny dim" style={{ marginTop: 4 }}>
          Buildings ({buildings.length})
        </div>
        {buildings.length === 0 ? (
          <Empty title="No buildings yet">
            Press + Building and drag a box over it on the map. Use the two-letter code your rooms use ("RC" for
            RC426) and sessions will link to it.
            {unmatched.length > 0 ? ` You have ${unmatched.length} location${unmatched.length > 1 ? 's' : ''} waiting.` : ''}
          </Empty>
        ) : (
          <div className="map-list">
            {[...buildings]
              .sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name))
              .map((b) => (
                <button key={b.id} className="map-row" onClick={() => fly(b)} onDoubleClick={() => edit(b)}>
                  <b className="mono">{b.code || '—'}</b>
                  <span style={{ flex: 1, textAlign: 'left' }}>{b.name}</span>
                  {nextHit?.hit && nextHit.hit.building.id !== b.id && (
                    <span className="tiny dim">{walkMinutes(nextHit.hit.building, b)} min</span>
                  )}
                  <span
                    className="ico-btn"
                    role="button"
                    title="Edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      edit(b);
                    }}
                  >
                    ✎
                  </span>
                </button>
              ))}
          </div>
        )}
      </aside>

      <div className="map-host" ref={hostRef} />

      {draft && (
        <Modal
          title={draft.isNew ? 'New building' : 'Edit building'}
          onClose={() => setDraft(null)}
          footer={
            <>
              {!draft.isNew && (
                <ConfirmButton
                  onConfirm={() => {
                    update((s) => {
                      s.buildings = s.buildings.filter((x) => x.id !== draft.id);
                    });
                    setDraft(null);
                  }}
                />
              )}
              <div className="spacer" />
              <button className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={save} disabled={!valid}>
                Save
              </button>
            </>
          }
        >
          <div className="row">
            <Field label="Code" hint="as in your timetable">
              <input
                autoFocus
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                placeholder="RC"
              />
            </Field>
            <Field label="Name">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Royal College"
              />
            </Field>
          </div>
          <div className="tiny dim">Resize or move the box by selecting the building and dragging its handles.</div>
        </Modal>
      )}

      {plans && (
        <FloorPlans
          key={`${plans.id}:${plans.level ?? ''}`}
          buildingId={plans.id}
          startLevel={plans.level}
          highlight={plans.room}
          onClose={() => setPlans(null)}
        />
      )}
    </div>
  );
}
