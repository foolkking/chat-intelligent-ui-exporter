// Read an explicitly picked archive without unzipping it into memory or fetching resources.
// Names are never filesystem paths. Each extracted member gets an opaque OPFS handle.
globalThis.ReaderZipSource = (() => {
  const utf8 = new TextDecoder("utf-8", {fatal:true});
  const bad = () => { throw Error("archive-format"); };
  const view = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
  const table = Uint32Array.from({length:256}, (_,n) => {
    for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;
  });
  const safe = n => {if(!Number.isSafeInteger(n)||n<0)bad();return n;};
  const u64 = (v,n) => safe(Number(v.getBigUint64(n,true)));
  function name(bytes) {
    const s=utf8.decode(bytes).normalize("NFC");
    if(!s||s.startsWith("/")||s.includes("\\")||/[\x00-\x1f\x7f]/.test(s)||
      s.split("/").some(p=>p===".."||p==="."||p.includes(":")))bad();
    return s;
  }
  async function open(file,check=()=>{}) {
    const read=async(a,n)=>{check();if(a<0||a+n>file.size)bad();
      const b=new Uint8Array(await file.slice(a,a+n).arrayBuffer());if(b.length!==n)bad();return b;};
    const tail=await read(Math.max(0,file.size-65557),Math.min(file.size,65557)),tv=view(tail);
    let e=-1;for(let p=tail.length-22;p>=0;p--)
      if(tv.getUint32(p,true)===0x06054b50&&p+22+tv.getUint16(p+20,true)===tail.length){e=p;break;}
    if(e<0||tv.getUint16(e+4,true)||tv.getUint16(e+6,true))bad();
    let count=tv.getUint16(e+10,true),bytes=tv.getUint32(e+12,true),offset=tv.getUint32(e+16,true);
    const end=file.size-tail.length+e;
    if(count===65535||bytes===0xffffffff||offset===0xffffffff){
      const loc=view(await read(end-20,20));
      if(loc.getUint32(0,true)!==0x07064b50||loc.getUint32(4,true)||loc.getUint32(16,true)!==1)bad();
      const z=view(await read(u64(loc,8),56));
      if(z.getUint32(0,true)!==0x06064b50||z.getUint32(16,true)||z.getUint32(20,true)||u64(z,24)!==u64(z,32))bad();
      count=u64(z,32);bytes=u64(z,40);offset=u64(z,48);
    }else if(tv.getUint16(e+8,true)!==count)bad();
    if(offset+bytes>end||count>bytes/46)bad();
    const members=new Map();let pos=offset;
    for(let n=0;n<count;n++){
      const b=view(await read(pos,46));if(b.getUint32(0,true)!==0x02014b50)bad();
      const flags=b.getUint16(8,true),method=b.getUint16(10,true),nl=b.getUint16(28,true),xl=b.getUint16(30,true),cl=b.getUint16(32,true);
      if(flags&1||flags&0x40||![0,8].includes(method)||b.getUint16(34,true))bad();
      if((b.getUint32(38,true)>>>16&0xf000)===0xa000)bad();
      let size=b.getUint32(24,true),packed=b.getUint32(20,true),at=b.getUint32(42,true);
      const filename=name(await read(pos+46,nl)),extra=view(await read(pos+46+nl,xl));
      if(size===0xffffffff||packed===0xffffffff||at===0xffffffff){
        let found=false;
        for(let p=0;p+4<=xl;){
          const tag=extra.getUint16(p,true),len=extra.getUint16(p+2,true);p+=4;if(p+len>xl)bad();
          if(tag===1){let j=p;const take=()=>{if(j+8>p+len)bad();const v=u64(extra,j);j+=8;return v;};
            if(size===0xffffffff)size=take();if(packed===0xffffffff)packed=take();if(at===0xffffffff)at=take();found=true;}
          p+=len;
        }
        if(!found)bad();
      }
      if(members.has(filename)||at>=offset||size<0||packed<0)bad();
      members.set(filename,{name:filename,flags,method,size,packed,at,crc:b.getUint32(16,true)});
      pos+=46+nl+xl+cl;if(pos>offset+bytes)bad();
    }
    if(pos!==offset+bytes)bad();
    async function extract(member,handle,report=()=>{}) {
      check();if(members.get(member?.name)!==member)bad();
      const h=view(await read(member.at,30));
      if(h.getUint32(0,true)!==0x04034b50||h.getUint16(6,true)!==member.flags||h.getUint16(8,true)!==member.method)bad();
      const nl=h.getUint16(26,true),xl=h.getUint16(28,true),start=member.at+30+nl+xl;
      if(name(await read(member.at+30,nl))!==member.name||start+member.packed>offset)bad();
      const estimate=await navigator.storage?.estimate?.();
      // A real disk budget, not a message-count or conversation-size limit.
      if(estimate?.quota&&member.size>Math.max(0,estimate.quota-estimate.usage-8388608))throw Error("storage-full");
      const out=await handle.createWritable();let crc=0xffffffff,done=0,queued=[];
      function accept(bytes){
        done+=bytes.length;if(done>member.size)bad();
        for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);
        queued.push(bytes);
      }
      const inflate=member.method===8?new fflate.Inflate(accept):null;
      try{
        // Deflate's maximum expansion for one 4 KiB input stays bounded.
        for(let p=0;p<member.packed;p+=4096){
          const bytes=await read(start+p,Math.min(4096,member.packed-p));
          if(inflate)inflate.push(bytes,p+bytes.length===member.packed);else accept(bytes);
          for(const part of queued)await out.write(part);queued=[];
          report({stage:"source",done,total:member.size});
        }
        if(!member.packed&&inflate)inflate.push(new Uint8Array(),true);
        if(done!==member.size||((crc^0xffffffff)>>>0)!==member.crc)bad();
        await out.close();return handle.getFile();
      }catch(e){await out.abort().catch(()=>{});throw e;}
    }
    return {members,extract};
  }
  return {open};
})();
