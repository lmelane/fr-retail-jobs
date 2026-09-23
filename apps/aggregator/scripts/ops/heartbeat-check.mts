import { pingHeartbeat } from '../../src/pipeline/heartbeat.js';

const [signal, ...extra] = process.argv.slice(2);
if (extra.length || !['start', 'fail', 'success'].includes(signal ?? '')) {
  throw new Error('Usage: heartbeat-check.mts start|fail|success');
}
const result = await pingHeartbeat(signal === 'start' ? 'start' : signal === 'success');
console.log(JSON.stringify({ event: 'heartbeat.controlled_test', signal, result, at: new Date().toISOString() }));
if (result !== 'pinged') process.exitCode = 1;
