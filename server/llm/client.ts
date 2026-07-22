// Shared OpenRouter client singleton (loads .env on first use).

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './env.ts'
import { createOpenRouter } from './openrouter.ts'
import type { OpenRouterClient } from './openrouter.ts'

let client: OpenRouterClient | null = null

export function getClient(): OpenRouterClient {
  if (!client) {
    loadEnv(path.dirname(fileURLToPath(import.meta.url)))
    client = createOpenRouter()
  }
  return client
}
