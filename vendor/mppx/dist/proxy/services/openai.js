import * as Service from '../Service.js';
/**
 * Creates an OpenAI service definition.
 *
 * Injects `Authorization: Bearer` header for upstream authentication.
 * Per-endpoint `apiKey` overrides are supported via `options`.
 *
 * @example
 * ```ts
 * openai({
 *   apiKey: 'sk-...',
 *   routes: {
 *     'POST /v1/chat/completions': mppx.charge({ amount: '0.05' }),
 *     'GET /v1/models': true,
 *   },
 * })
 * ```
 */
export function openai(config) {
    return Service.from('openai', {
        baseUrl: config.baseUrl ?? 'https://api.openai.com',
        categories: ['ai'],
        description: 'Chat completions, embeddings, image generation, and audio transcription.',
        docs: {
            apiReference: 'https://platform.openai.com/docs/api-reference',
            homepage: 'https://platform.openai.com/docs',
            llms: 'https://context7.com/websites/platform_openai/llms.txt',
        },
        onUpstreamError: config.onUpstreamError,
        rewriteRequest(request, ctx) {
            const apiKey = ctx.apiKey ?? config.apiKey;
            request.headers.delete('OpenAI-Organization');
            request.headers.delete('OpenAI-Project');
            request.headers.set('Authorization', `Bearer ${apiKey}`);
            return request;
        },
        routes: config.routes,
        title: 'OpenAI',
    });
}
//# sourceMappingURL=openai.js.map