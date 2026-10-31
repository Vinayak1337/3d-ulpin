import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

/** What the stand-in learner does once its stdin ends; an unset code with no error never closes (a hang). */
export type StudentReply = { stdout?: string; stderr?: string; code?: number; error?: boolean; delayMs?: number };

/** A spawned-learner stand-in with real streams: reads stdin to its end, then replies and closes. Not truth. */
export function fakeStudentChild(reply: (input: string) => StudentReply) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kills: 0,
    kill: () => {
      child.kills += 1;
      return true;
    },
  });
  const chunks: Buffer[] = [];
  child.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stdin.on('end', () => {
    const answer = reply(Buffer.concat(chunks).toString('utf8'));
    setTimeout(() => respond(child, answer), answer.delayMs ?? 0);
  });
  return child;
}

function respond(child: ReturnType<typeof fakeStudentChild>, answer: StudentReply) {
  if (answer.error) {
    child.emit('error', Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' }));
    return;
  }
  if (answer.stdout) child.stdout.write(answer.stdout);
  if (answer.stderr) child.stderr.write(answer.stderr);
  if (answer.code === undefined) return;
  child.stdout.end();
  child.stderr.end();
  setImmediate(() => child.emit('close', answer.code, null));
}
