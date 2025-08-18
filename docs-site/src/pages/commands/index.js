import React from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './commands.module.css';

const COMMANDS = [
  'autorole', 'cleanup', 'discord-chat-agent', 'embedbuilder', 'invite-leaderboard',
  'kitchen-sink', 'message-quote', 'moderation', 'modlog', 'music', 'reminders', 'stats', 'tickets', 'welcomeleave'
];

function CommandCard({slug}){
  const url = `/commands/${slug}`;
  const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return (
    <Link to={url} className={styles.card}>
      <div className={styles.cardInner}>
        <div className={styles.cardIcon} aria-hidden>🔧</div>
        <div>
          <div className={styles.cardTitle}>{title}</div>
          <div className={styles.cardDesc}>Read the {title} command guide.</div>
        </div>
      </div>
    </Link>
  );
}

export default function CommandsIndex(){
  const img = useBaseUrl('img/commands-illustration.svg');
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1 className={styles.title}>Commands</h1>
          <p className={styles.lead}>A curated reference for all built-in and module-provided commands.</p>
        </div>
        <div className={styles.headerVisual}>
          <img src={img} alt="Commands illustration" />
        </div>
      </header>

      <section className={styles.gridWrap}>
        <div className={styles.grid}>
          {COMMANDS.map(c => <CommandCard key={c} slug={c} />)}
        </div>
      </section>
    </main>
  );
}
