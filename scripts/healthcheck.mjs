// exits 0 when takaweb answers its health route, for docker and compose healthchecks
// plain node with no dependencies, so it runs inside the image as is

const port = process.env.PORT || "4321"
const url = `http://127.0.0.1:${port}/api/health`

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) })

  if (!response.ok) {
    console.error(`takaweb answered ${response.status}`)
    process.exit(1)
  }
} catch (error) {
  console.error(`takaweb is unreachable: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
