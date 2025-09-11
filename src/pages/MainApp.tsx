/*pages/MainApp.tsx*/
import styles from './MainApp.module.css'

// Tiny helper so images/CSS you move to /public resolve under GH Pages base
const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`.replace(/\/{2,}/g, '/')

export default function MainApp() {
  return (
    <main className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Intervals Planner</h1>
        <p className={styles.sub}>
          Ported into React. We’ll migrate sections from the legacy page here.
        </p>
      </header>

      {/* === START migrating legacy sections here === */}
      {/* Example: if you had a hero/banner image in legacy: */}
      {/* <img src={asset('legacy-assets/banner.png')} alt="" className={styles.hero} /> */}

      {/* Example shell for the legacy form area; replace with real fields as you port */}
      <section className={styles.card}>
        <h2 className={styles.h2}>Plan Builder</h2>
        <div className={styles.body}>
          {/* Paste legacy form markup here, then convert attributes: class -> className, onchange -> onChange, etc. */}
          {/* Replace document.querySelector(...) scripts with React state/effects in this component. */}
          <p>Start pasting legacy markup here.</p>
        </div>
      </section>

      {/* Example shell for results/preview */}
      <section className={styles.card}>
        <h2 className={styles.h2}>Preview / Export</h2>
        <div className={styles.body}>
          {/* Connect to your existing export logic (we’ll wire the JSON download + GH workflow later). */}
          <p>JSON preview will appear here.</p>
        </div>
      </section>
      {/* === END migrating legacy sections === */}
    </main>
  )
}
