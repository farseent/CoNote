import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { SignJWT, importJWK } from 'jose';
import { describe, expect, it } from 'vitest';
import { COLLAB_TOKEN_AUDIENCE, COLLAB_TOKEN_ISSUER } from '@conote/shared';
import { TokenRejectedError, TokenVerifier } from './token-verifier.js';

/*
 * Rotation of the collaboration signing key (docs/DEPLOYMENT.md §5, AC-11.6). The procedure:
 *   1. add the new public key next to the old one on the collab servers (both kids accepted),
 *   2. switch the API to sign with the new private key,
 *   3. wait longer than a token lives, then remove the old public key.
 * Each step is checked against the real verifier with the clock under the test's control.
 */

const NOW = new Date('2026-11-26T12:00:00Z');
const USER = '00000000-0000-4000-8000-000000000001';
const PAGE = '00000000-0000-4000-8000-0000000000a1';

function keyPair(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  return {
    privateJwk: { kty: 'OKP' as const, crv: 'Ed25519' as const, x: priv.x!, d: priv.d!, kid },
    publicJwk: { kty: 'OKP' as const, crv: 'Ed25519' as const, x: pub.x!, kid },
  };
}

async function sign(
  privateJwk: ReturnType<typeof keyPair>['privateJwk'],
  issuedAt: Date,
): Promise<string> {
  const iat = Math.floor(issuedAt.getTime() / 1000);
  return new SignJWT({ sid: randomUUID(), pid: PAGE })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: privateJwk.kid })
    .setIssuer(COLLAB_TOKEN_ISSUER)
    .setAudience(COLLAB_TOKEN_AUDIENCE)
    .setSubject(USER)
    .setJti(randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(iat + 60)
    .sign(await importJWK(privateJwk, 'EdDSA'));
}

describe('collaboration key rotation (AC-11.6)', () => {
  const oldKey = keyPair('k-old');
  const newKey = keyPair('k-new');
  const verifierWith = (...keys: (typeof oldKey)[]) =>
    new TokenVerifier(
      keys.map((k) => k.publicJwk),
      () => NOW,
    );

  it('step 1: collab accepts tokens of both keys while both public keys are configured', async () => {
    const verifier = verifierWith(oldKey, newKey);
    expect((await verifier.verify(await sign(oldKey.privateJwk, NOW))).sub).toBe(USER);
    expect((await verifier.verify(await sign(newKey.privateJwk, NOW))).sub).toBe(USER);
  });

  it('a collab server that has not been given the new key yet refuses its tokens (why the order matters)', async () => {
    const verifier = verifierWith(oldKey);
    await expect(verifier.verify(await sign(newKey.privateJwk, NOW))).rejects.toBeInstanceOf(
      TokenRejectedError,
    );
  });

  it('step 3: after the old public key is removed, an old token is refused and a new one still works', async () => {
    const verifier = verifierWith(newKey);
    await expect(verifier.verify(await sign(oldKey.privateJwk, NOW))).rejects.toBeInstanceOf(
      TokenRejectedError,
    );
    expect((await verifier.verify(await sign(newKey.privateJwk, NOW))).sub).toBe(USER);
  });

  it('a token signed by the old key has expired by the time the old public key is removed', async () => {
    const issued = await sign(oldKey.privateJwk, NOW);
    const later = new Date(NOW.getTime() + 5 * 60_000);
    const verifier = new TokenVerifier([oldKey.publicJwk], () => later);
    await expect(verifier.verify(issued)).rejects.toBeInstanceOf(TokenRejectedError);
  });

  it('a key that is not a public key of the list is never trusted, even with a known kid', async () => {
    const impostor = keyPair('k-new'); // same kid, different key material
    const verifier = verifierWith(newKey);
    await expect(verifier.verify(await sign(impostor.privateJwk, NOW))).rejects.toBeInstanceOf(
      TokenRejectedError,
    );
  });
});
