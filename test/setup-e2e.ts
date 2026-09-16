import { config } from 'dotenv';
import { join } from 'node:path';

// Load the integration-test environment before anything reads process.env.
// `override: true` matters: the shell may already carry a dev DATABASE_URL, and
// pointing the truncating test suite at a dev database would wipe real data.
config({ path: join(__dirname, '..', '.env.test'), override: true });
