import {chromium} from '@playwright/test';

/** Full bundled Chromium uses native headless/GPU support; no external Chrome install is required. */
export function launchBrowser(){
 const channel=process.env.STUDIO_BROWSER_CHANNEL?.trim()||'chromium';
 return chromium.launch({headless:true,channel});
}
