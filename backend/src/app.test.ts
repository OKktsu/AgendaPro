import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('GET /health', () => {
  const app = buildApp();

  afterEach(async () => {
    await app.close();
  });

  it('reports the API as healthy', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });
});

