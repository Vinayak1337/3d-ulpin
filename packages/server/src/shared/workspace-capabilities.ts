export interface WorkspaceCapabilities {
  runtime: 'loopback-configured' | 'external-configured' | 'unknown';
  provider: 'blocked' | 'unconfigured' | 'opted-in';
  providerLocation: 'unverified';
  fullResidency: 'unverified';
  imageEgress: 'blocked';
}
export function workspacePrivacyCopy(value?: WorkspaceCapabilities) {
  return {
    runtime: value?.runtime === 'loopback-configured' ? 'Services use loopback addresses. Physical hosting location is unverified.'
      : value?.runtime === 'external-configured' ? 'Services include a non-loopback address. Hosting location is unverified.'
      : 'Service location is unknown.',
    provider: value?.provider === 'blocked' ? 'Non-India AI access is blocked. Native preparation remains available.'
      : value?.provider === 'unconfigured' ? 'The optional AI route is unconfigured.'
      : value?.provider === 'opted-in' ? 'Non-India AI access is opted in. Provider processing location is unverified.'
      : 'AI provider access is unknown.',
    residency: 'Full data residency is unverified. Image egress is blocked pending visual redaction qualification.',
  };
}
