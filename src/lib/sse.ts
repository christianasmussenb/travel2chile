export function extractSseFrames(chunk: string, remainder = '') {
  const combined = remainder + chunk
  const frames: string[] = []
  let searchFrom = 0

  while (true) {
    const delimiterIndex = combined.indexOf('\n\n', searchFrom)
    if (delimiterIndex === -1) break
    frames.push(combined.slice(searchFrom, delimiterIndex))
    searchFrom = delimiterIndex + 2
  }

  return {
    frames,
    remainder: combined.slice(searchFrom),
  }
}
