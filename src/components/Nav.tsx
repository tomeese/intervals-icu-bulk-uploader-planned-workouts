/* src/components/Nav.tsx */
import { Link } from 'react-router-dom';
import styles from './Nav.module.css';
import { REPO_URL } from '../config';

export default function Nav() {
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.brand}>Intervals Tools</Link>
      <nav className={styles.nav}>
        <Link to="/demo" className={styles.link}>Guardrails Demo</Link>
        {REPO_URL && (
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={styles.link}>
            GitHub
          </a>
        )}
      </nav>
    </header>
  );
}
