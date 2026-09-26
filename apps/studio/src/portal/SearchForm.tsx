import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { Button } from '@ulpin/ui';
import styles from './Portal.module.css';

/** One field for a 3D ULPIN, a parcel ULPIN or an address; results open on their own page. */
export function SearchForm({ initial = '' }: { initial?: string }) {
  const [q, setQ] = useState(initial);
  const navigate = useNavigate();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (q.trim()) navigate(`/portal/search?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <form role="search" className={styles.search} onSubmit={submit}>
      <label className="ul-field">
        <span className="portal-label">3D ULPIN, parcel ULPIN or address</span>
        <input className={`ul-input ${styles.bigInput}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Flat 704 Lake View" autoComplete="off" />
      </label>
      <Button type="submit" variant="primary" icon={MagnifyingGlass} className={styles.bigButton}>Search</Button>
    </form>
  );
}
