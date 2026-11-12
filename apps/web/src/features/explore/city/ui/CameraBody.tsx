import type { CameraImageTimeBasis, CityDetail } from '@moviq/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocale } from '../../../../shared/i18n';
import { formatCityDay, formatCityTime } from '../../../../shared/time/city';
import { Icon } from '../../../../shared/ui/Icon';
import { fetchCameraPicture, type CameraPicture } from '../api';
import { useCityCardT } from '../texts';

/** The server asks a camera once a minute at most: the card never asks more often. */
const RENEW_MS = 60_000;

type Camera = Extract<CityDetail, { kind: 'camera' }>;
type Failure = Extract<CameraPicture, { ok: false }>['reason'];

interface Shown {
  readonly url: string;
  readonly time: string;
  readonly basis: CameraImageTimeBasis;
}

/**
 * The camera's latest picture, asked of MovIQ: on opening, on "Refresh" and once a minute, each
 * new one replacing the last in place, with no fade. A failure keeps the last good picture.
 */
function usePicture(id: string) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [asking, setAsking] = useState(true);
  const [round, setRound] = useState(0);
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchCameraPicture(id, controller.signal)
      .then((picture) => {
        if (picture.ok) {
          const url = URL.createObjectURL(picture.blob);
          if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
          urlRef.current = url;
          setShown({ url, time: picture.time, basis: picture.basis });
          setFailure(null);
        } else {
          setFailure(picture.reason);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setAsking(false);
      });
    const timer = setTimeout(() => {
      setRound((value) => value + 1);
    }, RENEW_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, round]);
  useEffect(
    () => () => {
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );
  const refresh = useCallback(() => {
    setAsking(true);
    setRound((value) => value + 1);
  }, []);
  return { shown, failure, asking, refresh };
}

const canPlayHls = () =>
  document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';

/** The live video, only once asked for; where the browser plays no HLS, the official address. */
function Video({ url }: { url: string }) {
  const t = useCityCardT();
  const [asked, setAsked] = useState(false);
  if (!asked) {
    return (
      <div className="ex-cam-video">
        <button
          type="button"
          className="ex-cam-button"
          onClick={() => {
            setAsked(true);
          }}
        >
          {t.camera.video}
        </button>
        <span className="ex-note">{t.camera.videoNote}</span>
      </div>
    );
  }
  if (!canPlayHls()) {
    return (
      <div className="ex-cam-video">
        <p className="ex-note">{t.camera.noHls}</p>
        <a className="ex-ev-official" href={url} target="_blank" rel="noopener noreferrer">
          {t.camera.videoLink}
          <Icon name="external" />
        </a>
      </div>
    );
  }
  return <video className="ex-cam-picture" src={url} controls autoPlay muted playsInline />;
}

/** The picture, its time and the way to ask it again. */
function Picture({ id, name }: { id: string; name: string }) {
  const t = useCityCardT();
  const locale = useLocale();
  const { shown, failure, asking, refresh } = usePicture(id);
  return (
    <section className="ex-group ex-cam" aria-label={t.camera.alt(name)}>
      {shown !== null && (
        <img className="ex-cam-picture" src={shown.url} alt={t.camera.alt(name)} />
      )}
      {shown === null && failure === null && <p className="ex-note">{t.camera.loading}</p>}
      {shown !== null && (
        <p className="ex-cam-time">
          {shown.basis === 'source'
            ? t.camera.at(formatCityTime(shown.time, locale))
            : t.camera.received(formatCityTime(shown.time, locale))}
        </p>
      )}
      {failure !== null && <p className="ex-state ex-late">{t.camera[failure]}</p>}
      <div className="ex-cam-actions">
        <button type="button" className="ex-cam-button" disabled={asking} onClick={refresh}>
          <Icon name="refresh" />
          {t.camera.refresh}
        </button>
        <span className="ex-note">{t.camera.refreshNote}</span>
      </div>
    </section>
  );
}

/** A traffic camera: its picture through MovIQ with its time, its owner and, if asked, video. */
export function CameraBody({ id, name, detail }: { id: string; name: string; detail: Camera }) {
  const t = useCityCardT();
  const locale = useLocale();
  return (
    <>
      {detail.picture ? (
        <Picture id={id.replace(/^cameras:/, '')} name={name} />
      ) : (
        <p className="ex-note">{t.camera['not-found']}</p>
      )}
      {detail.videoUrl !== null && <Video url={detail.videoUrl} />}
      <section className="ex-group">
        <span className="ex-v">{t.camera.owner(detail.owner)}</span>
        {detail.recordUpdatedAt !== null && (
          <span className="ex-note">
            {t.camera.record(formatCityDay(detail.recordUpdatedAt, locale))}
          </span>
        )}
      </section>
    </>
  );
}
