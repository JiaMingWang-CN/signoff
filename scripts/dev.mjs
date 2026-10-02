import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { concurrently } from 'concurrently';

const root = fileURLToPath(new URL('..', import.meta.url));
const python = join(root, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

if (!existsSync(python)) {
  console.error('后端虚拟环境未准备好，请先运行 start.ps1（Windows）或 start.sh（Linux）安装依赖。');
  process.exit(1);
}

const quotedPython = process.platform === 'win32' ? `"${python}"` : `'${python.replaceAll("'", "'\"'\"'")}'`;
const { result } = concurrently(
  [
    { name: 'backend', command: `${quotedPython} run.py`, cwd: join(root, 'backend'), prefixColor: 'cyan' },
    { name: 'frontend', command: 'npm run dev', cwd: join(root, 'frontend'), prefixColor: 'magenta' },
  ],
  { prefix: 'name', killOthersOn: ['success', 'failure'] },
);

try {
  await result;
} catch {
  process.exitCode = 1;
}
