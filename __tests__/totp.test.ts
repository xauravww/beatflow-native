import {
  buildSpotifyTotpParams,
  generateTotp,
  getSpotifyTotpSecret,
  sha1,
} from '../src/services/totp';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function ascii(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

describe('sha1', () => {
  it('matches the FIPS 180-4 vector for "abc"', () => {
    expect(hex(sha1(ascii('abc')))).toBe(
      'a9993e364706816aba3e25717850c26c9cd0d89d',
    );
  });

  it('matches the empty-string vector', () => {
    expect(hex(sha1(new Uint8Array(0)))).toBe(
      'da39a3ee5e6b4b0d3255bfef95601890afd80709',
    );
  });

  it('matches a 56-byte block-boundary vector', () => {
    // exactly 56 bytes ("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")
    expect(
      hex(
        sha1(
          ascii(
            'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
          ),
        ),
      ),
    ).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
  });
});

describe('generateTotp (RFC 6238 Appendix B, SHA-1)', () => {
  const key = ascii('12345678901234567890');
  const cases: [number, string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];

  it.each(cases)('T=%d → %s', (t, expected) => {
    expect(generateTotp(key, t)).toBe(expected);
  });
});

describe('Spotify TOTP secret derivation', () => {
  // Keep the test deterministic: simulate an offline secret fetch so the
  // module always falls back to the hardcoded v61 secret.
  let fetchSpy: jest.SpyInstance;
  beforeAll(() => {
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('offline (test)'));
  });
  afterAll(() => {
    fetchSpy.mockRestore();
  });

  it('uses the hardcoded fallback secret when offline', async () => {
    const secret = await getSpotifyTotpSecret();
    // The fallback version is 61 and its transformed digits produce this key.
    expect(secret.version).toBe(61);
    expect(secret.bytes).toEqual([
      44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94,
      102, 43, 69, 49, 120, 118, 80, 64, 78,
    ]);
  });

  it('derives the TOTP key exactly like the live-verified algorithm', async () => {
    const { totp, totpVer, totpServer } = await buildSpotifyTotpParams();
    expect(totpVer).toBe(61);
    expect(totpServer).toBe(totp);
    expect(totp).toMatch(/^\d{6}$/);
  });
});
