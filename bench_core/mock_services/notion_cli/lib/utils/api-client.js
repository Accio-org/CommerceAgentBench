import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class MockApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl || `http://localhost:${process.env.NTN_MOCK_PORT || 3456}`;
  }

  async _fetch(urlPath, options = {}) {
    const url = new URL(urlPath, this.baseUrl).toString();
    try {
      const res = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      if (!res.ok) {
        const msg = typeof data === 'object' && data.error ? data.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data;
    } catch (err) {
      if (err.cause?.code === 'ECONNREFUSED' && !process.env.NTN_MOCK_NO_AUTO_SERVER) {
        await this.ensureServer();
        return this._fetch(urlPath, options);
      }
      throw err;
    }
  }

  async get(urlPath) {
    return this._fetch(urlPath);
  }

  async post(urlPath, body) {
    return this._fetch(urlPath, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async patch(urlPath, body) {
    return this._fetch(urlPath, { method: 'PATCH', body: JSON.stringify(body) });
  }

  async delete(urlPath) {
    return this._fetch(urlPath, { method: 'DELETE' });
  }

  async ensureServer() {
    const serverPath = path.join(__dirname, '../server/index.js');
    const runtime = process.env.NTN_MOCK_RUNTIME || 'bun';
    const child = spawn(runtime, [serverPath], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        await fetch(new URL('/health', this.baseUrl).toString());
        return;
      } catch { /* retry */ }
    }
    throw new Error(`Could not start mock server. Try running: npm start`);
  }
}

let _client;
export function getClient() {
  if (!_client) _client = new MockApiClient();
  return _client;
}
