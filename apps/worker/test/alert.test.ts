import { describe, expect, it, vi } from 'vitest';
import { sendTelegramAlert } from '../src/alert.js';

describe('sendTelegramAlert', () => {
  it('resposta não-ok: loga aviso com status e corpo, sem lançar', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fakeFetch = (async () =>
      new Response('chat not found', { status: 400 })) as typeof fetch;

    await expect(
      sendTelegramAlert('oi', 'bot-token', 'chat-id', fakeFetch),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.level).toBe('error');
    expect(logged.status).toBe(400);
    expect(logged.body).toBe('chat not found');

    errorSpy.mockRestore();
  });

  it('token ausente: nunca chama fetch', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));

    await sendTelegramAlert('oi', undefined, 'chat-id', fetchSpy as unknown as typeof fetch);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
