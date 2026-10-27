/** Only the two observed download envelopes for the fixed public rehearsal literal. */
export const recoverySource='export default {fetch(){return new Response("recovery-test");}};';
export const recoverySourceLimit=16*1024;
function fail():never{throw Error('Recovery source could not be verified');}

export async function assertRecoverySource(response:Response):Promise<void>{
 if(response.status!==200||response.redirected||response.headers.has('location'))fail();
 const type=response.headers.get('content-type'),disposition=response.headers.get('content-disposition');
 let expected:Buffer;
 if(type==='application/javascript'&&disposition==='attachment; filename="index.js"'){
  expected=Buffer.from(recoverySource);
 }else{
  const boundary=/^multipart\/form-data; boundary=([a-f0-9]{60})$/.exec(type??'')?.[1];
  if(!boundary||disposition!==null)fail();
  // Byte comparison rejects extra parts, headers, BOMs, normalization and epilogues.
  expected=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="index.js"\r\n\r\n${recoverySource}\r\n--${boundary}--\r\n`);
 }
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>recoverySourceLimit||Number(length)!==expected.length))fail();
 const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
 if(reader)try{
  for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>recoverySourceLimit)fail();chunks.push(chunk.value);}
 }finally{await reader.cancel();}
 if(!Buffer.concat(chunks).equals(expected))fail();
}
