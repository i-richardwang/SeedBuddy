import { deriveDpopAth, deriveDpopJkt } from "better-auth/oauth2";

export interface DpopKey {
  jkt: string;
  proof(url: string, token?: string): Promise<string>;
}

/** A client key and fresh signed proofs for the real OAuth/DPoP flow. */
export async function createDpopKey(): Promise<DpopKey> {
  const key = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", key.publicKey);
  const encode = (value: string | Uint8Array) =>
    Buffer.from(value).toString("base64url");
  return {
    jkt: await deriveDpopJkt(jwk),
    async proof(url, token) {
      const payload = {
        jti: crypto.randomUUID(),
        htm: "POST",
        htu: url,
        /** JWT proofs use the verifier’s live wall clock, not a database write clock. */
        iat: Math.floor(Date.now() / 1000),
        ...(token === undefined ? {} : { ath: await deriveDpopAth(token) }),
      };
      const input = `${encode(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk }))}.${encode(JSON.stringify(payload))}`;
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key.privateKey,
        new TextEncoder().encode(input),
      );
      return `${input}.${encode(new Uint8Array(signature))}`;
    },
  };
}
