import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { format } from 'date-fns';
import { uid, useStore } from '../lib/store';
import { occurrencesOn } from '../lib/occurrences';
import {
  TILE_ATTRIBUTION,
  TILE_URL,
  directionsUrl,
  resolveBuilding,
  transitionsOn,
  walkMinutes,
} from '../lib/campus';
import type { Building } from '../lib/types';
import { ConfirmButton, Empty, Field, Modal } from '../components/ui';

interface Draft {
  id: string;
  code: string;
  name: string;
  lat: string;
  lng: string;
  isNew: boolean;
}

const UK_CENTRE: L.LatLngTuple = [54.0, -2.5];

function pinIcon(code: string, state: 'next' | 'today' | 'idle') {
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div class="map-pin ${state}"><span>${code.replace(/[<>&"]/g, '')}</span></div>`,
  });
}

export default function MapView() {
  const { state, update } = useStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
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
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!placingRef.current) return;
      setPlacing(false);
      setDraft({
        id: uid(),
        code: '',
        name: '',
        lat: e.latlng.lat.toFixed(6),
        lng: e.latlng.lng.toFixed(6),
        isNew: true,
      });
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

  // Redraw pins whenever the buildings or today's plan change.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const b of buildings) {
      const kind = nextHit?.hit?.building.id === b.id ? 'next' : todayIds.has(b.id) ? 'today' : 'idle';
      const m = L.marker([b.lat, b.lng], {
        icon: pinIcon(b.code || b.name.slice(0, 3), kind),
        draggable: true,
        title: b.name,
        zIndexOffset: kind === 'next' ? 1000 : kind === 'today' ? 500 : 0,
      });
      m.on('dragend', () => {
        const p = m.getLatLng();
        update((s) => {
          const t = s.buildings.find((x) => x.id === b.id);
          if (t) {
            t.lat = Number(p.lat.toFixed(6));
            t.lng = Number(p.lng.toFixed(6));
          }
        });
      });
      m.on('click', () => edit(b));
      layer.addLayer(m);
    }
    if (!fitted.current && buildings.length) {
      fitted.current = true;
      map.fitBounds(L.latLngBounds(buildings.map((b) => [b.lat, b.lng] as L.LatLngTuple)), {
        padding: [60, 60],
        maxZoom: 17,
      });
    }
  }, [buildings, nextHit, todayIds]);

  const edit = (b: Building) =>
    setDraft({ id: b.id, code: b.code, name: b.name, lat: String(b.lat), lng: String(b.lng), isNew: false });

  const fly = (b: Building) => mapRef.current?.flyTo([b.lat, b.lng], Math.max(mapRef.current.getZoom(), 17));

  const startFor = (location: string) => {
    const c = mapRef.current?.getCenter();
    setDraft({
      id: uid(),
      code: location.split(/[\s\-/,]/)[0] ?? '',
      name: '',
      lat: (c?.lat ?? UK_CENTRE[0]).toFixed(6),
      lng: (c?.lng ?? UK_CENTRE[1]).toFixed(6),
      isNew: true,
    });
  };

  const lat = Number(draft?.lat);
  const lng = Number(draft?.lng);
  const valid =
    !!draft &&
    (draft.code.trim() !== '' || draft.name.trim() !== '') &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;

  const save = () => {
    if (!draft || !valid) return;
    const b: Building = {
      id: draft.id,
      code: draft.code.trim(),
      name: draft.name.trim() || draft.code.trim(),
      lat,
      lng,
    };
    update((s) => {
      const i = s.buildings.findIndex((x) => x.id === b.id);
      if (i >= 0) s.buildings[i] = b;
      else s.buildings.push(b);
    });
    setDraft(null);
    if (draft.isNew) mapRef.current?.flyTo([lat, lng], Math.max(mapRef.current.getZoom(), 17));
  };

  return (
    <div className="map-view">
      <aside className="map-side">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className={placing ? 'btn primary' : 'btn'}
            onClick={() => setPlacing((v) => !v)}
            title="Then click the map where the building is"
          >
            {placing ? 'Click the map…' : '+ Building'}
          </button>
          <span className="tiny dim">drag a pin to move it</span>
        </div>

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
                <b>{t.walk} min</b> walk, {t.gap} min gap{' '}
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
            Press + Building and click the map. Use the code your timetable uses ("MB" for "MB 2.14") and sessions
            will link to it.
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
                placeholder="MB"
              />
            </Field>
            <Field label="Name">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Maths Building"
              />
            </Field>
          </div>
          <div className="row">
            <Field label="Latitude">
              <input value={draft.lat} onChange={(e) => setDraft({ ...draft, lat: e.target.value })} />
            </Field>
            <Field label="Longitude">
              <input value={draft.lng} onChange={(e) => setDraft({ ...draft, lng: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
