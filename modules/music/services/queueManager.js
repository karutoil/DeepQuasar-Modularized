// QueueManager Service: Per-guild queue and playback state
export class QueueManager {
  constructor() {
    this.queues = new Map(); // guildId => [track, ...]
  }

  getQueue(guildId) {
    if (!this.queues.has(guildId)) this.queues.set(guildId, []);
    return this.queues.get(guildId);
  }

  addTrack(guildId, track) {
    this.getQueue(guildId).push(track);
  }

  removeTrack(guildId, index) {
    const queue = this.getQueue(guildId);
    if (index >= 0 && index < queue.length) queue.splice(index, 1);
  }

  clearQueue(guildId) {
    this.queues.set(guildId, []);
  }

  shuffleQueue(guildId) {
    const queue = this.getQueue(guildId);
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
  }
}
