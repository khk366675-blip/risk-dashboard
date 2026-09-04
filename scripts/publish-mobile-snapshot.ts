import { publishLocalMobileSnapshot } from '../lib/server/mobile-local-sync.ts';

try {
  const result = await publishLocalMobileSnapshot();
  console.log(
    JSON.stringify(
      {
        status: 'published',
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
