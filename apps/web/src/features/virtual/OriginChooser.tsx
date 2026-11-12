import { placeSchema, type Place } from '@moviq/contracts';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { virtualApi } from './api';
import { useVirtualT } from './texts';

function useOriginChooser(onChange: (place: Place) => void) {
  const t = useVirtualT();
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<readonly Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const requests = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requests.current?.abort();
    };
  }, []);
  const search = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    requests.current?.abort();
    const controller = new AbortController();
    requests.current = controller;
    setBusy(true);
    setFailed(false);
    void virtualApi
      .places(query.trim(), controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setPlaces(result.places);
          setBusy(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
          setBusy(false);
        }
      });
  };
  const locate = () => {
    if (!('geolocation' in navigator)) {
      setFailed(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!alive.current) return;
        const parsed = placeSchema.safeParse({
          label: t.locate,
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          kind: 'device',
          stopId: null,
        });
        if (parsed.success) onChange(parsed.data);
        else setFailed(true);
        setBusy(false);
      },
      () => {
        if (alive.current) {
          setFailed(true);
          setBusy(false);
        }
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  return { query, setQuery, places, busy, failed, search, locate };
}

export function OriginChooser({
  origin,
  onChange,
}: {
  origin: Place | null;
  onChange: (place: Place) => void;
}) {
  const t = useVirtualT();
  const { query, setQuery, places, busy, failed, search, locate } = useOriginChooser(onChange);
  return (
    <section className="virtual-origin">
      <h3>{t.origin}</h3>
      <p>{t.originHelp}</p>
      <button className="btn small" type="button" disabled={busy} onClick={locate}>
        {busy ? t.searching : t.locate}
      </button>
      <form onSubmit={search}>
        <label htmlFor="virtual-origin">{t.search}</label>
        <div className="virtual-row">
          <input
            id="virtual-origin"
            value={query}
            minLength={2}
            maxLength={120}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            required
          />
          <button className="btn small" disabled={busy} type="submit">
            {t.searchButton}
          </button>
        </div>
      </form>
      {places !== null && places.length === 0 && <p role="status">{t.noPlaces}</p>}
      {places !== null && places.length > 0 && (
        <ul>
          {places.map((place) => (
            <li key={`${String(place.lat)}:${String(place.lon)}:${place.label}`}>
              <button
                className="ex-link"
                type="button"
                onClick={() => {
                  onChange(place);
                }}
              >
                {place.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed && <p role="alert">{t.locationFailed}</p>}
      {origin !== null && (
        <p>
          {t.selected}: <strong>{origin.label}</strong>
        </p>
      )}
      <p>{t.privacy}</p>
      <p>{t.travelUnknown}</p>
    </section>
  );
}
