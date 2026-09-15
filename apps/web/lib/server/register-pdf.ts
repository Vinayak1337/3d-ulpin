import { chromium, type Browser } from "playwright";
import { AppError } from "./errors";
let active = 0;
/** Local, network-isolated printing of the escaped register snapshot. */
export async function registerPdf(html: string): Promise<Response> {
  if (active >= 2)
    throw new AppError(
      503,
      "PDF_BUSY",
      "Two reports are being prepared. Try again shortly.",
    );
  active++;
  let browser: Browser | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    browser = await chromium.launch({
      executablePath: process.env.ULPIN_PDF_CHROMIUM_PATH || undefined,
      timeout: 15000,
    });
    const renderer = browser;
    const bytes = await Promise.race([
      (async () => {
        const context = await renderer.newContext({
          javaScriptEnabled: false,
          offline: true,
          serviceWorkers: "block",
        });
        await context.route("**/*", (route) => route.abort());
        const page = await context.newPage();
        await page.setContent(html, {
          waitUntil: "domcontentloaded",
          timeout: 10000,
        });
        return page.pdf({
          format: "A4",
          printBackground: true,
          margin: { top: "14mm", bottom: "17mm", left: "12mm", right: "12mm" },
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate:
            '<div style="font:9px sans-serif;color:#56635a;width:100%;text-align:center">Property register · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        });
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("PDF deadline")), 20000);
      }),
    ]);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="property-register.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    throw new AppError(
      503,
      "PDF_UNAVAILABLE",
      "PDF rendering is unavailable. Install the local browser with pnpm --filter @ulpin/web exec playwright install chromium, or use Print / save PDF.",
    );
  } finally {
    if (timer) clearTimeout(timer);
    await browser?.close().catch(() => {});
    active--;
  }
}
