/** Strips hop-by-hop, auth, encoding, cookie, and forwarding headers from a request before proxying upstream. */
export declare function scrub(headers: Headers): Headers;
/**
 * Strips re-streaming headers (`content-encoding`, `content-length`) and
 * security-sensitive headers (`set-cookie`) from an upstream response.
 *
 * `set-cookie` is dropped because a paid API proxy must never let an upstream
 * service set cookies in the user's browser under the proxy's origin. If a
 * compromised, misbehaving, or attacker-influenced upstream returned
 * `Set-Cookie: session=evil; Domain=.example.com`, the browser would honor it
 * for every sibling subdomain of the proxy — turning any future path-confusion
 * or open-redirect bug in the surrounding deployment into a session-fixation
 * primitive. Proxied services authenticate via bearer tokens / signed
 * payloads, never cookies, so dropping `set-cookie` is purely defensive.
 */
export declare function scrubResponse(response: Response): Response;
//# sourceMappingURL=Headers.d.ts.map