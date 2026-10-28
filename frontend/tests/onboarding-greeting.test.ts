import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Fork: the welcome line takes the app name from lib/brand.ts instead of naming Wardrowbe.
const messagesDir = join(__dirname, '..', 'messages');

describe('onboarding greeting', () => {
  for (const locale of readdirSync(messagesDir)) {
    it(`uses the app name placeholder in ${locale}`, () => {
      const onboarding = JSON.parse(readFileSync(join(messagesDir, locale, 'onboarding.json'), 'utf8'));
      const greeting: string = onboarding.welcome.greeting;
      expect(greeting).toContain('{app}');
      expect(greeting).toContain('{name}');
      expect(greeting).not.toContain('Wardrowbe');
    });
  }
});
