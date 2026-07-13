import { describe, expect, it } from 'vitest';
import { withRetry } from '../src/loop.js';

const noSleep = async (): Promise<void> => {};

describe('withRetry', () => {
  it('retorna no primeiro sucesso', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 'ok';
    }, 3, noSleep);
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('tenta de novo após falha e retorna sucesso', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error('boom');
      return 'ok';
    }, 3, noSleep);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('esgota tentativas e propaga o último erro', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error('sempre falha');
      }, 3, noSleep),
    ).rejects.toThrow('sempre falha');
    expect(calls).toBe(3);
  });
});
