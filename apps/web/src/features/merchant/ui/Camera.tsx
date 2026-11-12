import { useEffect, useRef, useState } from 'react';

import { useMerchantT } from '../texts';

interface Detector {
  detect(source: HTMLVideoElement): Promise<readonly { readonly rawValue: string }[]>;
}

type DetectorClass = new (options: { formats: string[] }) => Detector;

/** The browser's `BarcodeDetector`, where it has one (Chrome and Edge on most devices). */
function detectorClass(): DetectorClass | undefined {
  return (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
}

const LOOK_MS = 400;

type CameraState = 'off' | 'on' | 'denied';

/**
 * Reads the customer's QR with the camera when the browser can, and hands its text over once.
 * The camera starts only when asked and stops when a code is read or the screen closes.
 */
export function Camera({ onCode }: { onCode: (code: string) => void }) {
  const t = useMerchantT().scan;
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>('off');
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    const Detector = detectorClass();
    const element = video.current;
    if (state !== 'on' || Detector === undefined || element === null) return;
    const detector = new Detector({ formats: ['qr_code'] });
    let stream: MediaStream | null = null;
    let stopped = false;
    const stop = () => {
      stopped = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
    const timer = setInterval(() => {
      if (stopped || element.readyState < 2) return;
      void detector.detect(element).then((codes) => {
        const [first] = codes;
        if (first === undefined || stopped) return;
        stop();
        setState('off');
        onCodeRef.current(first.rawValue);
      });
    }, LOOK_MS);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(
      (opened) => {
        stream = opened;
        if (stopped) stop();
        else {
          element.srcObject = opened;
          void element.play();
        }
      },
      () => {
        setState('denied');
      },
    );
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [state]);

  if (detectorClass() === undefined) return <p className="mc-quiet">{t.noCamera}</p>;
  return (
    <div className="mc-camera">
      <video ref={video} hidden={state !== 'on'} muted playsInline aria-label={t.cameraLabel} />
      {state === 'on' && <p className="mc-note">{t.cameraHint}</p>}
      {state === 'denied' && <p className="mc-quiet">{t.denied}</p>}
      <button
        type="button"
        className="btn"
        onClick={() => {
          setState(state === 'on' ? 'off' : 'on');
        }}
      >
        {state === 'on' ? t.stop : t.camera}
      </button>
    </div>
  );
}
