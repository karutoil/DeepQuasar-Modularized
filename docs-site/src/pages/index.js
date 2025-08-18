import React from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './styles.module.css';

function Feature({title, desc, icon}){
  return (
    <div className={styles.feature}>
      <div className={styles.featureIcon} dangerouslySetInnerHTML={{__html: icon}} />
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>
  );
}

export default function Home() {
  const heroImg = useBaseUrl('img/hero-illustration.svg');
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.inner}>
          <div className={styles.copy}>
            <h1 className={styles.title}>DeepQuasar — Modular Discord tooling, elevated</h1>
            <p className={styles.lead}>Build, ship and maintain Discord modules with confidence. Fast scaffolding, robust core, and clear extension points.</p>

            <div className={styles.ctas}>
              <Link className={styles.ctaPrimary} to="/commands/">Browse Commands</Link>
              <Link className={styles.ctaGhost} to="/create_a_module">Create a module</Link>
            </div>
            <div className={styles.trust}>
              <span className={styles.trustText}>Used in production by modular bot teams</span>
            </div>
          </div>

          <div className={styles.visual}>
            <img src={heroImg} alt="DeepQuasar illustration" className={styles.heroImg} />
          </div>
        </div>
      </section>

      <section className={styles.featuresSection}>
        <div className={styles.featuresInner}>
          <Feature
            title="Modular Architecture"
            desc="Enable/disable modules, clean separation of concerns, and straightforward wiring."
            icon={`<svg width=40 height=40 viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'><rect width='24' height='24' rx='6' fill='url(#g)' /><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='#0ea5ff'/><stop offset='1' stop-color='#7c3aed'/></linearGradient></defs></svg>`}
          />

          <Feature
            title="Sleek Developer UX"
            desc="Clear APIs, examples, and scaffolding commands get you productive in minutes."
            icon={`<svg width=40 height=40 viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='10' fill='url(#g)' /><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='#0ea5ff'/><stop offset='1' stop-color='#7c3aed'/></linearGradient></defs></svg>`}
          />

          <Feature
            title="Production-ready"
            desc="Logging, rate-limiting, permissions and sane defaults so you ship safely."
            icon={`<svg width=40 height=40 viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M3 12h18' stroke='url(#g)' stroke-width='2' stroke-linecap='round' /><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='#0ea5ff'/><stop offset='1' stop-color='#7c3aed'/></linearGradient></defs></svg>`}
          />
        </div>
      </section>
    </main>
  );
}
