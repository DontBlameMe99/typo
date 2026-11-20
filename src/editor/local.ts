export function localBytes(path: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('GET', path)
    request.responseType = 'arraybuffer'
    request.timeout = 30000
    request.onload = () => {
      if ((request.status === 0 || request.status === 200) && request.response)
        resolve(new Uint8Array(request.response))
      else reject(new Error(`Cannot load bundled resource: ${path}`))
    }
    request.onerror = () => reject(new Error(`Cannot load bundled resource: ${path}`))
    request.ontimeout = () => reject(new Error(`Timed out loading bundled resource: ${path}`))
    request.send()
  })
}

export function fromBase64(value: string): Uint8Array {
  const decoded = atob(value)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index)
  return bytes
}

export function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let index = 0; index < bytes.length; index += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)))
  return btoa(chunks.join(''))
}
