import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@ulpin/ui';
import styles from './Portal.module.css';

/** P4: verify a Property Card by the code printed on it (the card's QR opens the same result directly). */
export function VerifyPortal() {
  const [code, setCode] = useState('');
  const [rev, setRev] = useState('');
  const navigate = useNavigate();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = code.trim().toUpperCase().replace(/\s+/g, '');
    if (clean) navigate(`/verify/${encodeURIComponent(clean)}${rev.trim() ? `?rev=${rev.trim().replace(/^r/i, '')}` : ''}`);
  };
  return (
    <div className={styles.wrap}>
      <div className={styles.verifyBox}>
        <h1 className="portal-h1">Verify a Property Card</h1>
        <p className="portal-body ul-muted">Enter the 3D ULPIN printed on the card, or scan its QR code with your phone camera.</p>
        <form className={styles.verifyForm} onSubmit={submit}>
          <label className="ul-field"><span className="portal-label">3D ULPIN</span>
            <input className={`ul-input ${styles.bigInput} ul-mono`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="P3-…" autoComplete="off" spellCheck={false} /></label>
          <label className="ul-field"><span className="portal-label">Revision (optional)</span>
            <input className={`ul-input ${styles.bigInput}`} value={rev} onChange={(e) => setRev(e.target.value)} placeholder="r3" /></label>
          <Button type="submit" variant="primary" className={styles.bigButton} disabled={!code.trim()}>Verify</Button>
        </form>
      </div>
    </div>
  );
}
