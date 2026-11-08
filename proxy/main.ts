import { loadProxyConfig } from './config.js'
import { createProxy } from './server.js'

const config = loadProxyConfig()
const proxy = createProxy(config)

const urls = await proxy.ready
console.info(
  JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    message: 'llm proxy listening',
    upstream: config.upstream,
    batch: urls.batch,
    interactive: urls.interactive,
    slots: config.maxConcurrent,
  }),
)

const shutdown = async (signal: string): Promise<void> => {
  console.info(
    JSON.stringify({ ts: new Date().toISOString(), level: 'info', message: 'llm proxy stopping', signal }),
  )
  await proxy.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
