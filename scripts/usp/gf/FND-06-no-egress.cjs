/** Verification-only fetch tripwire. Never records bodies, URLs or credential values. */
const { appendFileSync } = require('node:fs');
const record = event => { if(process.env.ULPIN_EGRESS_RECEIPT) appendFileSync(process.env.ULPIN_EGRESS_RECEIPT, JSON.stringify(event)+'\n',{mode:0o600}); };
const original = globalThis.fetch;
record({event:'fetch-tripwire-installed',pid:process.pid});
globalThis.fetch = async function(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) {
    record({event:'non-loopback-fetch-denied',pid:process.pid,
      category:url.href==='https://registry.npmjs.org/-/package/next/dist-tags' ? 'next-development-version-check'
        : url.hostname==='inference-api.nousresearch.com' ? 'legacy-provider' : 'other'});
    throw new Error('Verification disallows external fetch.');
  }
  return original.call(this,input,init);
};
