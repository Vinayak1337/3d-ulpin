// Preloaded in the API and dispatcher children: any fetch away from this box fails before it is sent.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== '127.0.0.1') return Promise.reject(new Error('Non-loopback HTTP is forbidden.'));
  return nativeFetch(input, init);
};
