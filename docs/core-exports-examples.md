# Core Exports Usage Examples

## builders.js
### InteractionCommandBuilder


```js
import { InteractionCommandBuilder } from '../core/builders.js';

const instance = new InteractionCommandBuilder();
```

### createInteractionCommand


```js
import { createInteractionCommand } from '../core/builders.js';

createInteractionCommand(/* args */);
```

### createBuilderRegistry


```js
import { createBuilderRegistry } from '../core/builders.js';

createBuilderRegistry(/* args */);
```

## bus.js
### createBus


```js
import { createBus } from '../core/bus.js';

createBus(/* args */);
```

## commandHandler.js
### createCommandHandler


```js
import { createCommandHandler } from '../core/commandHandler.js';

createCommandHandler(/* args */);
```

## config.js
### createConfig


```js
import { createConfig } from '../core/config.js';

createConfig(/* args */);
```

## dsl.js
### createDsl


```js
import { createDsl } from '../core/dsl.js';

createDsl(/* args */);
```

## embed.js
### createEmbed


```js
import { createEmbed } from '../core/embed.js';

createEmbed(/* args */);
```

## events.js
### createEvents


```js
import { createEvents } from '../core/events.js';

createEvents(/* args */);
```

## guildConfig.js
### createGuildConfig


```js
import { createGuildConfig } from '../core/guildConfig.js';

createGuildConfig(/* args */);
```

## http.js
### createHttp


```js
import { createHttp } from '../core/http.js';

createHttp(/* args */);
```

## i18n.js
### createI18n


```js
import { createI18n } from '../core/i18n.js';

createI18n(/* args */);
```

## ids.js
### createIds


```js
import { createIds } from '../core/ids.js';

createIds(/* args */);
```

## index.js
### createCore


```js
import { createCore } from '../core/index.js';

createCore(/* args */);
```

## interactions.js
### createInteractions


```js
import { createInteractions } from '../core/interactions.js';

createInteractions(/* args */);
```

## logger.js
### getLogger


```js
import { getLogger } from '../core/logger.js';

getLogger(/* args */);
```

### createLogger


```js
import { createLogger } from '../core/logger.js';

createLogger(/* args */);
```

### childLogger


```js
import { childLogger } from '../core/logger.js';

childLogger(/* args */);
```

## metrics.js
### createMetrics


```js
import { createMetrics } from '../core/metrics.js';

createMetrics(/* args */);
```

## mongo.js
### createMongo


```js
import { createMongo } from '../core/mongo.js';

createMongo(/* args */);
```

## permissions.js
### createPermissions


```js
import { createPermissions } from '../core/permissions.js';

createPermissions(/* args */);
```

## rateLimiter.js
### createRateLimiter


```js
import { createRateLimiter } from '../core/rateLimiter.js';

createRateLimiter(/* args */);
```

## reporting.js
### createErrorReporter


```js
import { createErrorReporter } from '../core/reporting.js';

createErrorReporter(/* args */);
```

## result.js
### Result


```js
import { Result } from '../core/result.js';

const instance = new Result();
```

### ErrorCodes


```js
import { ErrorCodes } from '../core/result.js';

console.log(ErrorCodes);
```

### normalizeError


```js
import { normalizeError } from '../core/result.js';

normalizeError(/* args */);
```

## scheduler.js
### createScheduler


```js
import { createScheduler } from '../core/scheduler.js';

createScheduler(/* args */);
```

## state.js
### createStateManager


```js
import { createStateManager } from '../core/state.js';

createStateManager(/* args */);
```

## ui.js
### createPaginatedEmbed


```js
import { createPaginatedEmbed } from '../core/ui.js';

createPaginatedEmbed(/* args */);
```

### createConfirmationDialog


```js
import { createConfirmationDialog } from '../core/ui.js';

createConfirmationDialog(/* args */);
```

### createMultiSelectMenu


```js
import { createMultiSelectMenu } from '../core/ui.js';

createMultiSelectMenu(/* args */);
```

### createForm


```js
import { createForm } from '../core/ui.js';

createForm(/* args */);
```

### parseModal


```js
import { parseModal } from '../core/ui.js';

parseModal(/* args */);
```

### createWizard


```js
import { createWizard } from '../core/ui.js';

createWizard(/* args */);
```

## commands/autocomplete-debug.js
### register

```js
import { register } from '../core/commands/autocomplete-debug.js';

register(/* args */);
```

## commands/linecount.js
### register

```js
import { register } from '../core/commands/linecount.js';

register(/* args */);
```

