/** Verifies every configured request-attestation protocol. */
export async function verify(request, verifiers) {
    const outcomes = {};
    for (const [name, verifier] of Object.entries(verifiers))
        outcomes[name] = await verifier.verify(request);
    return outcomes;
}
//# sourceMappingURL=Server.js.map