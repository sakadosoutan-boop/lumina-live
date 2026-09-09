import {afterEach,describe,expect,it,vi} from 'vitest';
import {OutputMediaBridge} from '../src/output-media';
import type {Asset} from '../src/types';
const clip=(id:string,url:string):Asset=>({id,url,name:id,kind:'video',tags:[],hue:0,energy:.5,license:'local'});
afterEach(()=>vi.restoreAllMocks());
describe('standalone output media',()=>{
 it('shares local blob contents without repeatedly reading a large file',async()=>{
  const data=new Blob(['local video']);const read=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(data));
  const bridge=new OutputMediaBridge(),assets=[clip('a','blob:null/a')];
  const first=await bridge.package(assets),second=await bridge.package(assets);
  expect(await first.blobs.a.text()).toBe('local video');expect(second.blobs.a).toBe(first.blobs.a);expect(read).toHaveBeenCalledTimes(1);
 });
 it('creates and replaces output-owned URLs and revokes them on disposal',()=>{
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValueOnce('blob:output/1').mockReturnValueOnce('blob:output/2');
  const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{}),bridge=new OutputMediaBridge(),data={a:new Blob(['a'])};
  expect(bridge.restore([clip('a','blob:null/a')],data)[0].url).toBe('blob:output/1');
  bridge.restore([clip('a','blob:null/a')],data);expect(create).toHaveBeenCalledTimes(1);
  expect(bridge.restore([clip('a','blob:null/b')],data)[0].url).toBe('blob:output/2');expect(revoke).toHaveBeenCalledWith('blob:output/1');
  bridge.dispose();expect(revoke).toHaveBeenCalledWith('blob:output/2');
 });
 it('does not fetch external catalog or procedural assets',async()=>{
  const read=vi.spyOn(globalThis,'fetch');const bridge=new OutputMediaBridge();
  expect((await bridge.package([clip('v','/assets/media/v.mp4')])).blobs).toEqual({});expect(read).not.toHaveBeenCalled();
 });
 it('allows a missing blob to be relinked and retried',async()=>{
  const read=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(Error('expired')).mockResolvedValueOnce(new Response('video'));
  const bridge=new OutputMediaBridge(),assets=[clip('a','blob:null/a')];
  expect((await bridge.package(assets)).blobs).toEqual({});expect(await (await bridge.package(assets)).blobs.a.text()).toBe('video');expect(read).toHaveBeenCalledTimes(2);
 });
});
