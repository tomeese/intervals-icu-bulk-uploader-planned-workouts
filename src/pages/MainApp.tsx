/*pages/MainApp.tsx*/
import styles from './MainApp.module.css'

// Tiny helper so images/CSS resolve under GH Pages base
const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`.replace(/\/{2,}/g, '/')

export default function MainApp() {
  return (
    <main className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Intervals Planner</h1>
        <p className={styles.sub}>
          Migrate sections from the legacy page here.
        </p>
      </header>
  
      <section className={styles.card}>
        <h2 className={styles.h2}>Plan Builder</h2>
        <div className={styles.body}>
          <p>Plan builder is TODO.</p>
        </div>
      </section>

      {/* shell for results/preview */}
      <section className={styles.card}>
        <h2 className={styles.h2}>Preview / Export</h2>
        <div className={styles.body}>
          {/* Connect to existing export logic */}
          <p>JSON preview will appear here.</p>
        </div>
      </section>
    </main>
  )
}
