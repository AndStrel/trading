import { beforeEach, describe, expect, it, vi } from 'vitest';

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('./history/frozen-moex-minute-capture.js', () => ({ captureFrozenMoexMinuteSource: capture,
  FrozenMoexCaptureError: class extends Error {} }));
import { parseFrozenCaptureArgs, runFrozenCaptureCli } from './capture-catalog-history.js';

describe('bounded public frozen history capture CLI', () => {
  beforeEach(() => { capture.mockReset(); });
  it('has no inferred data path or credentials and help makes no request', () => {
    expect(parseFrozenCaptureArgs([])).toEqual({ outputDirectory: null, help: false });
    expect(parseFrozenCaptureArgs(['--help'])).toEqual({ outputDirectory: null, help: true });
    expect(capture).not.toHaveBeenCalled();
  });
  it.each([['--output', '/tmp/new-source'], ['--output=/tmp/new-source']])('accepts only an explicit output %j', (...args) => {
    expect(parseFrozenCaptureArgs(args)).toEqual({ outputDirectory: '/tmp/new-source', help: false });
  });
  it.each([
    ['--database=/tmp/original.sqlite'], ['--token', 'private-token'], ['--ticker=SBER'], ['--interval=10'],
    ['--from=2026-01-01'], ['--strategy=trend-momentum-v1'], ['--resume'], ['--output=relative'],
    ['--output'], ['--output='], ['--output=/tmp/a', '--output=/tmp/b'], ['--help=yes'],
    ['--output=/tmp/\0bad'], ['--output=/' + 'a'.repeat(4096)],
  ])('rejects mutable protocol, secret or malformed options %j', (...args) => {
    expect(() => parseFrozenCaptureArgs(args)).toThrow();
    expect(capture).not.toHaveBeenCalled();
  });
  it('requires an explicit path before invoking the source module', async () => {
    await expect(runFrozenCaptureCli(parseFrozenCaptureArgs([]))).rejects.toThrow('explicit');
    expect(capture).not.toHaveBeenCalled();
  });
  it('calls only the fixed public source and cannot claim submitted orders', async () => {
    capture.mockResolvedValue({ sourceKind: 'moex-public-frozen-pages-v1', admission: false });
    const result = await runFrozenCaptureCli(parseFrozenCaptureArgs(['--output=/tmp/new-source']));
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith({ outputDirectory: '/tmp/new-source', onProgress: expect.any(Function) });
    expect(result).toMatchObject({ admission: false, ordersSubmitted: false });
  });
  it('does not fallback, retry or declare success when capture rejects', async () => {
    capture.mockRejectedValue(new Error('capture-invalid'));
    await expect(runFrozenCaptureCli(parseFrozenCaptureArgs(['--output=/tmp/new-source']))).rejects.toThrow('capture-invalid');
    expect(capture).toHaveBeenCalledOnce();
  });
});
