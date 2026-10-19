import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { Card } from '../ui';

export const REVOLUT_HANDLE = '@vallentes';
export const REVOLUT_URL = 'https://revolut.me/vallentes';

function Copy({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn small secondary"
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? 'Copied' : label}
    </button>
  );
}

/** QR code for the Revolut link, generated locally. */
function RevolutQr() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) void QRCode.toCanvas(ref.current, REVOLUT_URL, { width: 168, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#191c1f', light: '#ffffff' } });
  }, []);
  return <canvas ref={ref} role="img" aria-label={`QR code for ${REVOLUT_URL}`} className="qr" />;
}

export function SupportScreen() {
  return (
    <>
      <h1>Support Desktop Chaos</h1>
      <p className="lead">Desktop Chaos is free. No trial, no ads, no tracking. Just a lot of broken glass.</p>
      <Card>
        <div className="row" style={{ gap: 20, alignItems: 'center' }}>
          <span style={{ fontSize: 64 }}>☕</span>
          <div className="stack" style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>Smashing screens is thirsty work.</h2>
            <p className="muted" style={{ margin: 0 }}>
              If Desktop Chaos saved a real monitor from a real keyboard, a coffee keeps the meteors coming and the bugs (mostly) squashed.
            </p>
            <div className="row">
              <button className="btn big" onClick={() => void api.openSupportLink('coffee')}>
                ☕ Buy me a coffee
              </button>
            </div>
            <small className="muted">Opens buymeacoffee.com/vallentes in your browser.</small>
          </div>
        </div>
      </Card>
      <Card title="Tip with Revolut">
        <div className="row" style={{ gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <RevolutQr />
          <div className="stack" style={{ flex: 1, minWidth: 220 }}>
            <div className="row">
              <b style={{ fontSize: 22 }}>{REVOLUT_HANDLE}</b>
              <Copy value={REVOLUT_HANDLE} />
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Scan with your phone camera or open the link. You can pay with Revolut, any debit or credit card, or Apple Pay. No Revolut account needed.
            </p>
            <div className="row">
              <button className="btn" onClick={() => void api.openSupportLink('revolut')}>
                Open revolut.me/vallentes
              </button>
              <Copy value={REVOLUT_URL} label="Copy link" />
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
