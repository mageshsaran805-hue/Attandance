import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverMigrations } from './migrate.js';

describe('migration discovery', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'migrations-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns .sql migrations sorted by number, not by filename text', async () => {
    await writeFile(path.join(dir, '0010_ten.sql'), 'SELECT 10;');
    await writeFile(path.join(dir, '0002_two.sql'), 'SELECT 2;');
    await writeFile(path.join(dir, '0001_one.sql'), 'SELECT 1;');

    const migrations = await discoverMigrations(dir);

    expect(migrations.map((migration) => migration.filename)).toEqual([
      '0001_one.sql',
      '0002_two.sql',
      '0010_ten.sql',
    ]);
  });

  it('ignores non-SQL files', async () => {
    await writeFile(path.join(dir, '0001_one.sql'), 'SELECT 1;');
    await writeFile(path.join(dir, 'README.md'), '# not a migration');

    const migrations = await discoverMigrations(dir);

    expect(migrations.map((migration) => migration.filename)).toEqual(['0001_one.sql']);
  });

  it('rejects SQL files that do not follow the naming convention', async () => {
    await writeFile(path.join(dir, 'bad_name.sql'), 'SELECT 1;');

    await expect(discoverMigrations(dir)).rejects.toThrow(/Invalid migration filename/);
  });

  it('rejects uppercase or too-short numbers', async () => {
    await writeFile(path.join(dir, '01_Two.sql'), 'SELECT 1;');

    await expect(discoverMigrations(dir)).rejects.toThrow(/Invalid migration filename/);
  });

  it('rejects duplicate migration numbers', async () => {
    await writeFile(path.join(dir, '0001_first.sql'), 'SELECT 1;');
    await writeFile(path.join(dir, '0001_second.sql'), 'SELECT 2;');

    await expect(discoverMigrations(dir)).rejects.toThrow(/Duplicate migration number 0001/);
  });

  it('returns an empty list for an empty directory', async () => {
    expect(await discoverMigrations(dir)).toEqual([]);
  });
});
