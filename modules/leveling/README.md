# Leveling Module

This module provides XP/leveling mechanics, leaderboards, profiles, and an interactive admin UI.

Features
- XP awarding for messages with configurable weights and cooldowns
- Leveling curves (linear, exponential, custom)
- Role rewards and temporary roles
- Leaderboards (guild/global) and profile views
- Interactive `/leveling config` admin UI using buttons, selects and modals
- Events emitted: `xpEarned`, `levelup`

Installation
1. Copy `modules/leveling/` into your bot's `modules/` folder.
2. Ensure MongoDB is configured in your main `.env` and `core/mongo.js` works.
3. (Optional) Install Canvas if you want rank card images: `npm install canvas`
4. Restart the bot and the module will create necessary collections and indexes.

Environment
See `module.env.example` for available keys. Add to your main `.env` as needed.

Commands
- /leveling config — admin interactive UI (Manage Guild required for modifications)
- /level profile [user]
- /level leaderboard [page]
- /level xp — show your xp/level info
- /level optin /level optout
- /level export (admin)
- /level import (admin)

Running tests
From repository root:

```bash
# install jest and test deps if not present
npm install --no-save jest @discordjs/builders mongodb-memory-server sinon
# run tests for module
npx jest modules/leveling/tests --runInBand
```

API
- LevelService.awardXP(opts)
- LevelService.getLeaderboard(opts)

Notes
- Uses `core/mongo.js` for DB access and `core/logger.js` for logging.
- Avoid unsafe eval of custom expressions; the module uses a limited sandbox for formulas.
