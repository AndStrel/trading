import { constants } from 'node:fs';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function targetDirectory(args) {
  if (args.length === 0) return projectDirectory;
  if (args.length === 2 && args[0] === '--directory' && args[1]) return resolve(args[1]);
  throw new Error('arguments');
}

async function privateDirectory(path) {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  // Secure the opened directory, never a pathname that may resolve to a symlink.
  const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try {
    if (!(await directory.stat()).isDirectory()) throw new Error('unsafe-directory');
    await directory.chmod(0o700);
  } finally { await directory.close(); }
}

async function prepareEnvironment(directory) {
  const target = join(directory, '.env');
  const template = await readFile(join(projectDirectory, '.env.example'), 'utf8');
  if (parseEnv(template).T_INVEST_EXECUTION_MODE !== 'disabled') throw new Error('unsafe-template');
  let file;
  let created = false;
  try {
    file = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    created = true;
    await file.chmod(0o600);
    await file.writeFile(template, 'utf8');
    await file.sync();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    // No pathname-based chmod: an existing symlink must not redirect this operation.
    file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    if (!info.isFile()) throw new Error('unsafe-file');
    await file.chmod(0o600);
  } finally {
    await file?.close();
  }
  await privateDirectory(join(directory, '.trading'));
  await privateDirectory(join(directory, '.trading', 'relay'));
  await privateDirectory(join(directory, '.trading', 'paper'));
  return created;
}

try {
  const created = await prepareEnvironment(targetDirectory(process.argv.slice(2)));
  process.stdout.write(created
    ? '.env создан с правами 600; исполнение отключено.\n'
    : 'Существующий .env сохранён без изменения значений; права 600.\n');
  process.stdout.write('Приватные каталоги данных готовы. Заполните токены в .env и выполните npm run doctor.\n');
} catch {
  process.stderr.write('Настройка не завершена. Проверьте Node.js 22+, права каталога, обычный файл .env и отсутствие symlink. Значения конфигурации не выводились.\n');
  process.exitCode = 1;
}
