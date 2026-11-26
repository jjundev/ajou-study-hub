import type { AssetBinding } from './hub.js';

export default {
  fetch(request: Request, env: { ASSETS: AssetBinding }): Promise<Response> | Response {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    return env.ASSETS.fetch(request);
  },
};
