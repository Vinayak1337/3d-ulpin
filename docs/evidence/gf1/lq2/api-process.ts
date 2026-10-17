import { bootstrap } from '../../../../apps/api/src/main';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';

await bootstrap();
setInterval(() => void dispatchTick().catch(error => process.send?.({ failure: error.message })), 500);
process.send?.({ ready: true });
