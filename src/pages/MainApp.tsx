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
          TBD.
        </p>
      </header>
    </main>
  )
}
