/** 验证入口：用本地 TS loader 直接跑真实 src 源码，无需联网构建。 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const result = spawnSync(
  process.execPath,
  ['--no-warnings', '--loader', resolve(here, 'ts-loader.mjs'), resolve(here, 'verify-training.ts')],
  { stdio: 'inherit' },
)
process.exit(result.status ?? 1)
