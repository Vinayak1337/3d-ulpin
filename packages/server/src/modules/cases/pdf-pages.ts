/** Metadata only: parse the retained PDF page tree; do not infer pages from filenames/text. */
export async function pdfPageCount(bytes:Uint8Array):Promise<number>{
 const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=pdf.getDocument({data:new Uint8Array(bytes),useSystemFonts:false,disableFontFace:true});
 try{const document=await task.promise;return document.numPages;}finally{await task.destroy();}
}
