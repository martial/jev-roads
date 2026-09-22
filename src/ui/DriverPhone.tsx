import type { PhoneView } from '../sim/phone';
import { PHONE_PENALTY } from '../sim/phone';

export function DriverPhone({ phone, onInterrupt }: { phone: PhoneView; onInterrupt: () => void }) {
  const ringing = phone.phase === 'ringing';
  const seconds = Math.floor(phone.elapsed);
  return <aside className={`driver-phone is-${phone.phase}`} aria-label="Driver’s phone call">
    <div className="phone-handset" aria-hidden="true">
      <div className="phone-speaker" />
      <div className="phone-lcd"><svg viewBox="0 0 24 24"><path d="M6 3 3 5c-1 7 8 16 15 15l3-3-5-4-2 2c-3-1-5-3-6-6l2-2Z" /></svg><span>{ringing ? 'RING RING' : 'ON AIR'}</span></div>
      <div className="phone-keys">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</div>
    </div>
    <div className="phone-details">
      <p className="phone-eyebrow" role="status">{ringing ? 'His phone is ringing' : 'You’re on speakerphone'}</p>
      <strong className="phone-caller">{phone.caller}</strong>
      <p className="phone-relation">{phone.relation} <span>· {ringing ? 'He’ll pick up in a moment…' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</span></p>
      <div className="phone-wave" aria-hidden="true">{Array.from({ length: 15 }, (_, i) => <i key={i} style={{ animationDelay: `${i * -0.13}s` }} />)}</div>
    </div>
    <button type="button" className="phone-interrupt" onClick={onInterrupt}><span>Interrupt</span><small>−{PHONE_PENALTY} sympathy</small></button>
    <p className="phone-hint">{ringing ? 'Apparently this cannot wait.' : 'His conversation. Your meter.'}</p>
  </aside>;
}
