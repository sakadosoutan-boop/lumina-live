import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import https from 'node:https';

// This lane owns only the paths below; no package/catalog changes or stock scraping.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = path.join(ROOT, 'assets/media/packs');
const DOWNLOADS = path.join(ROOT, 'assets/downloads/packs');
const SNAPSHOTS = path.join(ROOT, 'research/pack-snapshots');
const CANDIDATES = path.join(ROOT, 'assets/pack-candidates.json');
const RECORD = path.join(ROOT, 'research/pack-acquisition.json');
const LIMIT = 8_000_000_000;
const BE = 'https://www.beeple-crap.com/vjloops';
const NE = 'https://nebmotion.co.uk/vj-loops/free/';
const packs = [
  {id:'beeple-manifest',name:'MANIFEST',author:'Beeple / Mike Winkelmann',source:BE,page:'https://www.mediafire.com/file/wxck3hz5hpvaple/BEEPLE_MANIFEST-DESTINY_CLIPS.zip/file',expectedVideos:65,order:0},
  {id:'beeple-four-color-process',name:'four.color.process',author:'Beeple / Mike Winkelmann',source:BE,page:'https://www.mediafire.com/download/32q1zhardzdck3m/beeple-four_color_process.zip',expectedVideos:10,order:1},
  {id:'beeple-brainfader',name:'Brainfader Vol.1 (archive: brainfeeder)',author:'Beeple / Mike Winkelmann',source:BE,page:'https://www.mediafire.com/download/y0b3wiwxiwwbaci/brainfeeder_beeple-vjclips.zip',expectedVideos:10,order:2},
  {id:'beeple-resolume',name:'Resolume VJ Pack',author:'Beeple / Mike Winkelmann',source:BE,page:'https://www.mediafire.com/download/c46fy4534tfdr2y/beeple-resolume_pack.zip',expectedVideos:10,order:3},
  {id:'beeple-ubersketch',name:'übersketch',author:'Beeple / Mike Winkelmann',source:BE,page:'https://www.mediafire.com/download/35y1do8pmndr26y/ubersketch.zip',expectedVideos:10,order:4},
  {id:'neb-abstract-tunnels-2',name:'Abstract Tunnels Vol.2',author:'Neb Motion',source:NE,page:'https://www.dropbox.com/sh/2myy6sshj7cizqz/AABz9xNzE0JjEUqlWnujcNiPa?dl=0',expectedVideos:10,order:5},
  {id:'neb-retro-sunsets-1',name:'80s Retro Sunsets Vol.1',author:'Neb Motion',source:NE,page:'https://www.dropbox.com/sh/ty4ajnw9sfda488/AABanV8MeNZzgZ60q9MM3yO9a?dl=0',expectedVideos:10,order:6},
  {id:'neb-abstract-tunnels-1',name:'Abstract Tunnels Vol.1',author:'Neb Motion',source:NE,landing:'https://nebmotion.co.uk/x-lp-abstract-tunnels-vol-1/',page:'https://www.dropbox.com/sh/25kyxmwsg9ivatl/AABydZmHbaCGZsQy9SHCsbMma?dl=0',expectedVideos:10,order:7},
  {id:'neb-abstract-geometry-1',name:'Abstract Geometry Vol.1',author:'Neb Motion',source:NE,landing:'https://nebmotion.co.uk/x-lp-abstract-geometry-vol-1/',page:'https://www.dropbox.com/sh/m8k37h81a38ruhy/AAARKe_8BPGOgsIeChDi_T7Sa?dl=0',expectedVideos:10,order:8}
];
const now = () => new Date().toISOString();
const rel = p => path.relative(ROOT,p).split(path.sep).join('/');
const sha = data => createHash('sha256').update(data).digest('hex');
const exists = p => fs.existsSync(p);
function inside(p,root) { const r=path.relative(root,path.resolve(p)); return r!=='' && !r.startsWith('..') && !path.isAbsolute(r); }
function assertPath(p,roots=[MEDIA,DOWNLOADS,SNAPSHOTS]) {
  p=path.resolve(p);
  if (!roots.some(root => inside(p,root))) throw new Error(`Out-of-scope path: ${p}`);
  let q=path.dirname(p);
  while(q!==ROOT && inside(q,ROOT)) { if(exists(q) && fs.lstatSync(q).isSymbolicLink()) throw new Error(`Symlink parent rejected: ${q}`); q=path.dirname(q); }
  if(exists(p) && fs.lstatSync(p).isSymbolicLink()) throw new Error(`Symlink target rejected: ${p}`);
  return p;
}
async function treeBytes(dir) {
  if(!exists(dir)) return 0;
  let n=0;
  for(const entry of await fsp.readdir(dir,{withFileTypes:true})) {
    const p=path.join(dir,entry.name);
    if(entry.isSymbolicLink()) throw new Error(`Symlink in lane: ${p}`);
    n+=entry.isDirectory()?await treeBytes(p):(await fsp.stat(p)).size;
  }
  return n;
}
async function usage() { return (await treeBytes(MEDIA))+(await treeBytes(DOWNLOADS)); }
async function unlinkDownload(p) { await fsp.unlink(assertPath(p,[DOWNLOADS])); }
async function writeSnapshot(name,body) { const p=assertPath(path.join(SNAPSHOTS,name)); await fsp.writeFile(p,body); return {localPath:rel(p),sha256:sha(body)}; }
function run(cmd,args,input) {
  return new Promise((resolve,reject)=>{
    const p=spawn(cmd,args,{cwd:ROOT,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='',err='';p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);
    p.on('error',reject);p.on('close',code=>resolve({code,out,err}));p.stdin.end(input||'');
  });
}
const PY = String.raw`
import sys,json,zipfile,pathlib,stat,hashlib,os,re,zlib
x=json.loads(sys.stdin.buffer.read().decode('utf-8')); root=pathlib.Path(x['destination']).resolve(); archive=pathlib.Path(x['archive']).resolve()
videos={'.mp4','.mov','.m4v','.webm','.mkv','.avi','.mpg','.mpeg','.wmv'}
docs={'.txt','.md','.pdf','.rtf','.nfo','.doc','.docx'}
def items(z):
 seen=set()
 for i in z.infolist():
  n=i.filename.replace('\\','/'); p=pathlib.PurePosixPath(n); bits=p.parts
  if i.is_dir(): continue
  if '__MACOSX' in bits or any(b.startswith('._') for b in bits): continue
  if p.is_absolute() or not bits or any(b in ('..','.') or ':' in b or '\x00' in b or b.endswith((' ','.')) or re.match(r'(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)',b) for b in bits):
   raise Exception('Unsafe archive path: '+n)
  mode=i.external_attr>>16
  if stat.S_ISLNK(mode): raise Exception('Archive symlink rejected: '+n)
  if i.flag_bits & 1: raise Exception('Encrypted member rejected: '+n)
  typ='video' if p.suffix.lower() in videos else 'document' if p.suffix.lower() in docs or p.name.lower() in ('license','licence','readme','copying') else None
  if not typ: continue
  key=n.casefold()
  if key in seen: raise Exception('Duplicate case-insensitive path: '+n)
  seen.add(key)
  dest=root.joinpath(*bits).resolve()
  if not dest.is_relative_to(root): raise Exception('Path escaped destination')
  yield i,dict(name=n,bytes=i.file_size,compressedBytes=i.compress_size,crc32=format(i.CRC,'08x'),type=typ,path=str(dest))
with zipfile.ZipFile(archive) as z:
 entries=list(items(z))
 if x['action']=='list': print(json.dumps([d for i,d in entries])); sys.exit()
 selected=set(x['selected']); budget=x['maxNewBytes']; written=0; output=[]
 for i,d in entries:
  if d['name'] not in selected: continue
  target=pathlib.Path(d['path']); target.parent.mkdir(parents=True,exist_ok=True)
  for ancestor in [target,*target.parents]:
   if ancestor.is_symlink(): raise Exception('Symlink extraction target')
   if ancestor==root: break
  if target.exists():
   if not target.is_file() or target.stat().st_size!=i.file_size: raise Exception('Existing member mismatch: '+str(target))
   h=hashlib.sha256(); crc=0
   with target.open('rb') as current:
    while True:
     b=current.read(1024*1024)
     if not b: break
     h.update(b); crc=zlib.crc32(b,crc)
   if crc!=i.CRC: raise Exception('Existing member CRC mismatch: '+str(target))
   d.update(sha256=h.hexdigest(),crcVerified=True);print(json.dumps(d),flush=True);continue
  if written+i.file_size>budget: raise Exception('Extraction lane budget exceeded')
  h=hashlib.sha256(); count=0; first=b''
  try:
   with z.open(i) as src, target.open('xb') as dst:
    while True:
     b=src.read(1024*1024)
     if not b: break
     if not first: first=b[:1024]
     count+=len(b)
     if count>i.file_size or written+count>budget: raise Exception('Unexpected expanded size')
     dst.write(b);h.update(b)
   if count!=i.file_size: raise Exception('Member size mismatch')
   if d['type']=='video':
    lower=first.lstrip().lower()
    if lower.startswith((b'<html',b'<!doctype',b'<?xml',b'{')): raise Exception('Disguised HTML/JSON video')
    recognized=first[4:8] in (b'ftyp',b'moov',b'mdat',b'wide',b'free',b'skip',b'pnot') or first.startswith((b'RIFF',b'\x1aE\xdf\xa3',b'\x00\x00\x01',b'0&\xb2u'))
    if not recognized: raise Exception('Unrecognized video file signature')
   written+=count;d.update(sha256=h.hexdigest(),crcVerified=True);output.append(d)
   print(json.dumps(d),flush=True)
  except:
   if target.is_file(): target.unlink()
   raise
`;
let state = exists(RECORD)?JSON.parse(await fsp.readFile(RECORD,'utf8')):{version:1,startedAt:now(),laneLimitBytes:LIMIT,overallUserLimitBytes:20_000_000_000,parentOtherLaneLimitBytes:6*1024**3,packs:[],events:[]};
let candidates = exists(CANDIDATES)?JSON.parse(await fsp.readFile(CANDIDATES,'utf8')):[];
if(!Array.isArray(candidates)) throw new Error('Expected Asset[] in pack-candidates.json');
for(const dir of [MEDIA,DOWNLOADS,SNAPSHOTS]) { assertPath(path.join(dir,'.scope-check')); await fsp.mkdir(dir,{recursive:true}); }
async function save() {
  state.laneLimitBytes=LIMIT;state.parentOtherLaneLimitBytes=8_500_000_000;
  state.updatedAt=now();state.actualLaneBytes=await usage();state.remainingLaneBytes=LIMIT-state.actualLaneBytes;
  state.downloadedVideos=candidates.length;
  await fsp.writeFile(CANDIDATES,JSON.stringify(candidates,null,2)+'\n');
  await fsp.writeFile(RECORD,JSON.stringify(state,null,2)+'\n');
}
async function event(pack,action,detail={}) { const e={at:now(),packId:pack.id,action,...detail}; state.events.push(e); console.log(JSON.stringify(e));await save(); }
async function pageSnapshot(url,name) {
  const r=await fetch(url,{signal:AbortSignal.timeout(45000)}); const body=await r.text();
  const sn=await writeSnapshot(name,body);return {response:r,body,evidence:{...sn,sourceUrl:url,finalUrl:r.url,httpStatus:r.status,capturedAt:now()}};
}
function binaryResponse(url,headers,redirects=0) {
  if(redirects>6)throw new Error('Too many download redirects');
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{headers,agent:false},res=>{
      if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location) {
        res.resume();resolve(binaryResponse(new URL(res.headers.location,url).href,headers,redirects+1));
      } else {res.finalUrl=url;resolve(res);}
    });
    // Idle socket timeout resets with activity. Brief 40-second host stalls are permitted.
    request.setTimeout(180000,()=>request.destroy(new Error('Download socket idle for 180 seconds')));
    request.on('error',reject);
  });
}
async function fileHash(p) {const h=createHash('sha256');for await(const b of fs.createReadStream(p))h.update(b);return h.digest('hex');}
async function downloadArchive(pack,record,archive,initialUrl) {
  const partial=assertPath(path.join(DOWNLOADS,pack.id+'.zip.part'));
  let download=initialUrl;
  const maxAttempts=4;
  for(let attempt=1;attempt<=maxAttempts;attempt++) {
    let response,handle;
    const offset=exists(partial)?(await fsp.stat(partial)).size:0;
    try {
      if(attempt>1 && pack.page.includes('mediafire.com')) {
        const refreshed=await pageSnapshot(pack.page,`${pack.id}-host-retry-${attempt}.html`);
        const tag=[...refreshed.body.matchAll(/<a\b[^>]*>/gi)].map(m=>m[0]).find(t=>/\bid=["']downloadButton["']/.test(t));
        const fresh=tag?.match(/\bhref=["']([^"']+)["']/)?.[1]?.replaceAll('&amp;','&');
        if(!refreshed.response.ok||!fresh)throw new Error('Host gate: normal download button unavailable on retry');
        download=fresh;record.retryHostEvidence??=[];record.retryHostEvidence.push(refreshed.evidence);
      }
      record.downloadUrl=download;
      const headers={Referer:pack.page};
      if(offset) {headers.Range=`bytes=${offset}-`;if(record.resumeValidator)headers['If-Range']=record.resumeValidator;}
      response=await binaryResponse(download,headers);
      const status=response.statusCode,type=String(response.headers['content-type']||'');
      const length=Number(response.headers['content-length']||0);
      const range=String(response.headers['content-range']||'').match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      record.downloadResponse={status,url:response.finalUrl,contentType:type,contentLength:length,contentRange:response.headers['content-range'],contentDisposition:response.headers['content-disposition'],etag:response.headers.etag,lastModified:response.headers['last-modified']};
      if(status<200||status>=300||/text\/html|application\/json/.test(type)) {
        let errorBody='';for await(const b of response){errorBody+=b.toString();if(errorBody.length>1024*1024){response.destroy();break;}}
        record.downloadFailureEvidence=await writeSnapshot(`${pack.id}-download-failure-${attempt}.html`,errorBody);
        throw new Error(`Host gate/non-binary download: HTTP ${status} ${type}`);
      }
      if(offset && (status!==206||!range||+range[1]!==offset))throw new Error('Host did not honor exact HTTP Range; partial preserved, no blind append');
      const total=range?+range[3]:length;
      if(record.expectedArchiveBytes&&total&&record.expectedArchiveBytes!==total)throw new Error('Archive total changed during resume');
      if(total)record.expectedArchiveBytes=total;
      record.resumeValidator=response.headers.etag&&!String(response.headers.etag).startsWith('W/')?response.headers.etag:response.headers['last-modified'];
      const used=await usage(),additional=total?total-offset:0;
      if(used+additional>LIMIT)throw new Error('Lane budget: archive would exceed 12 GiB');
      const disk=await fsp.statfs(DOWNLOADS,{bigint:true});
      if(additional&&BigInt(additional)>disk.bavail*disk.bsize)throw new Error('Insufficient filesystem capacity');
      handle=await fsp.open(partial,offset?'a':'wx');
      let bytes=offset,last=Date.now(),first=offset===0;
      await event(pack,offset?'download-resuming':'download-transfer',{attempt,offset,total});
      for await(const chunk of response) {
        const b=Buffer.from(chunk);
        if(first){if(b.length<4||b.readUInt32LE(0)!==0x04034b50)throw new Error('Download is not ZIP (disguised binary rejected)');first=false;}
        if(used+bytes-offset+b.length>LIMIT)throw new Error('Lane budget reached during transfer');
        let written=0;while(written<b.length){const w=await handle.write(b,written,b.length-written);written+=w.bytesWritten;}
        bytes+=b.length;
        if(Date.now()-last>20000){record.downloadedBytes=bytes;await event(pack,'download-progress',{bytes,total,attempt});last=Date.now();}
      }
      if(!bytes||(total&&bytes!==total))throw new Error('Truncated archive transfer');
      await handle.close();handle=undefined;
      const digest=await fileHash(partial);
      await fsp.rename(partial,archive);
      record.archive={localPath:rel(archive),bytes,sha256:digest,downloadedAt:now(),retained:true};
      record.partialBytes=0;await event(pack,'archive-downloaded',{bytes,sha256:digest});return;
    }catch(e){
      response?.destroy();await handle?.close().catch(()=>{});
      record.partialBytes=exists(partial)?(await fsp.stat(partial)).size:0;
      record.transferFailures??=[];record.transferFailures.push({at:now(),attempt,offset,partialBytes:record.partialBytes,error:e.message});
      await event(pack,'transfer-interrupted',{attempt,partialBytes:record.partialBytes,error:e.message});
      if(/Host gate|HTTP Range|changed during|budget|not ZIP|capacity/i.test(e.message)||attempt===maxAttempts)throw e;
      await new Promise(r=>setTimeout(r,Math.min(10000,2000*attempt)));
    }
  }
}
async function metadata(file) {
  const ff=path.join(ROOT,'node_modules/ffmpeg-static/ffmpeg.exe');
  if(!exists(ff))return {status:'pending-ffmpeg'};
  const r=await run(ff,['-hide_banner','-i',file]);
  const video=r.err.split(/\r?\n/).find(s=>/Stream #.*Video:/.test(s));
  if(!video) return {status:'probe-failed',detail:r.err.slice(-1800)};
  const codec=video.match(/Video:\s*([^\s,(]+)/)?.[1];
  const dimensions=video.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const d=r.err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const fps=video.match(/([\d.]+) fps/);
  const duration=d?Number(d[1])*3600+Number(d[2])*60+Number(d[3]):undefined;
  return {status:'probed',tool:'ffmpeg-static',codec,width:dimensions?+dimensions[1]:undefined,height:dimensions?+dimensions[2]:undefined,fps:fps?+fps[1]:undefined,duration,hasAudio:/Stream #.*Audio:/.test(r.err),streamDescription:video.trim(),needsTranscode:!(['h264','vp8','vp9','av1'].includes(codec)&&['.mp4','.webm','.m4v'].includes(path.extname(file).toLowerCase()))};
}
async function acquire(pack) {
  let record=state.packs.find(p=>p.id===pack.id);
  if(!record) {record={...pack,status:'queued',attempts:[]};state.packs.push(record);}
  if(record.status==='complete' && !process.argv.includes('--retry'))return;
  const attempt={startedAt:now()};record.attempts.push(attempt);
  try {
    if(!record.licenseEvidence) {
      const source=await pageSnapshot(pack.source,pack.id+'-source.html');
      if(!source.response.ok)throw new Error('Official source HTTP '+source.response.status);
      record.licenseEvidence=source.evidence;
      record.license={label:pack.source===BE?'Creator permits commercial/non-commercial video use in any form; Creative Commons variant unspecified':'Creator permits commercial/non-commercial use, no attribution required; Creative Commons variant unspecified',url:pack.source,commercialUse:true,publicPerformance:pack.source===BE?'Included in broad any-form commercial grant':'Live music events explicitly described',attributionRequired:pack.source===BE?'Unspecified CC variant; retain and display creator credit conservatively':false,attribution:pack.author+' — '+pack.source,redistribution:'Not established; retain for local performance, do not redistribute source files',audioRights:pack.source===BE?'All audio rights remain with respective owners; video permission does not clear demo soundtracks':'Do not infer separate soundtrack rights',capturedAt:now()};
      if(pack.landing) {const landing=await pageSnapshot(pack.landing,pack.id+'-landing.html');record.landingEvidence=landing.evidence;}
    }
    await event(pack,'starting');
    const archive=assertPath(path.join(DOWNLOADS,pack.id+'.zip'));
    if(!exists(archive)) {
      const host=await pageSnapshot(pack.page,pack.id+'-host.html');record.hostEvidence=host.evidence;
      if(!host.response.ok)throw new Error(`Host gate HTTP ${host.response.status}`);
      let download;
      if(pack.page.includes('mediafire.com')) {
        const tag=[...host.body.matchAll(/<a\b[^>]*>/gi)].map(m=>m[0]).find(t=>/\bid=["']downloadButton["']/.test(t));
        download=tag?.match(/\bhref=["']([^"']+)["']/)?.[1]?.replaceAll('&amp;','&');
        if(!download)throw new Error('Host gate: normal MediaFire download button unavailable; no bypass attempted');
        if(!/^https:\/\/download\d+\.mediafire\.com\//.test(download))throw new Error('Unexpected MediaFire download target');
      } else {
        const u=new URL(host.response.url);u.searchParams.set('dl','1');download=u.href;
        record.downloadMethod='Dropbox documented dl=1 parameter on publicly shared folder';
      }
      record.downloadUrl=download;record.status='downloading';await save();
      await downloadArchive(pack,record,archive,download);
    }
    const destination=assertPath(path.join(MEDIA,pack.id));
    const base={archive:archive.split(path.sep).join('/'),destination:destination.split(path.sep).join('/')};
    const listing=await run('python',['-X','utf8','-c',PY],JSON.stringify({...base,action:'list'}));
    if(listing.code!==0)throw new Error('Archive validation failed: '+listing.err.slice(-2000));
    const entries=JSON.parse(listing.out);
    record.archiveInventory=await writeSnapshot(pack.id+'-zip-inventory.json',JSON.stringify(entries.map(({path,...e})=>e),null,2));
    // When packs include alternate encodings, prefer the MP4 of the same relative stem.
    const mp4Stems=new Set(entries.filter(e=>/\.mp4$/i.test(e.name)).map(e=>e.name.replace(/\.[^.]+$/,'').toLowerCase()));
    const hasNebH264=pack.source===NE&&entries.some(e=>e.type==='video'&&/(^|\/)h\.?264\//i.test(e.name));
    const selected=entries.filter(e=>!(e.type==='video'&&!/\.mp4$/i.test(e.name)&&mp4Stems.has(e.name.replace(/\.[^.]+$/,'').toLowerCase())))
      .filter(e=>!hasNebH264||e.type!=='video'||/(^|\/)h\.?264\//i.test(e.name));
    record.selectionPolicy=hasNebH264?'Retain supplied H264 video folder and documents; omit alternate codec folders and non-video media':'Prefer MP4 for matching stems; retain source codecs otherwise';
    record.omittedAlternateEncodings=entries.filter(e=>!selected.includes(e)).map(e=>e.name);
    const remaining=selected.filter(e=>!candidates.some(a=>a.packId===pack.id&&a.archiveMember===e.name)&&!(record.documents||[]).some(d=>d.name===e.name));
    record.expectedSelectedVideos=selected.filter(e=>e.type==='video').length;
    record.selectedExpandedBytes=selected.reduce((n,e)=>n+e.bytes,0);
    const available=LIMIT-await usage();
    if(remaining.reduce((n,e)=>n+e.bytes,0)>available)throw new Error('Lane budget: archive plus safe extraction would exceed 12 GiB');
    record.status='extracting';await event(pack,'extracting',{members:remaining.length,expandedBytes:record.selectedExpandedBytes});
    for(const member of remaining.sort((a,b)=>a.type==='document'?-1:b.type==='document'?1:a.bytes-b.bytes)) {
      const extraction=await run('python',['-X','utf8','-c',PY],JSON.stringify({...base,action:'extract',selected:[member.name],maxNewBytes:LIMIT-await usage()}));
      if(extraction.code!==0)throw new Error('Safe extraction failed: '+extraction.err.slice(-2000));
      const file=JSON.parse(extraction.out.trim());
      if(file.type==='document') {record.documents??=[];record.documents.push({...file,localPath:rel(file.path)});await save();continue;}
      const meta=await metadata(file.path);
      const isBeeple=pack.source===BE;
      const entry={id:pack.id+'-'+file.sha256.slice(0,16),name:path.basename(file.name,path.extname(file.name)),kind:'video',url:'/'+rel(file.path),tags:['vj-loop',isBeeple?'beeple':'neb-motion',pack.id,meta.codec||'metadata-pending',...(meta.needsTranscode?['needs-transcode']:[])],hue:0,energy:0.5,duration:meta.duration,license:record.license.label,source:pack.source,attribution:record.license.attribution,status:meta.status==='probe-failed'?'metadata-failed':meta.needsTranscode?'downloaded-needs-transcode':'downloaded',bytes:file.bytes,localPath:rel(file.path),sha256:file.sha256,packId:pack.id,packName:pack.name,archiveMember:file.name,downloadUrl:record.downloadUrl,downloadPage:pack.page,licenseUrl:pack.source,licenseDetails:record.license,evidence:[record.licenseEvidence,record.hostEvidence,...(record.landingEvidence?[record.landingEvidence]:[])],metadata:meta,validation:{zipCrcVerified:true,videoSignatureVerified:true,sha256Verified:true},acquiredAt:now()};
      candidates.push(entry);await save();
      console.log(JSON.stringify({at:now(),packId:pack.id,action:'video-extracted',name:entry.name,bytes:entry.bytes,codec:meta.codec}));
    }
    const actual=candidates.filter(a=>a.packId===pack.id);
    if(actual.length!==record.expectedSelectedVideos || !actual.length)throw new Error('Extracted video count does not match safe inventory');
    record.videoCount=actual.length;record.status='complete';delete record.error;record.completedAt=now();
    // Reclaim exact verified archive only; always validate absolute path inside DOWNLOADS.
    if(exists(archive)) {await unlinkDownload(archive);record.archive.retained=false;record.archive.removedAt=now();record.archive.removalReason='CRC/size/SHA256-verified extraction; retain room within shared 12 GiB lane';}
    attempt.outcome='complete';await event(pack,'complete',{videoCount:actual.length,laneBytes:await usage()});
  }catch(e){record.status=/budget/i.test(e.message)?'capacity-blocked':/Host gate|non-binary|download button/i.test(e.message)?'host-gated':'failed';record.error=e.message;attempt.outcome=record.status;attempt.error=e.message;await event(pack,record.status,{error:e.message});}
  attempt.endedAt=now();await save();
}
await save();
const chosen=process.argv.includes('--pack')?packs.filter(p=>p.id===process.argv[process.argv.indexOf('--pack')+1]):packs;
if(!chosen.length)throw new Error('Unknown pack');
for(const pack of chosen)await acquire(pack);
console.log(JSON.stringify({action:'lane-finished',videos:candidates.length,laneBytes:await usage(),statuses:state.packs.map(p=>({id:p.id,status:p.status,videos:p.videoCount,error:p.error}))}));
