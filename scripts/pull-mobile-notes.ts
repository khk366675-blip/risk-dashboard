import { pullRemoteMobileNotes } from '../lib/server/mobile-local-sync.ts';

try {
  const result = await pullRemoteMobileNotes();
  console.log(
    JSON.stringify(
      {
        status: 'pulled',
        ...result,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
