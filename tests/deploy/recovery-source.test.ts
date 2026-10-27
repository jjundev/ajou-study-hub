import { expect, it } from 'vitest';
import { assertRecoverySource } from '../../tools/deploy/recovery-source.js';

const literal='export default {fetch(){return new Response("recovery-test");}};';
const rawHeaders={'content-type':'application/javascript','content-disposition':'attachment; filename="index.js"'};
it('accepts exact raw bytes with a matching declared length',async()=>{
 await expect(assertRecoverySource(new Response(literal,{headers:{...rawHeaders,'content-length':'64'}}))).resolves.toBeUndefined();
});
it.each(['16385','1','bad','-1'])('rejects invalid declared source length %s without consuming bytes',async length=>{
 let pulls=0,cancelled=false;
 const body=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(Buffer.from(literal));controller.close();},cancel(){cancelled=true;}},{highWaterMark:0});
 const response=new Response(body,{headers:{...rawHeaders,'content-length':length}});
 await expect(assertRecoverySource(response)).rejects.toThrow();expect(pulls).toBe(0);
 await response.body!.cancel();expect(cancelled).toBe(true);
});
it('stops and cancels a chunked source when it exceeds 16 KiB',async()=>{
 let pulls=0,cancelled=false;
 const body=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array(8193));},cancel(){cancelled=true;}},{highWaterMark:0});
 await expect(assertRecoverySource(new Response(body,{headers:rawHeaders}))).rejects.toThrow();
 expect(pulls).toBe(2);expect(cancelled).toBe(true);
});
it.each([201,206,500])('rejects nonexact source status %s',async status=>{
 await expect(assertRecoverySource(new Response(literal,{status,headers:rawHeaders}))).rejects.toThrow();
});
it.each([
 {...rawHeaders,'content-type':'application/javascript; charset=utf-8'},
 {...rawHeaders,'content-disposition':'attachment; filename="other.js"'},
 {...rawHeaders,location:'https://other.example'}
])('rejects unsupported raw response headers %j',async headers=>{
 await expect(assertRecoverySource(new Response(literal,{headers}))).rejects.toThrow();
});
