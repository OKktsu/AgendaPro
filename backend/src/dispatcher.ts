import 'dotenv/config';
import { readQueueConfig } from './queue/config.js';
import { createReminderDatabases } from './queue/reminder-databases.js';
import { createReminderQueue, dispatchReminders } from './queue/reminders.js';
import { readDispatcherInterval, startDispatcherPolling } from './queue/dispatcher-polling.js';
import { installBackgroundShutdown } from './queue/background-shutdown.js';

const config = readQueueConfig();
const interval = readDispatcherInterval();
const databases = createReminderDatabases();
const queue = createReminderQueue(config);
const unavailable = () =>
  console.error(
    'Dispatcher: base ou fila indisponível; confira configuração e migrations. Pedidos permanecem no banco.',
  );
const polling = startDispatcherPolling(
  (shouldStop) => dispatchReminders(databases, queue, unavailable, shouldStop),
  interval,
  unavailable,
);
installBackgroundShutdown('dispatcher', async () => {
  await polling.close();
  await Promise.all([queue.close(), databases.close()]);
});
console.log('Dispatcher iniciado: publica pedidos no Redis; não consome nem envia lembretes.');
process.send?.({ type: 'started', role: 'dispatcher' });
