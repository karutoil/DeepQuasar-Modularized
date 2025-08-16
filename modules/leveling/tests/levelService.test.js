import { LevelService } from '../services/levelService.js';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

let mongod;
let client;
let core;
let svc;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  const db = client.db('test');
  core = {
    config: { get: (k, d) => d, getBool: (k, d) => false },
    logger: { info: ()=>{}, error: ()=>{}, warn: ()=>{}, debug: ()=>{} },
    mongo: {
      getCollection: async (name) => db.collection(name)
    },
    bus: { emit: ()=>{} },
    client: { guilds: { fetch: ()=>null } }
  };
  svc = new LevelService(core);
  // ensure indexes
  await (await core.mongo.getCollection('leveling_guild_configs')).createIndex({ guildId: 1 }, { unique: true });
});

afterAll(async () => {
  if (client) await client.close();
  if (mongod) await mongod.stop();
});

test('xp and level calculations (linear)', async () => {
  const formula = { type: 'linear', baseXP: 100 };
  expect(svc.xpForLevel(1, formula)).toBe(100);
  expect(svc.xpForLevel(2, formula)).toBe(200);
  const cum = svc.cumulativeXPForLevel(3, formula);
  expect(cum).toBe(100 + 200 + 300);
  const lv = svc.levelForXP(350, formula);
  expect(lv.level).toBe(2);
});

test('award xp respects basic flow', async () => {
  const guildId = 'G1';
  const userId = 'U1';
  // set default config
  await (await core.mongo.getCollection('leveling_guild_configs')).insertOne({ guildId, xpPerMessage: 10, cooldownSeconds: 0, formula: { type: 'linear', baseXP: 50 }, roleRewards: [] });
  const res = await svc.awardXP({ guildId, userId, message: { content: 'Hello world', attachments: { size: 0 }, mentions: { users: new Map() } } });
  expect(res.addedXP).toBeGreaterThan(0);
  const profile = await svc.getProfile({ guildId, userId });
  expect(profile.xp).toBeGreaterThan(0);
});
