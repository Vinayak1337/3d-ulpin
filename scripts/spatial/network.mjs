/** Public calibration geometry request predicate; query revisions are not file extensions. */
export function isCalibrationGeometry(url, baseURL) {
  try {
    const value=new URL(url,baseURL), base=new URL(baseURL);
    return value.origin===base.origin && value.pathname.startsWith('/api/v1/spatial/calibration/') && value.pathname.endsWith('.glb');
  }catch{return false;}
}
