import { networkInterfaces } from 'node:os';

/** `enve-memory://pair?url=…&token=…&name=…` — scanned or opened by the phone app to connect. */
export function pairingLink(url: string, token: string, name: string): string {
  const params = new URLSearchParams({ url, token, name });
  return `enve-memory://pair?${params}`;
}

/** Base URLs other devices can use to reach this machine, private IPv4 first (Tailscale's 100.64/10 included). */
export function lanUrls(port: number): string[] {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a !== undefined && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
  return addresses.map((address) => `http://${address}:${port}`);
}
