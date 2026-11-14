import type { StorageRule } from '../../config/storage-rules.js';

/** Install per-window adapters, retaining native references before replacing getters. */
export function installStorage(namespace: string, rules: StorageRule[]): void {
 const compiled = rules.map(rule => ({...rule, expression:new RegExp(rule.pattern)}));
 const normalize = (key:string, value:string):string|null => {
  const rule = compiled.find(rule=>rule.expression.test(key));
  if (!rule) return value;
  if (rule.format==='theme') return value==='light'||value==='dark'?value:rule.fallback;
  try {
   const parsed:unknown=JSON.parse(value);
   const object = parsed!==null && typeof parsed==='object' && !Array.isArray(parsed);
   if (rule.format==='array' && Array.isArray(parsed) && parsed.every(item=>typeof item==='string')) return value;
   if (rule.format==='object' && object) return value;
   if (rule.format==='attempt' && object) {
    const attempt=parsed as Record<string,unknown>;
    if (typeof attempt.version==='string' && typeof attempt.selected==='string' && (attempt.unsure===undefined || typeof attempt.unsure==='boolean')) return value;
   }
  } catch { /* Invalid JSON recovers to the rule's explicit fallback. */ }
  return rule.fallback;
 };
 for (const name of ['localStorage','sessionStorage'] as const) {
  let native:Storage|undefined;
  try {native=window[name];} catch { /* Blocked origin: use memory. */ }
  const memory=new Map<string,string>();
  const sharedTheme = name === 'localStorage' ? 'od-theme' : undefined;
  const nativeKey = (key: string) => key === sharedTheme ? key : namespace + key;
  const exposedKey = (key: string) => key === sharedTheme ? key :
    key.startsWith(namespace) && key.slice(namespace.length) !== sharedTheme ? key.slice(namespace.length) : undefined;
  // Snapshot accessible keys so a later quota or security failure preserves reads.
  const snapshotKeys = (storage: Storage) => {
   const result: string[] = [];
   for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    const exposed = key === null ? undefined : exposedKey(key);
    if (exposed !== undefined) result.push(exposed);
   }
   return result;
  };
  try {
   if (native) for (const key of snapshotKeys(native)) {
    const value = native.getItem(nativeKey(key));
    if (value !== null) memory.set(key, value);
   }
  } catch { native = undefined; }
  const keys = () => {
   if (native) try { return snapshotKeys(native); } catch { native = undefined; }
   return [...memory.keys()];
  };
  const get = (key: string): string | null => {
   let value: string | null;
   try { value = native ? native.getItem(nativeKey(key)) : memory.get(key) ?? null; }
   catch { native = undefined; value = memory.get(key) ?? null; }
   return value === null ? null : normalize(key, value);
  };
  const set = (key: string, value: string) => {
   memory.set(key, value);
   try { native?.setItem(nativeKey(key), value); } catch { native = undefined; }
  };
  const remove = (key: string) => {
   memory.delete(key);
   try { native?.removeItem(nativeKey(key)); } catch { native = undefined; }
  };
  const methods:Record<string,(...args:any[])=>any>={
   getItem(key:unknown){if(!arguments.length)throw new TypeError('Storage.getItem requires a key');return get(String(key));},
   setItem(key:unknown,value:unknown){if(arguments.length<2)throw new TypeError('Storage.setItem requires key and value');set(String(key),String(value));},
   removeItem(key:unknown){if(!arguments.length)throw new TypeError('Storage.removeItem requires a key');remove(String(key));},
   clear(){for(const key of keys())remove(key);},
   key(index:unknown){if(!arguments.length)throw new TypeError('Storage.key requires an index');return keys()[Number(index)>>>0]??null;},
  };
  const reserved=(key:PropertyKey)=>Reflect.has(Storage.prototype,key);
  const target=Object.create(Storage.prototype) as Storage;
  const adapter=new Proxy(target,{
   get(_target,key){if(Object.hasOwn(target,key))return Reflect.get(target,key);if(key==='length')return keys().length;if(typeof key==='string'&&Object.hasOwn(methods,key))return methods[key];if(reserved(key))return Reflect.get(target,key);if(typeof key==='string'){const value=get(key);if(value!==null)return value;}return Reflect.get(target,key);},
   set(_target,key,value){if(reserved(key)) {if(key!=='length')Reflect.set(target,key,value);return true;}if(typeof key==='string')set(key,String(value));return true;},
   deleteProperty(_target,key){if(Object.hasOwn(target,key))return Reflect.deleteProperty(target,key);if(typeof key==='string'&&!reserved(key))remove(key);return true;},
   ownKeys(){return [...new Set([...Reflect.ownKeys(target),...keys()])];},
   has(_target,key){return reserved(key)||(typeof key==='string'&&get(key)!==null)||Reflect.has(target,key);},
   getOwnPropertyDescriptor(_target,key){if(Object.hasOwn(target,key))return Reflect.getOwnPropertyDescriptor(target,key);if(typeof key==='string'){const value=get(key);if(value!==null)return {value,writable:true,enumerable:true,configurable:true};}return undefined;},
   defineProperty(_target,key,descriptor){if(typeof key==='string'&&!reserved(key)&&'value' in descriptor){set(key,String(descriptor.value));return true;}return false;},
  });
  Object.defineProperty(window,name,{configurable:true,enumerable:true,get:()=>adapter});
 }
}
