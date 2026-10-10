// One sentence for the gateway state a script has just read. Facts only: no key, key reference or path.

/** Words for the facts gatewayReport() returns; the caller passes the report it already built. */
export function gatewayStateText(report) {
  if (!report.enabled) return 'gateway disabled';
  const cap = report.dailyCapPresent ? 'daily cap set' : 'no daily cap';
  return `gateway enabled: policy ${report.policyHash}, ${cap}`;
}
